import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../lib/supabaseAdmin'
import { getBearerUser } from '../../lib/apiAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Public: submit an application
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { job_posting_id, owner_id, name, email, phone, cover_letter, source, resume_path, resume_file_name } = body

  if (!job_posting_id || !owner_id || !name || !email) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // JAY-58 — job_posting_id/owner_id previously went straight from the
  // client-supplied body into the insert with no cross-check, so anyone who
  // could read a business's owner_id (trivially visible in every careers
  // URL/share link) could pair it with any job_posting_id — including one
  // belonging to a different business, or a job the owner has since closed.
  // Re-verify ownership and open status server-side, the same way the
  // careers page's own render query already does.
  const { data: posting } = await supabaseAdmin
    .from('job_postings')
    .select('id, user_id, status')
    .eq('id', job_posting_id)
    .single()

  if (!posting || posting.user_id !== owner_id || posting.status !== 'open') {
    return NextResponse.json({ error: 'This job posting is no longer accepting applications.' }, { status: 400 })
  }

  // JAY-119 — public endpoint had no duplicate-submission guard, so a
  // double-clicked Submit (or a script) could create N application rows for
  // the same candidate/posting pair with no dedup.
  const { data: existing } = await supabaseAdmin
    .from('job_applications')
    .select('id')
    .eq('job_posting_id', job_posting_id)
    .ilike('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You\'ve already applied to this position.' }, { status: 409 })
  }

  const { data: inserted, error } = await supabaseAdmin.from('job_applications').insert({
    job_posting_id,
    user_id: owner_id,
    name,
    email,
    phone: phone || null,
    cover_letter: cover_letter || null,
    source: source || null,
    status: 'applied',
    // JAY-133 — set by a prior POST /api/applications/upload-resume call;
    // resume_path is a private-bucket storage path, never a public URL.
    resume_path: resume_path || null,
    resume_file_name: resume_file_name || null,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: job } = await supabaseAdmin.from('job_postings').select('title').eq('id', job_posting_id).single()
  const { data: profile } = await supabaseAdmin.from('business_profiles').select('business_name').eq('user_id', owner_id).single()
  const jobTitle = job?.title ?? 'a role'
  const businessName = profile?.business_name || 'the team'

  // Notify owner — JAY-60: link routes the owner straight to Hiring instead
  // of leaving the notification as dead-end text.
  await supabaseAdmin.from('notifications').insert({
    user_id: owner_id,
    message: `New application from ${name} for ${jobTitle}.`,
    link: '/hiring',
  })

  // Confirmation email to candidate — day-zero acknowledgment, no next-step promise.
  // JAY-41: also includes a link to the read-only status-check page so the
  // candidate has a self-serve way to check in later instead of emailing the
  // business. Best-effort: don't fail the application submission if the email
  // send fails.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
    const statusUrl = `${appUrl}/applications/${inserted?.id}`
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: email,
      subject: `We received your application — ${jobTitle} at ${businessName}`,
      html: `
        <p>Hi ${name.split(' ')[0]},</p>
        <p>Thanks for applying to <strong>${jobTitle}</strong> at ${businessName}. We've received your application and it's in front of the hiring team now.</p>
        <p>We'll be in touch if there's a next step. You can also check your application status any time:</p>
        <p><a href="${statusUrl}" style="display:inline-block;padding:10px 18px;background:#185fa5;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Check status</a></p>
        <p>— ${businessName}</p>
      `,
    })
  } catch {
    // Non-fatal — application is already saved and owner is already notified.
  }

  return NextResponse.json({ success: true, id: inserted?.id })
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
