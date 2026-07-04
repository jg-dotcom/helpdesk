import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function DELETE(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Delete all user data in order (FK constraints)
  const uid = user.id
  await supabaseAdmin.from('payroll_entries').delete().eq('user_id', uid)
  await supabaseAdmin.from('shifts').delete().eq('user_id', uid)
  await supabaseAdmin.from('time_off_requests').delete().eq('user_id', uid)
  await supabaseAdmin.from('notifications').delete().eq('user_id', uid)
  await supabaseAdmin.from('employee_forms').delete().eq('user_id', uid)
  await supabaseAdmin.from('onboarding_links').delete().eq('user_id', uid)
  await supabaseAdmin.from('employees').delete().eq('user_id', uid)
  await supabaseAdmin.from('onboarding_templates').delete().eq('user_id', uid)
  await supabaseAdmin.from('job_postings').delete().eq('user_id', uid)
  await supabaseAdmin.from('gusto_connections').delete().eq('user_id', uid)
  await supabaseAdmin.from('google_connections').delete().eq('user_id', uid)
  await supabaseAdmin.from('quickbooks_connections').delete().eq('user_id', uid)
  await supabaseAdmin.from('team_members').delete().eq('owner_id', uid)
  await supabaseAdmin.from('business_profiles').delete().eq('user_id', uid)
  await supabaseAdmin.from('notification_preferences').delete().eq('user_id', uid)

  // Delete the auth user last
  await supabaseAdmin.auth.admin.deleteUser(uid)

  return NextResponse.json({ success: true })
}
