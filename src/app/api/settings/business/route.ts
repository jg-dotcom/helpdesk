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
  const { business_name, address, timezone, contact_email, logo_url, business_hours, accountant_email, weekly_labor_budget_cents, geofence_lat, geofence_lng, geofence_radius_m, require_clockin_photo, pto_accrual_method, pto_accrual_rate, pto_rollover_cap, minor_curfew_hour, minor_max_daily_hours } = body

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
      // JAY-18 — same "only write when actually sent" pattern as the labor
      // budget above, so unrelated saves elsewhere in Settings don't clobber
      // the geofence/photo-requirement configuration.
      ...(geofence_lat !== undefined ? { geofence_lat } : {}),
      ...(geofence_lng !== undefined ? { geofence_lng } : {}),
      ...(geofence_radius_m !== undefined ? { geofence_radius_m } : {}),
      ...(require_clockin_photo !== undefined ? { require_clockin_photo } : {}),
      // JAY-123 — same "only write when actually sent" pattern, so this
      // save doesn't clobber the PTO policy when called from an unrelated
      // Settings section.
      ...(pto_accrual_method !== undefined ? { pto_accrual_method } : {}),
      ...(pto_accrual_rate !== undefined ? { pto_accrual_rate } : {}),
      ...(pto_rollover_cap !== undefined ? { pto_rollover_cap } : {}),
      // JAY-168 — same "only write when actually sent" pattern, so this save
      // doesn't clobber the minor-labor settings when called from an
      // unrelated Settings section.
      ...(minor_curfew_hour !== undefined ? { minor_curfew_hour } : {}),
      ...(minor_max_daily_hours !== undefined ? { minor_max_daily_hours } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
