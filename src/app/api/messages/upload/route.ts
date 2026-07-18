import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export const runtime = 'nodejs'

// POST multipart/form-data — upload a file attachment
export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  // JAY-112 — derive businessId server-side (same pattern as channels/route.ts)
  // instead of trusting the client-supplied value, which let a caller upload
  // into another business's storage prefix.
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  let businessId: string
  if (biz) {
    businessId = user.id
  } else {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('user_id')
      .eq('email', user.email ?? '')
      .single()
    if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    businessId = emp.user_id
  }

  const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const path = `${businessId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabaseAdmin.storage
    .from('message-attachments')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: urlData } = supabaseAdmin.storage.from('message-attachments').getPublicUrl(path)

  return NextResponse.json({
    file_name: file.name,
    file_type: file.type,
    file_size: file.size,
    storage_path: path,
    url: urlData.publicUrl,
  })
}
