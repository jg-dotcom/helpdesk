import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  const { data: swaps } = await supabaseAdmin
    .from('shift_swaps')
    .select('id, requester_shift_id, target_shift_id, target_employee_id, status, notes, created_at')
    .eq('requester_employee_id', employee.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // JAY-86 — "seen by owner" read receipt, same pseudo-channel pattern as
  // time-off requests (`swap:<id>`); see employee/time-off/route.ts.
  const ids = (swaps ?? []).map(s => s.id)
  let receipts: { channel: string; last_read_at: string }[] = []
  if (ids.length > 0) {
    const { data } = await supabaseAdmin
      .from('chat_read_receipts')
      .select('channel, last_read_at')
      .eq('business_id', employee.user_id)
      .in('channel', ids.map(id => `swap:${id}`))
    receipts = data ?? []
  }
  const seenAt = new Map(receipts.map(r => [r.channel, r.last_read_at]))
  const withSeen = (swaps ?? []).map(s => ({
    ...s,
    seen: seenAt.has(`swap:${s.id}`),
    seenAt: seenAt.get(`swap:${s.id}`) ?? null,
  }))

  return NextResponse.json({ swaps: withSeen })
}
