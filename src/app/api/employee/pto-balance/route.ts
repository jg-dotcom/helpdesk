import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { computeAccruedPtoDays, nextAccrualDate } from '../../../lib/ptoAccrual'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find employee by email
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name, pto_days_per_year, start, user_id')
    .eq('email', user.email!)

  if (!employees || employees.length === 0) {
    return NextResponse.json({ balance: null })
  }

  const emp = employees[0]

  // JAY-123 — resolve the owning business's accrual policy (defaults to
  // 'flat', i.e. unchanged behavior, if no business_profiles row or policy
  // is found).
  const { data: policy } = await supabaseAdmin
    .from('business_profiles')
    .select('pto_accrual_method, pto_accrual_rate')
    .eq('user_id', emp.user_id)
    .maybeSingle()
  const year = new Date().getFullYear()
  const startOfYear = `${year}-01-01`
  const endOfYear = `${year}-12-31`

  // Count approved time-off days this year.
  // JAY-59 — "Unpaid" is a distinct request type from PTO/Sick/Personal (see
  // the portal's request form); it shouldn't decrement a paid PTO balance.
  // This previously summed every approved request regardless of type, so an
  // employee approved for unpaid leave saw their real PTO balance drop by
  // the same amount — the opposite of what "Unpaid" is supposed to mean.
  const { data: approved } = await supabaseAdmin
    .from('time_off_requests')
    .select('start_date, end_date, portion, type')
    .eq('employee_id', emp.id)
    .eq('status', 'approved')
    .neq('type', 'Unpaid')
    .gte('start_date', startOfYear)
    .lte('start_date', endOfYear)

  let usedDays = 0
  for (const req of approved ?? []) {
    // JAY-9 — a single-day request with a half-day portion counts as 0.5.
    if (req.start_date === req.end_date && (req.portion === 'first_half' || req.portion === 'second_half')) {
      usedDays += 0.5
      continue
    }
    const start = new Date(req.start_date)
    const end = new Date(req.end_date ?? req.start_date)
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    usedDays += days
  }

  const accrualPolicy = { method: policy?.pto_accrual_method, rate: policy?.pto_accrual_rate }
  const totalDays = computeAccruedPtoDays(accrualPolicy, emp.pto_days_per_year ?? 0, emp.start)

  return NextResponse.json({
    balance: {
      total: totalDays,
      used: usedDays,
      remaining: Math.max(0, totalDays - usedDays),
      nextAccrualDate: nextAccrualDate(accrualPolicy),
    },
  })
}
