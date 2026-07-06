import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { channel, businessId, content } = await req.json()
  if (!channel || !businessId || !content?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Determine sender name + verify access
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('user_id, business_name')
    .eq('user_id', user.id)
    .maybeSingle()

  let senderName: string
  const isOwner = !!biz && user.id === businessId

  if (isOwner) {
    senderName = user.user_metadata?.full_name ?? biz.business_name ?? 'Owner'
  } else {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('email', user.email ?? '')
      .eq('user_id', businessId)
      .single()
    if (!emp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (channel !== 'general' && channel !== `dm_emp_${emp.id}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    senderName = emp.name
  }

  const { data: message, error } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      business_id: businessId,
      channel,
      sender_id: user.id,
      sender_name: senderName,
      content: content.trim(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message })
}
