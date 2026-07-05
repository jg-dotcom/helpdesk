import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.replace('Bearer ', '')
  if (!accessToken) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken)
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const userId = userData.user.id

  const { employeeId, employeeName, welcomePack, employeeEmail } = await req.json()
  if (!employeeId || !employeeName) {
    return NextResponse.json({ error: 'Missing employee info.' }, { status: 400 })
  }

  const { data: employee, error: empError } = await supabaseAdmin
    .from('employees')
    .select('id, user_id')
    .eq('id', employeeId)
    .single()

  if (empError || !employee || employee.user_id !== userId) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })
  }

  const { data: link, error: insertError } = await supabaseAdmin
    .from('onboarding_links')
    .insert([{
      user_id: userId,
      employee_id: employeeId,
      employee_name: employeeName,
      welcome_pack: welcomePack || '',
    }])
    .select('token')
    .single()

  if (insertError || !link) {
    return NextResponse.json({ error: 'Could not create link.' }, { status: 500 })
  }

  const origin = req.headers.get('origin') || new URL(req.url).origin
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const url = `${origin}/sign/${link.token}`

  if (employeeEmail) {
    // Get business name for email
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('business_name')
      .eq('user_id', userId)
      .single()
    const bizName = profile?.business_name ?? 'Your employer'

    // Generate portal magic link so employee can log in right away
    let portalLinkHtml = ''
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: employeeEmail,
      options: { redirectTo: `${appUrl}/portal` },
    })
    if (linkData?.properties?.action_link) {
      const magicLink = linkData.properties.action_link
      portalLinkHtml = `
        <tr><td style="padding: 0 0 24px;">
          <p style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #111;">Step 2 — Access your employee portal</p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #555; line-height: 1.6;">
            View your schedule, clock in and out, check your hours, and request time off — all in one place.
          </p>
          <a href="${magicLink}" style="display:inline-block;background:#185fa5;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
            Open my portal →
          </a>
          <p style="margin: 10px 0 0; font-size: 12px; color: #999;">This link expires in 1 hour. After signing in, bookmark the portal for easy access.</p>
        </td></tr>
      `
    }

    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: employeeEmail,
      subject: `Welcome to ${bizName}, ${employeeName}!`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px;">
          <div style="font-size: 22px; font-weight: 800; margin-bottom: 24px;">
            help<span style="color: #185fa5;">desk</span>
          </div>
          <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Welcome, ${employeeName.split(' ')[0]}!</h2>
          <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 28px;">
            ${bizName} has added you to their team. Here's everything you need to get started.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding: 0 0 24px; border-bottom: 1px solid #eee; margin-bottom: 24px;">
              <p style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #111;">Step 1 — Complete your onboarding</p>
              <p style="margin: 0 0 16px; font-size: 14px; color: #555; line-height: 1.6;">
                Review your welcome pack, sign any required documents, and upload anything requested by your employer.
              </p>
              <a href="${url}" style="display:inline-block;background:#0f1923;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
                View my onboarding pack →
              </a>
              <p style="margin: 10px 0 0; font-size: 12px; color: #999;">No account needed — this link is unique to you.</p>
            </td></tr>
            ${portalLinkHtml}
          </table>
        </div>
      `,
    })
  }

  return NextResponse.json({ token: link.token, url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
