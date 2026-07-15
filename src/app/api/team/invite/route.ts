import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { sendSetupInviteEmail } from '../../../../lib/teamInvite'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('team_members')
    .select('id, member_email, role, invited_at, accepted_at')
    .eq('owner_id', user.id)
    .order('invited_at', { ascending: false })

  return NextResponse.json({ members: data ?? [] })
}

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, role } = await req.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })

  const cleanEmail = email.trim().toLowerCase()
  const accessRole = role ?? 'employee'

  // Get business info for the invite email
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', user.id)
    .single()
  const bizName = biz?.business_name ?? 'Your team'

  // Check if employee record already exists
  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .eq('email', cleanEmail)
    .single()

  if (existing) {
    // Just update their access role
    await supabaseAdmin.from('employees').update({ access_role: accessRole }).eq('id', existing.id)
    return NextResponse.json({ success: true })
  }

  // Create a minimal employee record so they appear in the team list
  const { data: newEmp, error: insertErr } = await supabaseAdmin
    .from('employees')
    .insert([{
      user_id: user.id,
      name: cleanEmail.split('@')[0],
      email: cleanEmail,
      role: accessRole,
      access_role: accessRole,
      status: 'active',
      type: 'Full-time',
      pay_type: 'hourly',
      pay_rate: null,
      pay_period: 'biweekly',
      i9_status: 'pending',
      w4_status: 'pending',
      direct_deposit_status: 'pending',
    }])
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  try {
    await sendSetupInviteEmail(cleanEmail, accessRole, bizName)
  } catch { /* don't fail if email errors */ }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  // Kept for backward compat — use role update via supabase client instead
  return NextResponse.json({ success: true })
}
