import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'

// Which of this owner's employees have never signed in — i.e. never completed
// portal setup, so their original invite email is worth resending (JAY-28).
// No schema change: reads Supabase Auth's own last_sign_in_at instead of adding
// an "accepted" column (team_members.accepted_at exists but that table is a
// separate, unused co-owner-invite flow — the real invite path writes to
// `employees`, which has no equivalent field).
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, email')
    .eq('user_id', user.id)
    .neq('email', '')

  if (!employees?.length) return NextResponse.json({ pendingIds: [] })

  const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers()
  if (error || !authData) return NextResponse.json({ pendingIds: [] })

  const neverSignedInEmails = new Set(
    authData.users.filter(u => !u.last_sign_in_at).map(u => u.email?.toLowerCase())
  )

  const pendingIds = employees
    .filter(e => neverSignedInEmails.has(e.email.toLowerCase()))
    .map(e => e.id)

  return NextResponse.json({ pendingIds })
}
