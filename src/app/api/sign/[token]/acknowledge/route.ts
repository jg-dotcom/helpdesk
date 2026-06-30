import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { token } = await params
  const { signatureName } = await req.json()

  if (!signatureName?.trim()) {
    return NextResponse.json({ error: 'Signature name is required.' }, { status: 400 })
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from('onboarding_links')
    .select('id, user_id, employee_name')
    .eq('token', token)
    .single()

  if (linkError || !link) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('onboarding_links')
    .update({
      acknowledged_at: new Date().toISOString(),
      signature_name: signatureName.trim(),
    })
    .eq('token', token)

  if (error) {
    return NextResponse.json({ error: 'Could not save acknowledgment.' }, { status: 500 })
  }

  // In-platform notification + email
  try {
    const message = `${link.employee_name} signed their welcome pack`
    await supabaseAdmin.from('notifications').insert([{ user_id: link.user_id, message }])

    const { data: ownerData } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
    const ownerEmail = ownerData?.user?.email
    if (ownerEmail) {
      await resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: ownerEmail,
        subject: `${link.employee_name} signed their welcome pack`,
        html: `<p><strong>${link.employee_name}</strong> has reviewed and signed their welcome pack.</p><p>Signed as: <strong>${signatureName.trim()}</strong></p><p>Log in to Helpdesk to view their completed onboarding.</p>`,
      })
    }
  } catch {
    // Don't fail if notifications error
  }

  return NextResponse.json({ success: true })
}
