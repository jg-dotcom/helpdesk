import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { encryptField, last4 } from '../../../../lib/fieldEncryption'
import { isValidRoutingNumber } from '../../../../../lib/routingNumber'

// JAY-63 — bank routing/account numbers were previously written to
// form_data verbatim, in plain text, despite the form's own copy claiming
// "your information is encrypted." Encrypt the two sensitive fields before
// they ever reach the insert/update below; store only a last-4 alongside the
// ciphertext so the masked default view (EmployeePanel.tsx) never needs to
// touch the encryption key at all — only the explicit "Reveal" action does.
const SENSITIVE_FIELDS = ['routingNumber', 'accountNumber'] as const

function encryptSensitiveFields(formType: string, formData: Record<string, unknown>): Record<string, unknown> {
  if (formType !== 'direct_deposit') return formData
  const result: Record<string, unknown> = { ...formData }
  for (const field of SENSITIVE_FIELDS) {
    const value = result[field]
    if (typeof value !== 'string' || !value) continue
    result[`${field}_encrypted`] = encryptField(value)
    result[`${field}_last4`] = last4(value)
    delete result[field]
  }
  // confirmAccountNumber is a client-side-only confirmation field — never
  // meant to be persisted at all, encrypted or otherwise.
  delete result.confirmAccountNumber
  return result
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { formType, formData: rawFormData, employeeId, userId } = await req.json()

  if (!formType || !rawFormData || !employeeId || !userId) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  // JAY-65 — the client-side check can't be trusted alone (any direct API
  // call bypasses it entirely); re-validate the ABA routing-number checksum
  // here before ever encrypting/persisting it, so a transposed-digit typo
  // that happens to be 9 digits still gets caught server-side.
  if (formType === 'direct_deposit' && typeof rawFormData.routingNumber === 'string' && !isValidRoutingNumber(rawFormData.routingNumber)) {
    return NextResponse.json({ error: "This doesn't look like a valid routing number — please double-check with your bank." }, { status: 400 })
  }

  const formData = encryptSensitiveFields(formType, rawFormData)

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
