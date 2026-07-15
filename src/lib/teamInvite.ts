import { Resend } from 'resend'
import { supabaseAdmin } from '../app/lib/supabaseAdmin'

const resend = new Resend(process.env.RESEND_API_KEY)

// Shared by POST /api/team/invite (first invite) and POST /api/team/invite/resend
// (JAY-28) — generates a fresh magic link and emails it. Pulled out so "resend" is
// a real re-run of the same logic, not a near-duplicate copy that can drift.
export async function sendSetupInviteEmail(email: string, accessRole: string, bizName: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let inviteUrl = `${appUrl}/portal/setup`
  try {
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/portal/setup` },
    })
    if (linkData?.properties?.action_link) inviteUrl = linkData.properties.action_link
  } catch { /* fall back to setup page URL */ }

  await resend.emails.send({
    from: 'Helpdesk <onboarding@resend.dev>',
    to: email,
    subject: `You've been added to ${bizName} on Helpdesk`,
    html: `
      <p>You've been added to <strong>${bizName}</strong> on Helpdesk as a <strong>${accessRole}</strong>.</p>
      <p>Click below to set up your account and get access:</p>
      <p><a href="${inviteUrl}" style="background:#185fa5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">Set up my account</a></p>
      <p style="color:#888;font-size:12px;margin-top:16px;">This link expires in 1 hour. After setting up, sign in at ${appUrl}/login</p>
    `,
  })
}

// Whether an employee has ever completed portal setup (signed in at all). No schema
// change — Supabase Auth already tracks last_sign_in_at per user; we just read it
// instead of adding a new "accepted" column. Used to decide when to show "Resend
// invite" (JAY-28) instead of the unused/disconnected `team_members.accepted_at`
// the original idea assumed was wired up (it isn't — team_members is a separate,
// unused co-owner-invite table; the real invite flow writes to `employees`).
export async function hasNeverSignedIn(email: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers()
  if (error || !data) return false
  const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) return false
  return !user.last_sign_in_at
}
