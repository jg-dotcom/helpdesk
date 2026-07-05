import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { requesterShiftId, targetShiftId, targetEmployeeId, notes } = await req.json()
  if (!requesterShiftId) return NextResponse.json({ error: 'Missing requesterShiftId' }, { status: 400 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  // Verify the requester's shift belongs to them
  const { data: reqShift } = await supabaseAdmin
    .from('shifts')
    .select('id, employee_id')
    .eq('id', requesterShiftId)
    .eq('employee_id', employee.id)
    .single()

  if (!reqShift) return NextResponse.json({ error: 'Shift not found or not yours.' }, { status: 404 })

  const { data: swap, error } = await supabaseAdmin
    .from('shift_swaps')
    .insert([{
      user_id: employee.user_id,
      requester_employee_id: employee.id,
      requester_shift_id: requesterShiftId,
      target_employee_id: targetEmployeeId ?? null,
      target_shift_id: targetShiftId ?? null,
      notes: notes?.trim() || null,
      status: 'pending',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ swap })
}
