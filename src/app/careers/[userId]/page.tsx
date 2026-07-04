import { createClient } from '@supabase/supabase-js'
import { formatPayRange } from '../../../lib/jobs'
import type { JobPosting } from '../../../lib/jobs'
import ApplyForm from '../ApplyForm'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

async function getBusinessName(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', userId)
    .single()
  return data?.business_name ?? null
}

async function getOpenJobs(userId: string): Promise<JobPosting[]> {
  const { data } = await supabaseAdmin
    .from('job_postings')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  return data ?? []
}

export default async function CareersPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const [businessName, jobs] = await Promise.all([
    getBusinessName(userId),
    getOpenJobs(userId),
  ])

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto', padding: '2rem 1rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#151823', marginBottom: '0.5rem' }}>
            {businessName ? `${businessName} — Open roles` : 'Open roles'}
          </div>
          <div style={{ color: '#666', fontSize: '15px' }}>
            {jobs.length === 0
              ? 'No open positions at this time. Check back soon!'
              : `${jobs.length} open position${jobs.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {/* Job cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {jobs.map(job => (
            <div key={job.id} id={`job-${job.id}`} style={{ background: '#fff', border: '1px solid #dde1ea', borderRadius: '10px', padding: '1.25rem 1.5rem' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#151823', marginBottom: '0.35rem' }}>
                {job.title}
              </div>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {job.employment_type && <span>{job.employment_type}</span>}
                {job.location && <span>📍 {job.location}</span>}
                {(job.pay_min || job.pay_max) && (
                  <span>💰 {formatPayRange(job.pay_min, job.pay_max, job.pay_period)}</span>
                )}
              </div>
              {job.description && (
                <div style={{ fontSize: '14px', color: '#333', lineHeight: '1.6', marginBottom: job.requirements ? '0.75rem' : 0, whiteSpace: 'pre-wrap' }}>
                  {job.description}
                </div>
              )}
              {job.requirements && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>Requirements</div>
                  <div style={{ fontSize: '14px', color: '#333', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    {job.requirements}
                  </div>
                </div>
              )}
              <ApplyForm jobId={String(job.id)} jobTitle={job.title} ownerId={userId} />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '2.5rem', fontSize: '12px', color: '#aaa' }}>
          Powered by Helpdesk
        </div>
      </div>
    </div>
  )
}
