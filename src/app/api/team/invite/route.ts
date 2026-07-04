import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import crypto from 'crypto'

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

  // Check for duplicate
  const { data: existing } = await supabaseAdmin
    .from('team_members')
    .select('id')
    .eq('owner_id', user.id)
    .eq('member_email', email.trim().toLowerCase())
    .single()

  if (existing) return NextResponse.json({ error: 'This person has already been invited.' }, { status: 400 })

  const token = crypto.randomBytes(24).toString('hex')

  const { error } = await supabaseAdmin.from('team_members').insert([{
    owner_id: user.id,
    member_email: email.trim().toLowerCase(),
    role: role ?? 'manager',
    invite_token: token,
  }])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get owner business name
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', user.id)
    .single()

  const bizName = biz?.business_name ?? 'Your team'
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/team/accept/${token}`

  try {
    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: email.trim(),
      subject: `You've been invited to join ${bizName} on Helpdesk`,
      html: `
        <p>You've been invited to join <strong>${bizName}</strong> on Helpdesk as a <strong>${role ?? 'manager'}</strong>.</p>
        <p><a href="${inviteUrl}" style="background:#185fa5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">Accept invitation</a></p>
        <p style="color:#888;font-size:12px;margin-top:16px;">This link expires in 7 days.</p>
      `,
    })
  } catch {
    // Don't fail if email errors
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { memberId } = await req.json()

  await supabaseAdmin
    .from('team_members')
    .delete()
    .eq('id', memberId)
    .eq('owner_id', user.id)

  return NextResponse.json({ success: true })
}
