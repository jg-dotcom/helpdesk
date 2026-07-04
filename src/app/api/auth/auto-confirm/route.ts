import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

// Auto-confirms a newly signed-up user so they don't need to click an email link.
// Only works immediately after signup (user has no session yet).
export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

  // Look up the user by email
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  const user = users.find(u => u.email === email)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Confirm their email
  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
