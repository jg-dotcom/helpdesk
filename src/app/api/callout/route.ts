import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.replace('Bearer ', '')
  if (!accessToken) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken)
  if (userError || !userData.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const userId = userData.user.id

  const { shiftId, shiftDate, startTime, endTime, calledOutEmployeeId, eligibleEmployeeIds } = await req.json()

  // Mark shift as called_out AND open it in the same claim pool the app's own
  // "claim shift" flow already reads from (is_open_shift + no employee_id) — see
  // POST /api/employee/claim-shift. Previously this only set `status`, so the shift
  // was never actually claimable through the app; resolution happened off-platform
  // via email replies. Now the email and the in-app claim flow are the same system.
  if (shiftId) {
    await supabaseAdmin
      .from('shifts')
      .update({ status: 'called_out', is_open_shift: true, employee_id: null })
      .eq('id', shiftId)
      .eq('user_id', userId)
  }

  if (!eligibleEmployeeIds?.length) {
    return NextResponse.json({ success: true, sent: 0 })
  }

  // Get eligible employees with emails
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name, email')
    .eq('user_id', userId)
    .in('id', eligibleEmployeeIds)
    .neq('email', '')

  // Get called-out employee name for the message
  const { data: calledOut } = calledOutEmployeeId
    ? await supabaseAdmin.from('employees').select('name').eq('id', calledOutEmployeeId).single()
    : { data: null }

  const emailList = (employees || []).filter(e => e.email)

  const shiftLabel = `${formatDate(shiftDate)} from ${formatTime(startTime)} to ${formatTime(endTime)}`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
  const claimUrl = `${appUrl}/portal`

  if (emailList.length > 0) {
    await Promise.allSettled(
      emailList.map(emp =>
        resend.emails.send({
          from: 'Helpdesk <onboarding@resend.dev>',
          to: emp.email,
          subject: `Shift coverage needed — ${shiftLabel}`,
          html: `
            <p>Hi ${emp.name.split(' ')[0]},</p>
            <p>We have an open shift that needs coverage:</p>
            <p><strong>${shiftLabel}</strong>${calledOut ? ` (${calledOut.name} is unavailable)` : ''}</p>
            <p><a href="${claimUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Claim this shift</a></p>
            <p>First to claim it in the app gets it — no need to reply or track down a manager.</p>
          `,
        })
      )
    )
  }

  return NextResponse.json({ success: true, sent: emailList.length })
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(t: string) {
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}
