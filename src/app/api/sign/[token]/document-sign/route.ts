import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { documentTemplateId, fileName, signedName } = await req.json()

  if (!documentTemplateId || !fileName || !signedName?.trim()) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id, user_id')
    .eq('token', token)
    .single()

  if (!link) return NextResponse.json({ error: 'Invalid link.' }, { status: 404 })

  // Upsert — re-signing overwrites
  const { data: existing } = await supabaseAdmin
    .from('document_signatures')
    .select('id')
    .eq('employee_id', link.employee_id)
    .eq('document_template_id', documentTemplateId)
    .single()

  if (existing) {
    await supabaseAdmin
      .from('document_signatures')
      .update({ signed_name: signedName.trim(), signed_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabaseAdmin.from('document_signatures').insert([{
      user_id: link.user_id,
      employee_id: link.employee_id,
      document_template_id: documentTemplateId,
      file_name: fileName,
      signed_name: signedName.trim(),
    }])
  }

  return NextResponse.json({ success: true })
}
