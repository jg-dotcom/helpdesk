import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabaseAdmin'
import { getBearerUser } from '../../lib/apiAuth'

// Public: submit an application
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { job_posting_id, owner_id, name, email, phone, cover_letter, source } = body

  if (!job_posting_id || !owner_id || !name || !email) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('job_applications').insert({
    job_posting_id,
    user_id: owner_id,
    name,
    email,
    phone: phone || null,
    cover_letter: cover_letter || null,
    source: source || null,
    status: 'applied',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify owner
  await supabaseAdmin.from('notifications').insert({
    user_id: owner_id,
    message: `New application from ${name} for ${(await supabaseAdmin.from('job_postings').select('title').eq('id', job_posting_id).single()).data?.title ?? 'a role'}.`,
  })

  return NextResponse.json({ success: true })
}

// Owner: list applications
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = req.nextUrl.searchParams.get('job_id')

  let query = supabaseAdmin
    .from('job_applications')
    .select('*, job_postings(title)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (jobId) query = query.eq('job_posting_id', jobId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ applications: data ?? [] })
}
