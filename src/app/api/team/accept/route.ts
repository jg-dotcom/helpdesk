import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 })

  const { data: invite } = await supabaseAdmin
    .from('team_members')
    .select('id, member_email, owner_id, accepted_at')
    .eq('invite_token', token)
    .single()

  if (!invite) return NextResponse.json({ error: 'Invalid or expired invite.' }, { status: 404 })
  if (invite.accepted_at) return NextResponse.json({ error: 'Invite already accepted.' }, { status: 400 })

  // Get owner business name
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', invite.owner_id)
    .single()

  return NextResponse.json({
    memberEmail: invite.member_email,
    ownerName: biz?.business_name ?? null,
  })
}

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(authToken)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await req.json()

  const { data: invite } = await supabaseAdmin
    .from('team_members')
    .select('id, member_email')
    .eq('invite_token', token)
    .single()

  if (!invite) return NextResponse.json({ error: 'Invalid invite.' }, { status: 404 })

  await supabaseAdmin
    .from('team_members')
    .update({ member_user_id: user.id, accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ success: true })
}
