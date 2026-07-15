import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// GET /api/payroll/confidence-check?periodStart=&periodEnd=
//
// Read-only pass over data we already have (time_entries + past payroll_run_items),
// surfaced on the Payroll page's "Needs attention" panel BEFORE a run, not after.
// Never blocks Run Payroll — purely advisory.
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodStart = req.nextUrl.searchParams.get('periodStart')
  const periodEnd = req.nextUrl.searchParams.get('periodEnd')
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: 'periodStart and periodEnd required' }, { status: 400 })
  }

  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name')
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (!employees?.length) {
    return NextResponse.json({ hoursAnomalies: [], overlaps: [] })
  }

  const { data: timeEntries } = await supabaseAdmin
    .from('time_entries')
    .select('employee_id, clock_in, clock_out, total_minutes')
    .eq('user_id', user.id)
    .gte('clock_in', `${periodStart}T00:00:00`)
    .lte('clock_in', `${periodEnd}T23:59:59`)
    .not('clock_out', 'is', null)
    .order('clock_in', { ascending: true })

  // Hours this period, per employee
  const hoursThisPeriod: Record<number, number> = {}
  const entriesByEmployee: Record<number, { clock_in: string; clock_out: string }[]> = {}
  for (const entry of timeEntries ?? []) {
    if (!entry.clock_out) continue
    hoursThisPeriod[entry.employee_id] = (hoursThisPeriod[entry.employee_id] ?? 0) + (entry.total_minutes ?? 0) / 60
    if (!entriesByEmployee[entry.employee_id]) entriesByEmployee[entry.employee_id] = []
    entriesByEmployee[entry.employee_id].push({ clock_in: entry.clock_in, clock_out: entry.clock_out })
  }

  // Trailing average from past finalized run items — cheapest baseline we already have,
  // no new table. Need at least 2 past periods before flagging anything as anomalous.
  const { data: pastItems } = await supabaseAdmin
    .from('payroll_run_items')
    .select('employee_id, hours_worked, payroll_runs!inner(period_start, user_id)')
    .eq('payroll_runs.user_id', user.id)
    .lt('payroll_runs.period_start', periodStart)

  type PastItem = { employee_id: number; hours_worked: number | null; payroll_runs: { period_start: string; user_id: string } | { period_start: string; user_id: string }[] }
  const sortedPastItems = ((pastItems ?? []) as PastItem[])
    .map(item => ({
      employee_id: item.employee_id,
      hours_worked: item.hours_worked,
      period_start: Array.isArray(item.payroll_runs) ? item.payroll_runs[0]?.period_start : item.payroll_runs?.period_start,
    }))
    .filter(item => item.period_start)
    .sort((a, b) => (a.period_start! < b.period_start! ? 1 : -1)) // most recent first

  const pastHoursByEmployee: Record<number, number[]> = {}
  for (const item of sortedPastItems) {
    if (item.hours_worked == null) continue
    if (!pastHoursByEmployee[item.employee_id]) pastHoursByEmployee[item.employee_id] = []
    if (pastHoursByEmployee[item.employee_id].length < 4) {
      pastHoursByEmployee[item.employee_id].push(item.hours_worked)
    }
  }

  const hoursAnomalies: { employeeId: number; employeeName: string; hoursThisPeriod: number; avgHours: number }[] = []
  for (const emp of employees) {
    const current = hoursThisPeriod[emp.id]
    const past = pastHoursByEmployee[emp.id]
    if (!current || !past || past.length < 2) continue
    const avg = past.reduce((s, h) => s + h, 0) / past.length
    if (avg >= 5 && current > avg * 1.5) {
      hoursAnomalies.push({
        employeeId: emp.id,
        employeeName: emp.name,
        hoursThisPeriod: Math.round(current * 10) / 10,
        avgHours: Math.round(avg * 10) / 10,
      })
    }
  }

  // Overlapping clock-in/out within the period, per employee
  const overlaps: { employeeId: number; employeeName: string; count: number }[] = []
  for (const emp of employees) {
    const list = entriesByEmployee[emp.id]
    if (!list || list.length < 2) continue
    let overlapCount = 0
    for (let i = 0; i < list.length - 1; i++) {
      const currentOut = new Date(list[i].clock_out).getTime()
      const nextIn = new Date(list[i + 1].clock_in).getTime()
      if (currentOut > nextIn) overlapCount++
    }
    if (overlapCount > 0) {
      overlaps.push({ employeeId: emp.id, employeeName: emp.name, count: overlapCount })
    }
  }

  // Stale open entries — clocked in but never clocked out, still sitting open past a
  // reasonable shift length. Distinct failure mode from `overlaps` above (JAY-5 covers
  // two entries that overlap; this covers one entry that never closed at all). Not
  // period-scoped — this is about current real-time state, not the run being built.
  const OPEN_ENTRY_THRESHOLD_HOURS = 10
  const { data: openRows } = await supabaseAdmin
    .from('time_entries')
    .select('employee_id, clock_in')
    .eq('user_id', user.id)
    .is('clock_out', null)

  const nowMs = Date.now()
  const openTimeEntries: { employeeId: number; employeeName: string; clockIn: string; hoursOpen: number }[] = []
  for (const entry of openRows ?? []) {
    const hoursOpen = (nowMs - new Date(entry.clock_in).getTime()) / 3600000
    if (hoursOpen < OPEN_ENTRY_THRESHOLD_HOURS) continue
    const emp = employees.find(e => e.id === entry.employee_id)
    if (!emp) continue
    openTimeEntries.push({ employeeId: emp.id, employeeName: emp.name, clockIn: entry.clock_in, hoursOpen: Math.round(hoursOpen * 10) / 10 })
  }

  return NextResponse.json({ hoursAnomalies, overlaps, openTimeEntries })
}
