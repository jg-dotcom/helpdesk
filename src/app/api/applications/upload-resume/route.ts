import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export const runtime = 'nodejs'

// JAY-133 — public (unauthenticated) resume upload for the careers apply
// form. Goes through the service role so no public storage write policy is
// needed on the 'resumes' bucket — same reasoning as messages/upload/route.ts,
// just scoped to a job posting instead of a business/employee session.
const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx']

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const jobPostingId = formData.get('job_posting_id') as string | null

  if (!file || !jobPostingId) {
    return NextResponse.json({ error: 'Missing file or job_posting_id' }, { status: 400 })
  }

  // Re-verify the posting is real and still open, same guard as
  // POST /api/applications — a resume shouldn't be uploadable against a
  // closed or nonexistent posting.
  const { data: posting } = await supabaseAdmin
    .from('job_postings')
    .select('id, status')
    .eq('id', jobPostingId)
    .single()

  if (!posting || posting.status !== 'open') {
    return NextResponse.json({ error: 'This job posting is no longer accepting applications.' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'Please upload a PDF, DOC, or DOCX file.' }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "That file is over 10MB — try a smaller or compressed version." }, { status: 400 })
  }

  const path = `${jobPostingId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabaseAdmin.storage
    .from('resumes')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ path, fileName: file.name, fileSize: file.size })
}
