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

  const today = new Date().toISOString().slice(0, 10)
  const fourWeeksOut = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: shifts } = await supabaseAdmin
    .from('shifts')
    .select('id, shift_date, start_time, end_time, notes, status')
    .eq('employee_id', employee.id)
    .gte('shift_date', today)
    .lte('shift_date', fourWeeksOut)
    .order('shift_date')

  return NextResponse.json({ shifts: shifts ?? [] })
}
