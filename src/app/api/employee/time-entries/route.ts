import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  const { data: entries } = await supabaseAdmin
    .from('time_entries')
    .select('id, clock_in, clock_out, total_minutes, notes')
    .eq('employee_id', employee.id)
    .order('clock_in', { ascending: false })
    .limit(30)

  return NextResponse.json({ entries: entries ?? [] })
}
