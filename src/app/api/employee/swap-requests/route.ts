import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  const { data: swaps } = await supabaseAdmin
    .from('shift_swaps')
    .select('id, requester_shift_id, target_shift_id, target_employee_id, status, notes, created_at')
    .eq('requester_employee_id', employee.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ swaps: swaps ?? [] })
}
