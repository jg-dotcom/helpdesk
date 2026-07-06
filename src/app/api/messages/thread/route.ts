import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const channel = req.nextUrl.searchParams.get('channel')
  const businessId = req.nextUrl.searchParams.get('businessId')
  if (!channel || !businessId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  // Verify access
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const isOwner = !!biz && user.id === businessId

  if (!isOwner) {
    // Verify employee belongs to this business and can access this channel
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', user.email ?? '')
      .eq('user_id', businessId)
      .single()
    if (!emp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (channel !== 'general' && channel !== `dm_emp_${emp.id}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data: messages, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, sender_id, sender_name, content, created_at')
    .eq('business_id', businessId)
    .eq('channel', channel)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: messages ?? [] })
}
