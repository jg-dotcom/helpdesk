import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { employeeId } = await req.json()
  if (!employeeId) return NextResponse.json({ error: 'Missing employeeId' }, { status: 400 })

  // Verify employee belongs to this owner
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, role')
    .eq('id', employeeId)
    .eq('user_id', user.id)
    .single()

  if (!employee?.email) return NextResponse.json({ error: 'Employee not found or has no email.' }, { status: 404 })

  // Get business name
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', user.id)
    .single()

  const bizName = profile?.business_name ?? 'Your employer'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://helpdesk-iota-five.vercel.app'

  // Generate a magic link so employee can sign in without setting a password
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: employee.email,
    options: { redirectTo: `${appUrl}/portal` },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: linkErr?.message ?? 'Could not generate invite link.' }, { status: 500 })
  }

  const magicLink = linkData.properties.action_link

  // Send via Resend
  const { error: emailErr } = await resend.emails.send({
    from: 'Helpdesk <noreply@resend.dev>',
    to: employee.email,
    subject: `${bizName} invited you to the employee portal`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="font-size: 22px; font-weight: 800; margin-bottom: 24px;">
          help<span style="color: #185fa5;">desk</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">You're invited, ${employee.name.split(' ')[0]}!</h2>
        <p style="font-size: 14px; color: #555; line-height: 1.6; margin-bottom: 24px;">
          ${bizName} has invited you to the employee portal — your personal hub to view your schedule, clock in and out, check your hours, and request time off.
        </p>
        <a href="${magicLink}" style="display: inline-block; background: #185fa5; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-bottom: 24px;">
          Open my portal →
        </a>
        <p style="font-size: 12px; color: #999; line-height: 1.5;">
          This link expires in 1 hour and can only be used once. After signing in, bookmark the portal for future access at <a href="${appUrl}/portal" style="color: #185fa5;">${appUrl}/portal</a>.
        </p>
      </div>
    `,
  })

  if (emailErr) return NextResponse.json({ error: emailErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
