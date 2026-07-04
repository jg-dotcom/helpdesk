import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
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

  // Find open entry
  const { data: open } = await supabaseAdmin
    .from('time_entries')
    .select('id, clock_in')
    .eq('employee_id', employee.id)
    .is('clock_out', null)
    .single()

  if (!open) return NextResponse.json({ error: 'Not clocked in.' }, { status: 400 })

  const clockOut = new Date()
  const clockIn = new Date(open.clock_in)
  const totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)

  const { data: entry, error } = await supabaseAdmin
    .from('time_entries')
    .update({
      clock_out: clockOut.toISOString(),
      total_minutes: totalMinutes,
    })
    .eq('id', open.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entry, totalMinutes })
}
