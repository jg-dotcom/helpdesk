import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find employee by email
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name, pto_days_per_year')
    .eq('email', user.email!)

  if (!employees || employees.length === 0) {
    return NextResponse.json({ balance: null })
  }

  const emp = employees[0]
  const year = new Date().getFullYear()
  const startOfYear = `${year}-01-01`
  const endOfYear = `${year}-12-31`

  // Count approved time-off days this year
  const { data: approved } = await supabaseAdmin
    .from('time_off_requests')
    .select('start_date, end_date')
    .eq('employee_id', emp.id)
    .eq('status', 'approved')
    .gte('start_date', startOfYear)
    .lte('start_date', endOfYear)

  let usedDays = 0
  for (const req of approved ?? []) {
    const start = new Date(req.start_date)
    const end = new Date(req.end_date ?? req.start_date)
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    usedDays += days
  }

  const totalDays = emp.pto_days_per_year ?? 0
  return NextResponse.json({
    balance: {
      total: totalDays,
      used: usedDays,
      remaining: Math.max(0, totalDays - usedDays),
    },
  })
}
