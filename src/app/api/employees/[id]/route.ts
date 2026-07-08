import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const empId = parseInt(id)

  // Verify the employee belongs to this owner
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', empId)
    .eq('user_id', user.id)
    .single()

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // Cascade delete all related records (FK constraints would block the main delete)
  await supabaseAdmin.from('department_members').delete().eq('employee_id', empId)
  await supabaseAdmin.from('time_off_requests').delete().eq('employee_id', empId)
  await supabaseAdmin.from('time_entries').delete().eq('employee_id', empId)
  await supabaseAdmin.from('shifts').delete().eq('employee_id', empId)
  await supabaseAdmin.from('shift_swaps').delete().eq('requester_id', empId)
  await supabaseAdmin.from('shift_swaps').delete().eq('target_id', empId)

  const { error } = await supabaseAdmin.from('employees').delete().eq('id', empId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
