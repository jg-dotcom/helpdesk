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

    // Generate magic link to portal setup
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: employeeEmail,
      options: { redirectTo: `${appUrl}/portal` },
    })

    const setupLink = linkData?.properties?.action_link
    if (setupLink) {
      await resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: employeeEmail,
        subject: `${bizName} added you to their team`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
            <div style="font-size: 22px; font-weight: 800; margin-bottom: 24px;">
              help<span style="color: #185fa5;">desk</span>
            </div>
            <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 8px;">You've been added to ${bizName}</h2>
            <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 24px;">
              Hi ${employeeName.split(' ')[0]}, set up your employee account to view your schedule, clock in and out, and request time off. You'll also be prompted to complete any onboarding paperwork once you're in.
            </p>
            <a href="${setupLink}" style="display:inline-block;background:#185fa5;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
              Set up my account →
            </a>
            <p style="font-size: 12px; color: #999; line-height: 1.5;">
              This link expires in 1 hour. After signing in, bookmark <a href="${appUrl}/portal" style="color:#185fa5;">${appUrl}/portal</a> for future access.
            </p>
          </div>
        `,
      })
    }
  }

  return NextResponse.json({ token: link.token, url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
