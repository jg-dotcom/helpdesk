import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'

// Owner-facing "seen by N of M" for an announcement — see JAY-27. Reuses
// chat_read_receipts (already used for message channels) with the announcement
// tracked as a pseudo-channel `announcement:<id>`, no schema change. The read
// receipts themselves are written by the employee portal when it loads the
// announcements feed (src/app/portal/page.tsx), not by this route.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: announcement } = await supabaseAdmin
    .from('announcements')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!announcement) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const [{ count: totalEmployees }, { count: seenCount }] = await Promise.all([
    supabaseAdmin
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .neq('email', ''),
    supabaseAdmin
      .from('chat_read_receipts')
      .select('user_id', { count: 'exact', head: true })
      .eq('business_id', user.id)
      .eq('channel', `announcement:${id}`),
  ])

  return NextResponse.json({ seenCount: seenCount ?? 0, totalEmployees: totalEmployees ?? 0 })
}
