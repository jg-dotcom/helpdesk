import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('business_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // Auto-create profile from user metadata if missing (happens after email confirmation)
  if (!data) {
    const meta = user.user_metadata ?? {}
    const businessName = meta.business_name as string | undefined
    const contactEmail = user.email ?? ''
    if (businessName) {
      await supabaseAdmin.from('business_profiles').upsert(
        { user_id: user.id, business_name: businessName, contact_email: contactEmail, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    }
    return NextResponse.json({ profile: businessName ? { user_id: user.id, business_name: businessName, contact_email: contactEmail } : null })
  }

  return NextResponse.json({ profile: data })
}

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { business_name, address, timezone, contact_email, logo_url, business_hours, accountant_email, weekly_labor_budget_cents } = body

  const { error } = await supabaseAdmin
    .from('business_profiles')
    .upsert({
      user_id: user.id,
      business_name,
      address,
      timezone,
      contact_email,
      logo_url: logo_url ?? null,
      business_hours: business_hours ?? null,
      accountant_email: accountant_email ?? null,
      // JAY-54 (prerequisite step) — nullable so "no budget set" stays distinct
      // from "$0 budget"; only written when the caller actually sent a value,
      // so unrelated saves (e.g. saveAccount, saveHours) never clobber it.
      ...(weekly_labor_budget_cents !== undefined ? { weekly_labor_budget_cents } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
