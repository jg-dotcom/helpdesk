import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { refreshAccessToken, createCalendarEvent } from '../../../../lib/googleCalendar'

const VALID_STATUSES = ['applied', 'interviewing', 'offer', 'hired', 'rejected']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { status, interview_at, timeZone, jobTitle, notify } = await req.json()

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }
  if (status === undefined && interview_at === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status !== undefined) update.status = status
  if (interview_at !== undefined) update.interview_at = interview_at

  // Scheduling an interview needs the candidate's name/email for the calendar invite,
  // and declining-with-notify needs the same fields for the email — fetched only when
  // relevant, so a plain status change (the common case) stays a single query like before.
  let candidate: { name: string; email: string } | null = null
  if (interview_at || (status === 'rejected' && notify)) {
    const { data } = await supabaseAdmin
      .from('job_applications')
      .select('name, email')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    candidate = data
  }

  const { error } = await supabaseAdmin
    .from('job_applications')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // "Decline & notify" — opt-in per action (the owner explicitly chooses this button
  // rather than a silent default), not a persisted Settings toggle. A global toggle
  // would need a new business_profiles column; this keeps the feature at zero schema
  // change, matching the issue's own tier. Best-effort: a failed send never blocks the
  // status change, which has already been saved above.
  let notified = false
  if (status === 'rejected' && notify && candidate?.email) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: candidate.email,
        subject: jobTitle ? `Update on your application for ${jobTitle}` : 'Update on your application',
        html: `
          <p>Hi ${candidate.name.split(' ')[0]},</p>
          <p>Thanks for applying${jobTitle ? ` for the ${jobTitle} position` : ''} and for your time throughout the process. We've decided to move forward with other candidates for this role.</p>
          <p>We appreciate your interest and wish you the best in your search.</p>
        `,
      })
      notified = true
    } catch {
      // Non-fatal — the status change already succeeded.
    }
  }

  // Best-effort Google Calendar sync — an interview time is saved either way; the
  // calendar event is a bonus if the owner has connected their calendar.
  let calendarSynced = false
  if (interview_at && candidate?.email) {
    try {
      const { data: conn } = await supabaseAdmin
        .from('google_connections')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (conn) {
        let accessToken = conn.access_token
        if (new Date(conn.access_token_expires_at) <= new Date()) {
          const refreshed = await refreshAccessToken(conn.refresh_token)
          accessToken = refreshed.access_token
          const expiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString()
          await supabaseAdmin
            .from('google_connections')
            .update({ access_token: accessToken, access_token_expires_at: expiresAt })
            .eq('user_id', user.id)
        }

        const start = new Date(interview_at)
        const end = new Date(start.getTime() + 30 * 60 * 1000)
        const dateStr = start.toISOString().slice(0, 10)
        const startTime = start.toISOString().slice(11, 19)
        const endTime = end.toISOString().slice(11, 19)

        await createCalendarEvent(
          accessToken,
          `Interview: ${candidate.name}`,
          jobTitle ? `Interview for ${jobTitle}` : 'Interview',
          dateStr, startTime, endTime,
          timeZone ?? 'America/New_York',
          [candidate.email],
        )
        calendarSynced = true
      }
    } catch {
      // Calendar sync is a bonus, not a requirement — the interview time is already saved.
    }
  }

  return NextResponse.json({ success: true, calendarSynced, notified })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('job_applications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
