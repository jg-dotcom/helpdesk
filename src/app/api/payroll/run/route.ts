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

  const { periodStart, periodEnd, notes } = await req.json()
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: 'periodStart and periodEnd required' }, { status: 400 })
  }

  // Fetch active employees with pay info
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name, pay_type, pay_rate')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .not('pay_rate', 'is', null)

  if (!employees?.length) {
    return NextResponse.json({ error: 'No active employees with pay rates set.' }, { status: 400 })
  }

  // Fetch time entries for the period (for hourly employees)
  const { data: timeEntries } = await supabaseAdmin
    .from('time_entries')
    .select('employee_id, total_minutes')
    .eq('user_id', user.id)
    .gte('clock_in', `${periodStart}T00:00:00`)
    .lte('clock_in', `${periodEnd}T23:59:59`)
    .not('clock_out', 'is', null)

  // Build hours map
  const hoursMap: Record<number, number> = {}
  for (const entry of timeEntries ?? []) {
    if (!hoursMap[entry.employee_id]) hoursMap[entry.employee_id] = 0
    hoursMap[entry.employee_id] += (entry.total_minutes ?? 0) / 60
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
    .select('employee_id, start_date, end_date, type')
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
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10)
      const scheduled = shiftHoursByEmpDate.get(`${req.employee_id}_${dateStr}`)
      requestHours += scheduled ?? DEFAULT_PTO_HOURS_PER_DAY
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

    if (emp.pay_type === 'salary') {
      // Bi-weekly pay = annual / 26 — fixed regardless of time off, so PTO
      // hours aren't added for salaried employees (nothing to add them to).
      grossPay = rate / 26
    } else {
      hoursWorked = Math.round(((hoursMap[emp.id] ?? 0) + ptoHours) * 100) / 100
      grossPay = hoursWorked * rate
    }

    return {
      user_id: user.id,
      employee_id: emp.id,
      employee_name: emp.name,
      pay_type: emp.pay_type,
      pay_rate: rate,
      hours_worked: hoursWorked,
      gross_pay: Math.round(grossPay * 100) / 100,
      deductions: { federal: 0, state: 0, other: 0 },
      net_pay: Math.round(grossPay * 100) / 100,
      notes: emp.pay_type !== 'salary' && ptoHours > 0 ? `+${ptoHours.toFixed(1)} hrs PTO` : null,
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
    })
    .select()
    .single()

  if (runErr || !run) return NextResponse.json({ error: runErr?.message ?? 'Failed to create run' }, { status: 500 })

  // Insert line items
  const itemsWithRunId = items.map(i => ({ ...i, run_id: run.id }))
  await supabaseAdmin.from('payroll_run_items').insert(itemsWithRunId)

  return NextResponse.json({ run })
}
