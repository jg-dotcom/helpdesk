import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { startDate, endDate, type, reason } = await req.json()

  if (!startDate || !endDate || !type) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id, user_id')
    .eq('token', token)
    .single()

  if (linkError || !link) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 404 })
  }

  const { error } = await supabaseAdmin.from('time_off_requests').insert([{
    user_id: link.user_id,
    employee_id: link.employee_id,
    start_date: startDate,
    end_date: endDate,
    type,
    reason: reason || null,
    status: 'pending',
  }])

  if (error) return NextResponse.json({ error: 'Could not save request.' }, { status: 500 })

  // Notify the owner
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('name')
    .eq('id', link.employee_id)
    .single()

  await supabaseAdmin.from('notifications').insert([{
    user_id: link.user_id,
    message: `${emp?.name || 'An employee'} requested time off (${type}) from ${startDate} to ${endDate}.`,
    read: false,
  }])

  return NextResponse.json({ success: true })
}
