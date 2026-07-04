import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
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

  // Check if already clocked in
  const { data: open } = await supabaseAdmin
    .from('time_entries')
    .select('id')
    .eq('employee_id', employee.id)
    .is('clock_out', null)
    .single()

  if (open) return NextResponse.json({ error: 'Already clocked in.' }, { status: 400 })

  const { data: entry, error } = await supabaseAdmin
    .from('time_entries')
    .insert([{
      user_id: employee.user_id,
      employee_id: employee.id,
      clock_in: new Date().toISOString(),
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entry })
}
