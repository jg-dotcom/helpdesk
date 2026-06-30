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

  const { title, message } = await req.json()
  if (!title?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'Title and message are required.' }, { status: 400 })
  }

  // Save announcement
  const { error: insertError } = await supabaseAdmin
    .from('announcements')
    .insert([{ user_id: userId, title: title.trim(), message: message.trim() }])

  if (insertError) return NextResponse.json({ error: 'Could not save announcement.' }, { status: 500 })

  // Get all employees with emails
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('name, email')
    .eq('user_id', userId)
    .eq('status', 'active')
    .neq('email', '')

  const emailList = (employees || []).filter(e => e.email)

  if (emailList.length > 0) {
    await Promise.allSettled(
      emailList.map(emp =>
        resend.emails.send({
          from: 'Helpdesk <onboarding@resend.dev>',
          to: emp.email,
          subject: title.trim(),
          html: `
            <p>Hi ${emp.name.split(' ')[0]},</p>
            <p>${message.trim().replace(/\n/g, '<br>')}</p>
          `,
        })
      )
    )
  }

  return NextResponse.json({ success: true, sent: emailList.length })
}
