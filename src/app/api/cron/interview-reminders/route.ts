import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

// Vercel Cron target — see vercel.json ("0 * * * *", hourly). Not user-triggered, so
// auth is a shared secret (CRON_SECRET env var) instead of a bearer user token.
//
// Window: interviews starting 24-25h from now. Assuming the cron runs hourly, each
// interview_at falls into this window exactly once, so no "already sent" tracking is
// needed — zero new tables, per the issue's own validation gut-check. If a run is
// missed, that one reminder is simply skipped rather than sent late/duplicated.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const windowStart = new Date(now + 24 * 3600000).toISOString()
  const windowEnd = new Date(now + 25 * 3600000).toISOString()

  const { data: applications, error } = await supabaseAdmin
    .from('job_applications')
    .select('id, name, email, user_id, job_posting_id, interview_at')
    .not('interview_at', 'is', null)
    .gte('interview_at', windowStart)
    .lt('interview_at', windowEnd)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!applications?.length) return NextResponse.json({ sent: 0 })

  const resend = new Resend(process.env.RESEND_API_KEY)
  let sent = 0

  for (const app of applications) {
    const [{ data: job }, { data: profile }] = await Promise.all([
      supabaseAdmin.from('job_postings').select('title, location').eq('id', app.job_posting_id).single(),
      supabaseAdmin.from('business_profiles').select('business_name, contact_email').eq('user_id', app.user_id).single(),
    ])

    const jobTitle = job?.title ?? 'the role'
    const businessName = profile?.business_name || 'the team'
    const when = new Date(app.interview_at)
    const dateLabel = when.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    const timeLabel = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const locationLine = job?.location ? `<p>📍 ${job.location}</p>` : ''

    const results = await Promise.allSettled([
      app.email
        ? resend.emails.send({
            from: 'Helpdesk <onboarding@resend.dev>',
            to: app.email,
            subject: `Reminder: your interview tomorrow at ${timeLabel}`,
            html: `
              <p>Hi ${app.name.split(' ')[0]},</p>
              <p>Just a reminder — your interview for the <strong>${jobTitle}</strong> position at ${businessName} is tomorrow, ${dateLabel}, at ${timeLabel}.</p>
              ${locationLine}
              <p>See you then!</p>
            `,
          })
        : Promise.resolve(null),
      profile?.contact_email
        ? resend.emails.send({
            from: 'Helpdesk <onboarding@resend.dev>',
            to: profile.contact_email,
            subject: `Reminder: interview with ${app.name} tomorrow at ${timeLabel}`,
            html: `
              <p>Reminder — your interview with <strong>${app.name}</strong> for the ${jobTitle} position is tomorrow, ${dateLabel}, at ${timeLabel}.</p>
              ${locationLine}
            `,
          })
        : Promise.resolve(null),
    ])

    if (results.some(r => r.status === 'fulfilled' && r.value)) sent++
  }

  return NextResponse.json({ sent, checked: applications.length })
}
