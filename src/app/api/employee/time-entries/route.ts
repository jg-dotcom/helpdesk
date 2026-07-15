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

  const { data: entries } = await supabaseAdmin
    .from('time_entries')
    .select('id, clock_in, clock_out, total_minutes, notes')
    .eq('employee_id', employee.id)
    .order('clock_in', { ascending: false })
    .limit(30)

  return NextResponse.json({ entries: entries ?? [] })
}
