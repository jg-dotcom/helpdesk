import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve owner uid (owner has business_profiles row; admins/managers do not)
  const { data: biz } = await supabaseAdmin
    .from('business_profiles').select('user_id').eq('user_id', user.id).single()
  let ownerId = user.id
  if (!biz) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('user_id').eq('email', user.email ?? '').single()
    if (emp) ownerId = emp.user_id
  }

  const today = new Date().toISOString().slice(0, 10)

  const [ptoRes, swapRes, calloutRes, empRes] = await Promise.all([
    supabaseAdmin
      .from('time_off_requests')
      .select('id, employee_id, start_date, end_date, type, reason, status')
      .eq('user_id', ownerId).eq('status', 'pending').order('created_at'),
    supabaseAdmin
      .from('shift_swaps')
      .select('id, requester_id, target_id, requester_shift_id, status, notes')
      .eq('user_id', ownerId).eq('status', 'pending'),
    supabaseAdmin
      .from('shifts')
      .select('id, employee_id, start_time, end_time, status')
      .eq('user_id', ownerId).eq('status', 'called_out').eq('shift_date', today),
    supabaseAdmin
      .from('employees')
      .select('id, name, role')
      .eq('user_id', ownerId).eq('status', 'active').order('name'),
  ])

  const emps = empRes.data ?? []
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]))

  const ptos = (ptoRes.data ?? []).map(p => ({
    ...p,
    employeeName: (empMap[p.employee_id] as { name: string } | undefined)?.name ?? 'Unknown',
  }))
  const swaps = (swapRes.data ?? []).map(s => ({
    ...s,
    requesterName: (empMap[s.requester_id] as { name: string } | undefined)?.name ?? 'Unknown',
    targetName: s.target_id ? ((empMap[s.target_id] as { name: string } | undefined)?.name ?? 'Unknown') : null,
  }))
  const callouts = (calloutRes.data ?? []).map(c => ({
    ...c,
    employeeName: c.employee_id ? ((empMap[c.employee_id] as { name: string } | undefined)?.name ?? 'Unknown') : 'Open shift',
  }))

  return NextResponse.json({ ptos, swaps, callouts, employees: emps })
}
