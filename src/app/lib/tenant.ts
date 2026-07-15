import { supabase } from './supabase'

// JAY-50 — the dashboard tenant-resolution logic that `src/app/page.tsx` already
// implements correctly (owners use their own session id; invited admins/managers
// use the OWNER's id, found via their `employees` row's `user_id` column, matched
// by email). Pulled out here so other dashboard pages can share it instead of
// each independently using `session.user.id` directly, which is what caused
// JAY-50: an invited admin/manager's own new auth id is never the tenant id, so
// any page that skips this resolution silently queries an empty tenant.
//
// Correction to the original ticket: it named `team_members.member_user_id` as
// the unused linkage. That table is actually dead/unused co-owner-invite code
// (documented in src/lib/teamInvite.ts) — the real invite flow writes an
// `employees` row keyed by email with `user_id` already set to the owner's id
// at invite time. That's the value this resolves and returns.
export type TenantContext = {
  tenantId: string
  viewerRole: 'owner' | 'admin' | 'manager'
  viewerPerms: Record<string, boolean> | null
}

export async function resolveTenantContext(sessionUserId: string, sessionEmail: string | undefined): Promise<TenantContext | null> {
  const { data: biz } = await supabase
    .from('business_profiles')
    .select('user_id')
    .eq('user_id', sessionUserId)
    .single()

  if (biz) {
    return { tenantId: sessionUserId, viewerRole: 'owner', viewerPerms: null }
  }

  const { data: emp } = await supabase
    .from('employees')
    .select('user_id, access_role, permissions')
    .eq('email', sessionEmail ?? '')
    .single()

  if (!emp) return null

  const accessRole = emp.access_role as 'admin' | 'manager' | 'employee'
  if (accessRole === 'employee') return null // regular employees use /portal, not this

  return {
    tenantId: emp.user_id,
    viewerRole: accessRole,
    viewerPerms: (emp.permissions as Record<string, boolean> | null) ?? null,
  }
}
