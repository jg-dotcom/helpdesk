import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { formType, formData, employeeId, userId } = await req.json()

  if (!formType || !formData || !employeeId || !userId) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  // Verify token is valid
  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id, user_id')
    .eq('token', token)
    .single()

  if (!link) return NextResponse.json({ error: 'Invalid link.' }, { status: 404 })

  // Upsert so re-submissions overwrite
  const { data: existing } = await supabaseAdmin
    .from('employee_forms')
    .select('id')
    .eq('employee_id', link.employee_id)
    .eq('form_type', formType)
    .single()

  if (existing) {
    await supabaseAdmin
      .from('employee_forms')
      .update({ form_data: formData, submitted_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabaseAdmin.from('employee_forms').insert([{
      employee_id: link.employee_id,
      user_id: link.user_id,
      form_type: formType,
      form_data: formData,
    }])
  }

  // Update compliance status
  if (formType === 'i9') {
    await supabaseAdmin.from('employees').update({ i9_status: 'complete' }).eq('id', link.employee_id)
  }
  if (formType === 'w4') {
    await supabaseAdmin.from('employees').update({ w4_status: 'complete' }).eq('id', link.employee_id)
  }
  if (formType === 'direct_deposit') {
    await supabaseAdmin.from('employees').update({ direct_deposit_status: 'complete' }).eq('id', link.employee_id)
  }

  // Notify owner
  const { data: emp } = await supabaseAdmin.from('employees').select('name').eq('id', link.employee_id).single()
  await supabaseAdmin.from('notifications').insert([{
    user_id: link.user_id,
    message: `${emp?.name || 'An employee'} submitted their ${formType.toUpperCase()}.`,
    read: false,
  }])

  return NextResponse.json({ success: true })
}
