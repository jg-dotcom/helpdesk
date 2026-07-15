import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function POST(req: NextRequest) {
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
