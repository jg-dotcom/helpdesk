import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

// Server-side signup that creates the user with email pre-confirmed,
// so no email confirmation flow is needed at all.
export async function POST(req: NextRequest) {
  const { email, password, fullName, businessName } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
  }

  // Try creating a brand-new user with email already confirmed
  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? '', business_name: businessName ?? '' },
  })

  if (!createError && createData.user) {
    return NextResponse.json({ success: true })
  }

  // If the user already exists, find them and confirm + update password
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }

  const existing = users.find(u => u.email === email)
  if (!existing) {
    // createUser failed for a reason other than duplicate
    return NextResponse.json({ error: createError?.message ?? 'Could not create account' }, { status: 400 })
  }

  // Update the existing user: confirm email + set the new password + update metadata
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    password,
    user_metadata: { full_name: fullName ?? '', business_name: businessName ?? '' },
  })

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
