import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { channel, businessId } = await req.json()
  if (!channel || !businessId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  await supabaseAdmin
    .from('chat_read_receipts')
    .upsert(
      { business_id: businessId, channel, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'business_id,channel,user_id' }
    )

  return NextResponse.json({ ok: true })
}
