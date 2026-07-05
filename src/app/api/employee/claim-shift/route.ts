import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { shiftId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'Missing shiftId' }, { status: 400 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  // Verify the shift is open and belongs to the same business
  const { data: shift } = await supabaseAdmin
    .from('shifts')
    .select('id, is_open_shift, employee_id, user_id')
    .eq('id', shiftId)
    .eq('user_id', employee.user_id)
    .single()

  if (!shift) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 })
  if (!shift.is_open_shift || shift.employee_id != null) {
    return NextResponse.json({ error: 'Shift is no longer available.' }, { status: 409 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('shifts')
    .update({ employee_id: employee.id, is_open_shift: false })
    .eq('id', shiftId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ shift: updated })
}
