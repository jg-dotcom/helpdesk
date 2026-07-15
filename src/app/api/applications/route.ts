import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
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

  const { data: job } = await supabaseAdmin.from('job_postings').select('title').eq('id', job_posting_id).single()
  const { data: profile } = await supabaseAdmin.from('business_profiles').select('business_name').eq('user_id', owner_id).single()
  const jobTitle = job?.title ?? 'a role'
  const businessName = profile?.business_name || 'the team'

  // Notify owner
  await supabaseAdmin.from('notifications').insert({
    user_id: owner_id,
    message: `New application from ${name} for ${jobTitle}.`,
  })

  // Confirmation email to candidate — day-zero acknowledgment, no next-step promise.
  // Best-effort: don't fail the application submission if the email send fails.
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Helpdesk <onboarding@resend.dev>',
      to: email,
      subject: `We received your application — ${jobTitle} at ${businessName}`,
      html: `
        <p>Hi ${name.split(' ')[0]},</p>
        <p>Thanks for applying to <strong>${jobTitle}</strong> at ${businessName}. We've received your application and it's in front of the hiring team now.</p>
        <p>We'll be in touch if there's a next step.</p>
        <p>— ${businessName}</p>
      `,
    })
  } catch {
    // Non-fatal — application is already saved and owner is already notified.
  }

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
