import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

// Public: a new hire submits their own info via the join link (JAY-29), instead
// of the owner typing an invite email in Settings. Creates the same minimal
// pending `employees` row that POST /api/team/invite creates, defaulting to the
// 'employee' access role — the owner assigns role/pay rate afterward from the
// employee panel. No setup-invite email is sent here since the person already
// just submitted the form themselves; the owner is notified instead.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { owner_id, name, email, phone } = body

  if (!owner_id || !name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()

  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('user_id', owner_id)
    .eq('email', cleanEmail)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'This email is already associated with the team.' }, { status: 409 })
  }

  const { error: insertErr } = await supabaseAdmin
    .from('employees')
    .insert([{
      user_id: owner_id,
      name: name.trim(),
      email: cleanEmail,
      phone: phone?.trim() || null,
      role: 'employee',
      access_role: 'employee',
      status: 'active',
      type: 'Full-time',
      pay_type: 'hourly',
      pay_rate: null,
      pay_period: 'biweekly',
      i9_status: 'pending',
      w4_status: 'pending',
      direct_deposit_status: 'pending',
    }])

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Best-effort owner notification — don't fail the submission if this errors.
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: owner_id,
      message: `${name.trim()} joined via your team join link.`,
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true })
}
