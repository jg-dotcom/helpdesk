import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const resend = new Resend(process.env.RESEND_API_KEY)

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('team_members')
    .select('id, member_email, role, invited_at, accepted_at')
    .eq('owner_id', user.id)
    .order('invited_at', { ascending: false })

  return NextResponse.json({ members: data ?? [] })
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
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

  // Generate a magic link so they can set up their account
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let inviteUrl = `${appUrl}/portal/setup`
  try {
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
      options: { redirectTo: `${appUrl}/portal/setup` },
    })
    if (linkData?.properties?.action_link) inviteUrl = linkData.properties.action_link
  } catch { /* fall back to setup page URL */ }

  try {
    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: cleanEmail,
      subject: `You've been added to ${bizName} on Helpdesk`,
      html: `
        <p>You've been added to <strong>${bizName}</strong> on Helpdesk as a <strong>${accessRole}</strong>.</p>
        <p>Click below to set up your account and get access:</p>
        <p><a href="${inviteUrl}" style="background:#185fa5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">Set up my account</a></p>
        <p style="color:#888;font-size:12px;margin-top:16px;">This link expires in 1 hour. After setting up, sign in at ${appUrl}/login</p>
      `,
    })
  } catch { /* don't fail if email errors */ }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  // Kept for backward compat — use role update via supabase client instead
  return NextResponse.json({ success: true })
}
