import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { resolveTenantContextServer } from '../../../lib/tenantServer'

// JAY-138 — lightweight, tenant-aware branding lookup for the sidebar (Nav.tsx).
// Deliberately separate from GET /api/settings/business, which only ever
// returns the signed-in user's own business_profiles row — fine for the
// Settings page (owner-only), but the sidebar renders for admins/managers
// too, whose own auth id is never the tenant id. This resolves the real
// tenant first (same rule used everywhere else: owners use their own id,
// invited admins/managers use the owning employees row's user_id).
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await resolveTenantContextServer(user.id, user.email)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name, logo_url')
    .eq('user_id', ctx.tenantId)
    .single()

  return NextResponse.json({
    business_name: data?.business_name ?? null,
    logo_url: data?.logo_url ?? null,
  })
}
