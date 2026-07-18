import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'

// JAY-133 — the 'resumes' bucket is private, so viewing a resume from the
// Hiring page goes through this authenticated, ownership-checked route
// (service role generates the signed URL) rather than the browser calling
// Supabase Storage directly — avoids needing a new storage RLS policy.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: app } = await supabaseAdmin
    .from('job_applications')
    .select('resume_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!app.resume_path) return NextResponse.json({ error: 'No resume on file for this application.' }, { status: 404 })

  const { data, error } = await supabaseAdmin.storage
    .from('resumes')
    .createSignedUrl(app.resume_path, 60)

  if (error || !data) return NextResponse.json({ error: 'Could not generate a link to the resume.' }, { status: 500 })

  return NextResponse.json({ url: data.signedUrl })
}
