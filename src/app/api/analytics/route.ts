import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabaseAdmin'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Last 8 weeks of data
  const weeksBack = 8
  const now = new Date()
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - weeksBack * 7)

  // 1. Labor cost by week (payroll_entries)
  const { data: payroll } = await supabaseAdmin
    .from('payroll_entries')
    .select('gross_pay, created_at')
    .eq('user_id', user.id)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true })

  // 2. Hours worked by employee (time_entries)
  const { data: timeEntries } = await supabaseAdmin
    .from('time_entries')
    .select('employee_id, total_minutes, clock_in, employees(name)')
    .eq('user_id', user.id)
    .not('total_minutes', 'is', null)
    .gte('clock_in', startDate.toISOString())

  // 3. Employee count over time (employees)
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name, created_at, pay_rate, pay_type')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  // Build weekly labor cost buckets
  const weeks: { label: string; startMs: number }[] = []
  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const sun = new Date(d)
    sun.setDate(d.getDate() - d.getDay())
    sun.setHours(0, 0, 0, 0)
    const label = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!weeks.find(w => w.label === label)) {
      weeks.push({ label, startMs: sun.getTime() })
    }
  }

  const laborByWeek = weeks.map(w => {
    const weekEnd = w.startMs + 7 * 86400000
    const total = (payroll ?? [])
      .filter(p => {
        const t = new Date(p.created_at).getTime()
        return t >= w.startMs && t < weekEnd
      })
      .reduce((sum, p) => sum + (p.gross_pay ?? 0), 0)
    return { week: w.label, cost: Math.round(total) }
  })

  // Hours per employee
  const hoursByEmployee: Record<string, number> = {}
  const nameMap: Record<string, string> = {}
  for (const te of timeEntries ?? []) {
    const empId = String(te.employee_id)
    hoursByEmployee[empId] = (hoursByEmployee[empId] ?? 0) + (te.total_minutes ?? 0)
    // @ts-expect-error join shape
    if (te.employees?.name) nameMap[empId] = te.employees.name
  }
  const hoursData = Object.entries(hoursByEmployee)
    .map(([id, mins]) => ({ name: nameMap[id] ?? `Employee ${id}`, hours: Math.round(mins / 60 * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)

  // Headcount over time (cumulative by month)
  const headcountByMonth: Record<string, number> = {}
  let cumulative = 0
  for (const emp of employees ?? []) {
    const month = new Date(emp.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    cumulative++
    headcountByMonth[month] = cumulative
  }
  const headcountData = Object.entries(headcountByMonth).map(([month, count]) => ({ month, count }))

  // Summary stats
  const totalPayroll = (payroll ?? []).reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const totalHours = (timeEntries ?? []).reduce((s, te) => s + (te.total_minutes ?? 0), 0)
  const activeEmployees = (employees ?? []).length

  return NextResponse.json({
    summary: {
      totalPayroll: Math.round(totalPayroll),
      totalHours: Math.round(totalHours / 60 * 10) / 10,
      activeEmployees,
    },
    laborByWeek,
    hoursData,
    headcountData,
  })
}
