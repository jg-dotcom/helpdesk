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
  const url = `${origin}/sign/${link.token}`

  if (employeeEmail) {
    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: employeeEmail,
      subject: `Your onboarding pack is ready, ${employeeName}`,
      html: `
        <p>Hi ${employeeName},</p>
        <p>Your welcome pack is ready. Click the link below to view it, review any documents, and upload anything that needs to be signed.</p>
        <p><a href="${url}" style="background:#185fa5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">View my onboarding pack</a></p>
        <p style="color:#888;font-size:13px;">This link is unique to you. No account needed.</p>
      `,
    })
  }

  return NextResponse.json({ token: link.token, url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
