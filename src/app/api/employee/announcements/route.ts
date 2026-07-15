import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// Employee-facing read of their employer's announcements. Announcements are
// currently only ever sent as one-time emails (see /api/announcements) —
// this gives employees an in-app, revisitable feed of the same messages.
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('user_id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  const { data: announcements } = await supabaseAdmin
    .from('announcements')
    .select('id, title, message, created_at')
    .eq('user_id', employee.user_id)
    .order('created_at', { ascending: false })
    .limit(30)

  return NextResponse.json({ announcements: announcements ?? [] })
}
