import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — a terminated employee's Supabase Auth account stays active
  // (only employees.status changes on termination), so every employee-facing
  // route must independently check status = 'active' or a former employee
  // keeps full portal/API access indefinitely.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, name, role, email, phone, pay_type, pay_rate, user_id, w4_status, i9_status, direct_deposit_status, access_role')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  return NextResponse.json({ employee })
}
