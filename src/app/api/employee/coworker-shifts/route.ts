import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

// Returns upcoming shifts belonging to OTHER employees (for swap picker)
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  const fourWeeksOut = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Fetch all coworkers
  const { data: coworkers } = await supabaseAdmin
    .from('employees')
    .select('id, name')
    .eq('user_id', employee.user_id)
    .neq('id', employee.id)
    .eq('status', 'active')

  if (!coworkers?.length) return NextResponse.json({ shifts: [] })

  const coworkerIds = coworkers.map(c => c.id)
  const empNames = Object.fromEntries(coworkers.map(c => [c.id, c.name]))

  const { data: shifts } = await supabaseAdmin
    .from('shifts')
    .select('id, employee_id, shift_date, start_time, end_time')
    .eq('user_id', employee.user_id)
    .in('employee_id', coworkerIds)
    .gte('shift_date', today)
    .lte('shift_date', fourWeeksOut)
    .neq('status', 'called_out')
    .is('is_open_shift', false)
    .order('shift_date')

  const enriched = (shifts ?? []).map(s => ({ ...s, employee_name: empNames[s.employee_id] ?? 'Unknown' }))

  return NextResponse.json({ shifts: enriched })
}
