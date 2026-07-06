import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const authToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(authToken)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // Verify the onboarding link belongs to this employee
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', user.email)
    .single()

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id, employee_name, welcome_pack, user_id')
    .eq('token', token)
    .eq('employee_id', emp.id)
    .single()

  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  // Fetch docs
  const [{ data: empDocs }, { data: templateDocs }] = await Promise.all([
    supabaseAdmin.from('employee_documents').select('id, file_name, file_size, file_path, created_at').eq('employee_id', emp.id).order('created_at', { ascending: false }),
    supabaseAdmin.from('document_templates').select('id, file_name, file_size, file_path, created_at').eq('user_id', link.user_id).order('created_at', { ascending: false }),
  ])

  const allDocs = [...(templateDocs ?? []), ...(empDocs ?? [])]
  const docsWithUrls = await Promise.all(
    allDocs.map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage.from('documents').createSignedUrl(doc.file_path, 600)
      return { id: doc.id, file_name: doc.file_name, file_size: doc.file_size, url: signed?.signedUrl ?? null }
    })
  )

  return NextResponse.json({
    token,
    employeeId: link.employee_id,
    userId: link.user_id,
    employeeName: link.employee_name,
    welcomePack: link.welcome_pack,
    docs: docsWithUrls,
  })
}
