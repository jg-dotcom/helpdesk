import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: link, error: linkError } = await supabaseAdmin
    .from('onboarding_links')
    .select('user_id, employee_id, employee_name')
    .eq('token', token)
    .single()

  if (linkError || !link) {
    return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 404 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 10MB.' }, { status: 400 })
  }

  const filePath = `${link.user_id}/${link.employee_id}/${Date.now()}_${file.name}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await supabaseAdmin.storage
    .from('documents')
    .upload(filePath, fileBuffer, { contentType: file.type })

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
  }

  const { error: dbError } = await supabaseAdmin.from('employee_documents').insert([{
    user_id: link.user_id,
    employee_id: link.employee_id,
    employee_name: link.employee_name,
    file_name: file.name,
    file_path: filePath,
    file_size: file.size,
  }])

  if (dbError) {
    return NextResponse.json({ error: 'Error saving file record.' }, { status: 500 })
  }

  // In-platform notification + email
  try {
    const message = `${link.employee_name} uploaded ${file.name}`
    await supabaseAdmin.from('notifications').insert([{ user_id: link.user_id, message }])

    const { data: ownerData } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
    const ownerEmail = ownerData?.user?.email
    if (ownerEmail) {
      await resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: ownerEmail,
        subject: `${link.employee_name} uploaded a document`,
        html: `<p><strong>${link.employee_name}</strong> just uploaded <strong>${file.name}</strong> to their onboarding pack.</p><p>Log in to Helpdesk to review it.</p>`,
      })
    }
  } catch {
    // Don't fail the upload if notifications fail
  }

  return NextResponse.json({ success: true })
}
