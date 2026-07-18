import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// GET /api/payroll/run — list all runs
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: runs } = await supabaseAdmin
    .from('payroll_runs')
    .select('*')
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
    .limit(24)

  return NextResponse.json({ runs: runs ?? [] })
}

// POST /api/payroll/run — create a new run (auto-calculate from time entries)
export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodStart, periodEnd, notes, runType, reason, employeeIds: offCycleEmployeeIds } = await req.json()
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: 'periodStart and periodEnd required' }, { status: 400 })
  }

  // JAY-115 — off-cycle runs (bonus/correction/one-off pay) reuse this same
  // real payroll_runs/payroll_run_items pipeline rather than a third parallel
  // ledger (the JAY-88 lesson), just scoped to a caller-chosen subset of
  // employees and intentionally exempt from the JAY-48 duplicate-period
  // guard below — an owner may legitimately need to run a bonus for the same
  // period a regular run already covered.
  const isOffCycle = runType === 'off_cycle'
  if (isOffCycle && (!Array.isArray(offCycleEmployeeIds) || offCycleEmployeeIds.length === 0)) {
    return NextResponse.json({ error: 'Select at least one employee for an off-cycle run.' }, { status: 400 })
  }

  if (!isOffCycle) {
    // JAY-48 — block a second FINALIZED run for the same period (double-pay
    // risk from a double-click or retried request). Draft runs stay
    // unrestricted — an owner may want to regenerate a draft preview more than
    // once before finalizing, and only a finalized run represents money
    // actually considered "paid." Backed by a DB-level partial unique index
    // (payroll_runs_one_finalized_per_period, now scoped to run_type='regular'
    // per JAY-115) as defense in depth; this check is what produces the
    // actual helpful error message.
    const { data: existingFinalized } = await supabaseAdmin
      .from('payroll_runs')
      .select('id, run_date, total_gross')
      .eq('user_id', user.id)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .eq('status', 'finalized')
      .maybeSingle()

    if (existingFinalized) {
      return NextResponse.json({
        error: `A finalized payroll run already exists for this period (run on ${existingFinalized.run_date}, $${Number(existingFinalized.total_gross).toFixed(2)} total).`,
        existingRunId: existingFinalized.id,
      }, { status: 409 })
    }
  }

  // Fetch active employees with pay info. Off-cycle runs restrict this to
  // the caller-selected subset instead of "everyone active" — a bonus run
  // isn't meant to re-pay the whole team.
  let employeesQuery = supabaseAdmin
    .from('employees')
    .select('id, name, pay_type, pay_rate, pay_period')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .not('pay_rate', 'is', null)
  if (isOffCycle) employeesQuery = employeesQuery.in('id', offCycleEmployeeIds)
  const { data: employees } = await employeesQuery

  if (!employees?.length) {
    return NextResponse.json({ error: 'No active employees with pay rates set.' }, { status: 400 })
  }

  // Fetch time entries for the period (for hourly employees). Includes clock_in
  // so hours can be bucketed per day — needed for JAY-51 (below) to apply the
  // rate that was actually in effect on each specific day worked, not just
  // whatever the employee's current rate happens to be at run-time.
  const { data: timeEntries } = await supabaseAdmin
    .from('time_entries')
    .select('employee_id, total_minutes, clock_in')
    .eq('user_id', user.id)
    .gte('clock_in', `${periodStart}T00:00:00`)
    .lte('clock_in', `${periodEnd}T23:59:59`)
    .not('clock_out', 'is', null)

  // Build hours map (period total, still used for the hours_worked column)
  // and a per-employee-per-day map (used for the rate-split calculation).
  const hoursMap: Record<number, number> = {}
  const dailyHoursByEmp = new Map<number, Map<string, number>>()
  function addDailyHours(empId: number, dateStr: string, hrs: number) {
    if (!dailyHoursByEmp.has(empId)) dailyHoursByEmp.set(empId, new Map())
    const m = dailyHoursByEmp.get(empId)!
    m.set(dateStr, (m.get(dateStr) ?? 0) + hrs)
  }
  for (const entry of timeEntries ?? []) {
    if (!hoursMap[entry.employee_id]) hoursMap[entry.employee_id] = 0
    const hrs = (entry.total_minutes ?? 0) / 60
    hoursMap[entry.employee_id] += hrs
    addDailyHours(entry.employee_id, entry.clock_in.slice(0, 10), hrs)
  }

  // JAY-57 — snapshot worked-only daily hours before PTO gets merged into
  // dailyHoursByEmp below. FLSA overtime is computed on hours *actually
  // worked* in a week — paid time off doesn't count toward the 40h
  // threshold, so the weekly-overtime pass further down must only look at
  // this snapshot, not the combined worked+PTO map used for total pay.
  const workedDailyHoursByEmp = new Map<number, Map<string, number>>()
  for (const [empId, dayMap] of dailyHoursByEmp) {
    workedDailyHoursByEmp.set(empId, new Map(dayMap))
  }

  // Sunday-start week key, matching the existing >40h/week overtime warning
  // already shown at schedule-build time (JAY-16, time/page.tsx's
  // weekStartISO/getWeekDays) — same boundary convention throughout the app.
  function weekStartKey(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    d.setDate(d.getDate() - d.getDay())
    return d.toISOString().slice(0, 10)
  }

  // JAY-51 — pay_rate_history holds one row per rate change, keyed by the date
  // it took effect. To find the rate in effect on a given day, take the most
  // recent row with effective_from <= that day. Employees with zero history
  // rows (never had a logged change) fall back to their current pay_rate for
  // every day — identical to pre-fix behavior.
  const employeeIds = employees.map(e => e.id)
  const { data: rateHistory } = await supabaseAdmin
    .from('pay_rate_history')
    .select('employee_id, pay_rate, effective_from')
    .eq('user_id', user.id)
    .in('employee_id', employeeIds)
    .order('effective_from', { ascending: true })

  const rateHistoryByEmp = new Map<number, { rate: number; effective_from: string }[]>()
  for (const r of rateHistory ?? []) {
    if (!rateHistoryByEmp.has(r.employee_id)) rateHistoryByEmp.set(r.employee_id, [])
    rateHistoryByEmp.get(r.employee_id)!.push({ rate: r.pay_rate, effective_from: r.effective_from })
  }

  // Note: if every logged change for an employee happened AFTER a given day,
  // there's no historical data point for what the rate was on that earlier
  // day (history only exists from whenever this feature started logging) —
  // falls back to the current rate for those days, same as before this fix.
  function effectiveRate(empId: number, dateStr: string, fallbackRate: number): number {
    const history = rateHistoryByEmp.get(empId)
    if (!history?.length) return fallbackRate
    let rate = fallbackRate
    let found = false
    for (const h of history) {
      if (h.effective_from <= dateStr) { rate = h.rate; found = true } else break
    }
    return found ? rate : fallbackRate
  }

  // JAY-44 — approved PTO/Sick/Personal time off never added paid hours; payroll
  // only ever summed clocked time_entries, so an approved paid day off and an
  // approved Unpaid day off both paid exactly $0. Unpaid is deliberately
  // excluded — everything else (PTO, Sick, Personal) pays out. No accrual bank,
  // no schema change: paid hours for a day off come from that day's scheduled
  // shift if one exists, otherwise a flat 8h default.
  const PAID_TIME_OFF_TYPES = ['PTO', 'Sick', 'Personal']
  const DEFAULT_PTO_HOURS_PER_DAY = 8

  const { data: paidTimeOff } = await supabaseAdmin
    .from('time_off_requests')
    .select('employee_id, start_date, end_date, type, portion')
    .eq('user_id', user.id)
    .eq('status', 'approved')
    .in('type', PAID_TIME_OFF_TYPES)
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)

  const { data: periodShifts } = await supabaseAdmin
    .from('shifts')
    .select('employee_id, shift_date, start_time, end_time')
    .eq('user_id', user.id)
    .gte('shift_date', periodStart)
    .lte('shift_date', periodEnd)

  function shiftHours(startTime: string, endTime: string) {
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60
  }

  const shiftHoursByEmpDate = new Map<string, number>()
  for (const s of periodShifts ?? []) {
    if (s.employee_id == null) continue
    shiftHoursByEmpDate.set(`${s.employee_id}_${s.shift_date}`, shiftHours(s.start_time, s.end_time))
  }

  // Build per-employee PTO hours by walking each day of each approved request
  // that falls inside this pay period (a request can span outside the period).
  const ptoHoursMap: Record<number, number> = {}
  const ptoRequestCountByEmp: Record<number, number> = {}
  for (const req of paidTimeOff ?? []) {
    const rangeStart = req.start_date > periodStart ? req.start_date : periodStart
    const rangeEnd = req.end_date < periodEnd ? req.end_date : periodEnd
    let cursor = new Date(rangeStart + 'T00:00:00')
    const end = new Date(rangeEnd + 'T00:00:00')
    let requestHours = 0
    // JAY-9 — a single-day request with a half-day portion pays half the
    // day's hours instead of the full day.
    const isHalfDay = req.start_date === req.end_date && (req.portion === 'first_half' || req.portion === 'second_half')
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10)
      const scheduled = shiftHoursByEmpDate.get(`${req.employee_id}_${dateStr}`)
      let dayHours = scheduled ?? DEFAULT_PTO_HOURS_PER_DAY
      if (isHalfDay) dayHours = dayHours / 2
      requestHours += dayHours
      // JAY-51 — PTO days need to land in the same per-day bucket as worked
      // hours so a rate change mid-period also applies correctly to time off.
      addDailyHours(req.employee_id, dateStr, dayHours)
      cursor.setDate(cursor.getDate() + 1)
    }
    ptoHoursMap[req.employee_id] = (ptoHoursMap[req.employee_id] ?? 0) + requestHours
    ptoRequestCountByEmp[req.employee_id] = (ptoRequestCountByEmp[req.employee_id] ?? 0) + 1
  }

  // Calculate pay items
  const items = employees.map(emp => {
    const rate = emp.pay_rate ?? 0
    let hoursWorked: number | null = null
    let grossPay: number
    const ptoHours = Math.round((ptoHoursMap[emp.id] ?? 0) * 100) / 100
    let rateSplitNote: string | null = null
    let overtimeHours: number | null = null
    let overtimeNote: string | null = null

    if (emp.pay_type === 'salary') {
      // JAY-75 — `pay_period` is a real, UI-editable per-employee field
      // (weekly/biweekly/semi-monthly/monthly, set in EmployeePanel.tsx and
      // already read/display-only client-side by payroll/page.tsx's own
      // getPeriodForType()), but this route previously ignored it entirely
      // and hardcoded annual/26 for every salaried employee regardless of
      // their actual pay period — silently underpaying a "weekly" employee
      // by half, or overpaying a "monthly" one by ~2.17x, every single run.
      // Mirrors the same divisor convention as getPeriodForType() client-side.
      const divisorByPeriod: Record<string, number> = { weekly: 52, biweekly: 26, 'semi-monthly': 24, monthly: 12 }
      const divisor = divisorByPeriod[emp.pay_period as string] ?? 26
      grossPay = rate / divisor
    } else {
      hoursWorked = Math.round(((hoursMap[emp.id] ?? 0) + ptoHours) * 100) / 100

      // JAY-57 — figure out, per calendar week, which worked hours (not PTO)
      // fall past the 40h FLSA threshold. Days are walked in chronological
      // order within each week; once the running weekly total crosses 40,
      // the remaining hours that day (and any later days that week) are
      // overtime. Multiple engineers could reasonably pick a different
      // convention for *which* hours within a week count as the "last" ones
      // when a single day pushes the total over the line — this uses
      // straightforward chronological order, which is the common convention
      // and keeps the per-day rate already resolved for JAY-51.
      const workedDayMap = workedDailyHoursByEmp.get(emp.id)
      const otHoursByDate = new Map<string, number>()
      if (workedDayMap && workedDayMap.size > 0) {
        const sortedDates = [...workedDayMap.keys()].sort()
        const weekRunningTotal = new Map<string, number>()
        for (const dateStr of sortedDates) {
          const wk = weekStartKey(dateStr)
          const hrs = workedDayMap.get(dateStr) ?? 0
          const before = weekRunningTotal.get(wk) ?? 0
          const after = before + hrs
          weekRunningTotal.set(wk, after)
          if (after > 40) {
            const otForDay = Math.min(hrs, after - 40)
            if (otForDay > 0) otHoursByDate.set(dateStr, otForDay)
          }
        }
      }

      // JAY-51 — sum pay day-by-day using whatever rate was in effect on
      // each specific day, instead of applying the current rate to every
      // hour in the period. Falls back to a flat calculation (old behavior)
      // if there's no per-day data at all. Now also splits each day's hours
      // into regular (straight rate) and overtime (1.5x) per JAY-57 — PTO
      // hours are always regular-rate since they're excluded from
      // otHoursByDate (built only from workedDailyHoursByEmp).
      const dayMap = dailyHoursByEmp.get(emp.id)
      let totalOtHours = 0
      if (dayMap && dayMap.size > 0) {
        let sum = 0
        const segments: { rate: number; hours: number; isOt: boolean }[] = []
        for (const [dateStr, hrs] of dayMap) {
          const r = effectiveRate(emp.id, dateStr, rate)
          const otHrs = Math.min(hrs, otHoursByDate.get(dateStr) ?? 0)
          const regHrs = hrs - otHrs
          sum += regHrs * r + otHrs * r * 1.5
          totalOtHours += otHrs
          if (regHrs > 0) {
            const seg = segments.find(s => s.rate === r && !s.isOt)
            if (seg) seg.hours += regHrs; else segments.push({ rate: r, hours: regHrs, isOt: false })
          }
          if (otHrs > 0) {
            const seg = segments.find(s => s.rate === r && s.isOt)
            if (seg) seg.hours += otHrs; else segments.push({ rate: r, hours: otHrs, isOt: true })
          }
        }
        grossPay = sum
        const regSegments = segments.filter(s => !s.isOt)
        if (regSegments.length > 1) {
          rateSplitNote = regSegments
            .map(s => `${(Math.round(s.hours * 100) / 100) % 1 === 0 ? s.hours : s.hours.toFixed(1)}h @ $${s.rate.toFixed(2)}/hr`)
            .join(' + ')
        }
      } else {
        grossPay = hoursWorked * rate
      }
      totalOtHours = Math.round(totalOtHours * 100) / 100
      if (totalOtHours > 0) {
        overtimeHours = totalOtHours
        overtimeNote = `${totalOtHours % 1 === 0 ? totalOtHours : totalOtHours.toFixed(1)}h OT @ 1.5x`
      }
    }

    const ptoNote = emp.pay_type !== 'salary' && ptoHours > 0 ? `+${ptoHours.toFixed(1)} hrs PTO` : null

    return {
      user_id: user.id,
      employee_id: emp.id,
      employee_name: emp.name,
      pay_type: emp.pay_type,
      pay_rate: rate,
      hours_worked: hoursWorked,
      overtime_hours: overtimeHours,
      gross_pay: Math.round(grossPay * 100) / 100,
      deductions: { federal: 0, state: 0, other: 0 },
      net_pay: Math.round(grossPay * 100) / 100,
      notes: [rateSplitNote, overtimeNote, ptoNote].filter(Boolean).join(' · ') || null,
    }
  })

  const totalGross = items.reduce((s, i) => s + i.gross_pay, 0)

  // Create the run record
  const { data: run, error: runErr } = await supabaseAdmin
    .from('payroll_runs')
    .insert({
      user_id: user.id,
      period_start: periodStart,
      period_end: periodEnd,
      total_gross: Math.round(totalGross * 100) / 100,
      employee_count: items.length,
      notes: notes ?? null,
      run_type: isOffCycle ? 'off_cycle' : 'regular',
      reason: isOffCycle ? (reason ?? null) : null,
    })
    .select()
    .single()

  if (runErr || !run) return NextResponse.json({ error: runErr?.message ?? 'Failed to create run' }, { status: 500 })

  // Insert line items
  const itemsWithRunId = items.map(i => ({ ...i, run_id: run.id }))
  const { error: itemsErr } = await supabaseAdmin.from('payroll_run_items').insert(itemsWithRunId)

  if (itemsErr) {
    await supabaseAdmin.from('payroll_runs').delete().eq('id', run.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  return NextResponse.json({ run })
}
