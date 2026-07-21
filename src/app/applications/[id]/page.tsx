import { supabaseAdmin } from '../../lib/supabaseAdmin'
import ThemeToggle from './ThemeToggle'

// Public, read-only applicant status check (JAY-41). No schema change: the
// application's own numeric id is the lookup key (matches the issue's own
// grounding — "no schema change, the application's own id serves as the
// lookup key"). Zero write capability, ship read-only first per the issue's
// validation gut-check.
//
// The mockup's 4-step "Applied / Reviewed / Interview / Decision" stepper
// doesn't match the real pipeline stored in job_applications.status
// ('applied' | 'interviewing' | 'offer' | 'hired' | 'rejected' — confirmed in
// hiring/page.tsx's STAGES) — there's no separate "Reviewed" stage in the data
// model, so this uses the real 3-step shape instead: Applied, Interviewing,
// Decision (with the actual outcome — offer/hired/rejected — as the label).
const STEP_LABELS = ['Applied', 'Interviewing', 'Decision']

function stepIndex(status: string) {
  if (status === 'applied') return 0
  if (status === 'interviewing') return 1
  return 2 // offer, hired, rejected
}

function decisionLabel(status: string) {
  if (status === 'offer') return 'Offer extended'
  if (status === 'hired') return 'Hired'
  // JAY-178: softer copy is deliberate for the candidate audience, mirrors hiring/page.tsx's blunter "Rejected" for employers — don't collapse the two.
  if (status === 'rejected') return 'Not moving forward'
  return 'Decision'
}

export default async function ApplicationStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: app } = await supabaseAdmin
    .from('job_applications')
    .select('id, name, status, created_at, job_posting_id, user_id')
    .eq('id', id)
    .single()

  if (!app) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginBottom: '0.5rem' }}>Application not found</div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>This link may be invalid. Please contact the business directly.</div>
        </div>
      </div>
    )
  }

  const [{ data: job }, { data: biz }] = await Promise.all([
    supabaseAdmin.from('job_postings').select('title').eq('id', app.job_posting_id).single(),
    supabaseAdmin.from('business_profiles').select('business_name').eq('user_id', app.user_id).single(),
  ])

  const jobTitle = job?.title ?? 'this role'
  const businessName = biz?.business_name ?? 'the team'
  const currentStep = stepIndex(app.status)
  const submitted = new Date(app.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
          <ThemeToggle />
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.5rem' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>{businessName}</div>
          <div style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text)', marginBottom: '1.25rem' }}>{jobTitle}</div>

          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent)', marginBottom: '1rem' }}>
            Status: {currentStep === 2 ? decisionLabel(app.status) : STEP_LABELS[currentStep]}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
            {STEP_LABELS.map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEP_LABELS.length - 1 ? 1 : 'none' }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                  background: i <= currentStep ? 'var(--accent)' : 'var(--border)',
                }} />
                {i < STEP_LABELS.length - 1 && (
                  <div style={{ flex: 1, height: '2px', background: i < currentStep ? 'var(--accent)' : 'var(--border)' }} />
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            {STEP_LABELS.map(label => <span key={label}>{label}</span>)}
          </div>

          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Submitted {submitted}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '12px', color: 'var(--text-tertiary)' }}>
          Powered by Helpdesk
        </div>
      </div>
    </div>
  )
}
