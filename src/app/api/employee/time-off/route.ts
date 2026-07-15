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

  const { data: requests } = await supabaseAdmin
    .from('time_off_requests')
    .select('id, start_date, end_date, type, reason, status, created_at')
    .eq('employee_id', employee.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests ?? [] })
}

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id, name')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  const { startDate, endDate, type, reason } = await req.json()
  if (!startDate || !endDate || !type) return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('time_off_requests').insert([{
    user_id: employee.user_id,
    employee_id: employee.id,
    start_date: startDate,
    end_date: endDate,
    type,
    reason: reason || null,
    status: 'pending',
  }])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify owner
  await supabaseAdmin.from('notifications').insert([{
    user_id: employee.user_id,
    message: `${employee.name} requested time off (${type}) from ${startDate} to ${endDate}.`,
    read: false,
  }])

  return NextResponse.json({ success: true })
}
