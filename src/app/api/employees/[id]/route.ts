import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// JAY-113 — bulk role/deactivate actions from the "Your team" grid PATCH
// one employee at a time through this route rather than writing directly.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const empId = parseInt(id)
  const body = await req.json()

  const updates: { role?: string; status?: string } = {}
  if (typeof body.role === 'string' && body.role.trim()) updates.role = body.role.trim()
  if (typeof body.status === 'string') updates.status = body.status
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', empId)
    .eq('user_id', user.id)
    .single()

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('employees')
    .update(updates)
    .eq('id', empId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ employee: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
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
  const cascadeDeletes: [string, string, number][] = [
    ['department_members', 'employee_id', empId],
    ['time_off_requests', 'employee_id', empId],
    ['time_entries', 'employee_id', empId],
    ['shifts', 'employee_id', empId],
    ['shift_swaps', 'requester_id', empId],
    ['shift_swaps', 'target_id', empId],
    ['payroll_entries', 'employee_id', empId],
    ['payroll_run_items', 'employee_id', empId],
  ]
  for (const [table, column, value] of cascadeDeletes) {
    const { error: cascadeError } = await supabaseAdmin.from(table).delete().eq(column, value)
    if (cascadeError) return NextResponse.json({ error: cascadeError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin.from('employees').delete().eq('id', empId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
