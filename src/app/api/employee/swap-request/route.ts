import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { requesterShiftId, targetShiftId, targetEmployeeId, notes } = await req.json()
  if (!requesterShiftId) return NextResponse.json({ error: 'Missing requesterShiftId' }, { status: 400 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

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

// JAY-149 — let an employee cancel their own still-pending swap request.
export async function DELETE(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const { data: deleted, error } = await supabaseAdmin
    .from('shift_swaps')
    .delete()
    .eq('id', id)
    .eq('requester_employee_id', employee.id)
    .eq('status', 'pending')
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Request not found or no longer pending.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
