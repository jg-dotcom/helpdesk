'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { resolveTenantContext } from '../lib/tenant'
import Nav from '../components/Nav'
import { useToast } from '../components/Toast'
import { MailIcon, PhoneIcon, TagIcon } from '../components/Icons'
import {
  formatPayRange, validateJobPosting, statusLabel, statusColor,
  formatLinkedInPost, formatIndeedPost, type JobPosting,
} from '../../lib/jobs'

const EMPTY_FORM = {
  title: '', department: '', location: '', employment_type: 'Full-time',
  description: '', requirements: '', pay_min: '', pay_max: '', pay_period: 'hourly', status: 'open',
}

type Application = {
  id: string
  job_posting_id: number
  name: string
  email: string
  phone: string | null
  cover_letter: string | null
  source?: string | null
  resume_file_name?: string | null
  status: 'applied' | 'interviewing' | 'offer' | 'hired' | 'rejected'
  created_at: string
  updated_at?: string
  interview_at?: string | null
}

const STAGES: { key: Application['status']; label: string; color: string; bg: string; border: string }[] = [
  { key: 'applied',      label: 'Applied',      color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.24)' },
  { key: 'interviewing', label: 'Interviewing',  color: '#93c5fd', bg: 'rgba(29,78,216,0.15)',   border: 'rgba(29,78,216,0.32)' },
  { key: 'offer',        label: 'Offer',         color: '#fbbf24', bg: 'rgba(245,158,11,0.16)',  border: 'rgba(245,158,11,0.3)' },
  { key: 'hired',        label: 'Hired',         color: '#4ade80', bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.3)' },
  { key: 'rejected',     label: 'Rejected',      color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.26)' },
]

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

// Staleness — a candidate that's sat untouched in a non-terminal stage for a while.
// Computed from updated_at (set on every status change by the PATCH route already),
// no schema change. Passive badge only, per JAY-15's own "ship the age badge first"
// validation gut-check.
const STALE_THRESHOLD_DAYS = 10
function daysSinceUpdate(app: Application) {
  return Math.floor((Date.now() - new Date(app.updated_at ?? app.created_at).getTime()) / 86400000)
}
function isStale(app: Application) {
  return app.status !== 'hired' && app.status !== 'rejected' && daysSinceUpdate(app) >= STALE_THRESHOLD_DAYS
}

function fmtInterview(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

// <input type="datetime-local"> needs local-time-formatted "YYYY-MM-DDTHH:MM", not the ISO
// string's UTC representation, or the picker would silently shift the displayed time.
function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function JobsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [shareJobId, setShareJobId] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [selected, setSelected] = useState<Application | null>(null)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [jobFilter, setJobFilter] = useState<number | 'all'>('all')
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<Application['status'] | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    // JAY-68 — resolve the real tenant (owner) id instead of session.user.id
    // directly, same fix as time/page.tsx (JAY-50) — an invited admin/manager
    // otherwise sees an empty Hiring pipeline, and the public careers link
    // built from this id below would point at the wrong (empty) business.
    const tenant = await resolveTenantContext(session.user.id, session.user.email)
    if (!tenant) { router.push('/login'); return }
    setUserId(tenant.tenantId)
    setToken(session.access_token)
    const [{ data: jobData }, { data: appData }] = await Promise.all([
      supabase.from('job_postings').select('*').eq('user_id', tenant.tenantId).order('created_at', { ascending: false }),
      supabase.from('job_applications').select('*').eq('user_id', tenant.tenantId).order('created_at', { ascending: false }),
    ])
    if (jobData) setJobs(jobData)
    if (appData) setApps(appData)
    setLoading(false)
  }

  function openNew() {
    setEditingId(null); setForm({ ...EMPTY_FORM }); setErrors([]); setShowForm(true)
  }

  function openEdit(job: JobPosting) {
    setEditingId(job.id)
    setForm({
      title: job.title, department: job.department ?? '', location: job.location ?? '',
      employment_type: job.employment_type, description: job.description ?? '',
      requirements: job.requirements ?? '',
      pay_min: job.pay_min != null ? String(job.pay_min) : '',
      pay_max: job.pay_max != null ? String(job.pay_max) : '',
      pay_period: job.pay_period, status: job.status,
    })
    setErrors([]); setShowForm(true); setShareJobId(null)
  }

  async function handleSave() {
    const payload = {
      title: form.title.trim(), department: form.department.trim() || null,
      location: form.location.trim() || null, employment_type: form.employment_type,
      description: form.description.trim() || null, requirements: form.requirements.trim() || null,
      pay_min: form.pay_min ? parseFloat(form.pay_min) : null,
      pay_max: form.pay_max ? parseFloat(form.pay_max) : null,
      pay_period: form.pay_period, status: form.status,
    }
    const errs = validateJobPosting(payload)
    if (errs.length) { setErrors(errs); return }
    setSaving(true); setErrors([])
    if (editingId) {
      const { error } = await supabase.from('job_postings').update(payload).eq('id', editingId)
      if (!error) { setJobs(prev => prev.map(j => j.id === editingId ? { ...j, ...payload } : j)); setShowForm(false) }
    } else {
      const { data, error } = await supabase.from('job_postings').insert([{ ...payload, user_id: userId }]).select().single()
      if (!error && data) { setJobs(prev => [data, ...prev]); setShowForm(false) }
    }
    setSaving(false)
  }

  async function toggleStatus(job: JobPosting) {
    const newStatus = job.status === 'open' ? 'closed' : 'open'
    await supabase.from('job_postings').update({ status: newStatus }).eq('id', job.id)
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: newStatus } : j))
  }

  async function deleteJob(id: number) {
    await supabase.from('job_postings').delete().eq('id', id)
    setJobs(prev => prev.filter(j => j.id !== id))
    if (shareJobId === id) setShareJobId(null)
  }

  async function moveStage(appId: string, status: Application['status'], notify = false) {
    const jobTitle = notify ? jobs.find(j => j.id === apps.find(a => a.id === appId)?.job_posting_id)?.title : undefined
    await fetch(`/api/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, notify, jobTitle }),
    })
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a))
    setSelected(prev => prev?.id === appId ? { ...prev, status } : prev)
    if (notify) showToast('Candidate moved to Rejected and notified by email.', 'success')
  }

  async function scheduleInterview(appId: string, localDateTime: string) {
    const iso = localDateTime ? new Date(localDateTime).toISOString() : null
    const app = apps.find(a => a.id === appId)
    const jobTitle = app ? jobs.find(j => j.id === app.job_posting_id)?.title : undefined
    const res = await fetch(`/api/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ interview_at: iso, jobTitle, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
    if (!res.ok) { showToast('Could not save interview time.', 'error'); return }
    const body = await res.json().catch(() => ({}))
    setApps(prev => prev.map(a => a.id === appId ? { ...a, interview_at: iso } : a))
    setSelected(prev => prev?.id === appId ? { ...prev, interview_at: iso } : prev)
    if (iso) showToast(body.calendarSynced ? 'Interview scheduled and added to your calendar.' : 'Interview time saved.', 'success')
    else showToast('Interview time cleared.', 'success')
  }

  // JAY-133 — resumes live in a private storage bucket; this fetches a
  // short-lived signed URL through the authenticated, ownership-checked
  // route rather than the browser talking to Supabase Storage directly.
  const [resumeLoading, setResumeLoading] = useState(false)
  async function viewResume(appId: string) {
    setResumeLoading(true)
    try {
      const res = await fetch(`/api/applications/${appId}/resume`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Could not open resume.', 'error'); return }
      window.open(data.url, '_blank')
    } catch {
      showToast('Could not open resume.', 'error')
    } finally {
      setResumeLoading(false)
    }
  }

  async function deleteApp(appId: string) {
    if (!confirm('Delete this application?')) return
    await fetch(`/api/applications/${appId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    setApps(prev => prev.filter(a => a.id !== appId))
    if (selected?.id === appId) setSelected(null)
  }

  function careersUrl(job: JobPosting) {
    return `${window.location.origin}/careers/${userId}#job-${job.id}`
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const shareJob = jobs.find(j => j.id === shareJobId)

  // Candidate pipeline — filtered by search text and job, shown as a board grouped by stage
  const q = candidateSearch.trim().toLowerCase()
  const pipelineApps = apps.filter(a =>
    (jobFilter === 'all' || a.job_posting_id === jobFilter) &&
    (q === '' || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
  )

  // Header metrics — a quick pulse on the pipeline without opening anything
  const openJobsCount = jobs.filter(j => j.status === 'open').length
  const activeCandidatesCount = apps.filter(a => a.status !== 'hired' && a.status !== 'rejected').length
  const weekFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000
  const interviewsThisWeekCount = apps.filter(a => {
    if (!a.interview_at) return false
    const t = new Date(a.interview_at).getTime()
    return t >= Date.now() && t <= weekFromNow
  }).length
  const offersPendingCount = apps.filter(a => a.status === 'offer').length

  // Source breakdown — where candidates are coming from
  const sourceCounts = apps.reduce<Record<string, number>>((acc, a) => {
    const key = a.source?.trim() || 'Prefer not to say'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const sourceEntries = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])
  const topSource = sourceEntries[0]

  function handleDropOnStage(stage: Application['status']) {
    if (draggingAppId) moveStage(draggingAppId, stage)
    setDraggingAppId(null)
    setDragOverStage(null)
  }

  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem' }
  const dangerBtn: React.CSSProperties = { fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
  const ghostBtn: React.CSSProperties = { fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }
  const primaryBtn: React.CSSProperties = { fontSize: '13px', padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
  const sectionLabel: React.CSSProperties = { fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }

  return (
    <div className="dash-wrap">
      <Nav active="hiring" />
      <div className="dash-content">

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Hiring</div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {userId && (
              <button onClick={() => copy(`${window.location.origin}/careers/${userId}`, 'page')} style={ghostBtn} title="Copy your public careers page link">
                {copied === 'page' ? '✓ Copied' : 'Careers page link'}
              </button>
            )}
            <button style={primaryBtn} onClick={showForm && !editingId ? () => setShowForm(false) : openNew}>
              {showForm && !editingId ? 'Cancel' : '+ New job'}
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9' }}>{openJobsCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Open jobs</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#93c5fd' }}>{activeCandidatesCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Active candidates</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#fbbf24' }}>{interviewsThisWeekCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Interviews this week</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#4ade80' }}>{offersPendingCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Offers pending</div>
          </div>
          <div style={cardStyle} title={sourceEntries.map(([name, count]) => `${name}: ${count}`).join(' · ')}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#c084fc' }}>{topSource ? topSource[0] : '—'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Top source{topSource ? ` · ${topSource[1]}` : ''}</div>
          </div>
        </div>

        {/* Create/Edit form */}
        {showForm && (
          <div style={{ ...cardStyle, marginBottom: '1.25rem' }}>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '1rem' }}>{editingId ? 'Edit job' : 'New job posting'}</div>
            <div className="row2" style={{ marginBottom: '0.75rem' }}>
              <div className="field"><label>Job title *</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Cashier" /></div>
              <div className="field"><label>Department</label><input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} placeholder="e.g. Retail" /></div>
            </div>
            <div className="row2" style={{ marginBottom: '0.75rem' }}>
              <div className="field"><label>Location</label><input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. New York, NY or Remote" /></div>
              <div className="field">
                <label>Employment type</label>
                <select value={form.employment_type} onChange={e => setForm(p => ({ ...p, employment_type: e.target.value }))}>
                  <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Seasonal</option><option>Internship</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What will this person do day-to-day?" style={{ minHeight: '80px' }} />
            </div>
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Requirements</label>
              <textarea value={form.requirements} onChange={e => setForm(p => ({ ...p, requirements: e.target.value }))} placeholder="Skills, experience, certifications..." style={{ minHeight: '60px' }} />
            </div>
            <div className="row2" style={{ marginBottom: '0.75rem' }}>
              <div className="field"><label>Min pay</label><input type="number" value={form.pay_min} onChange={e => setForm(p => ({ ...p, pay_min: e.target.value }))} placeholder="15" step="0.01" /></div>
              <div className="field"><label>Max pay</label><input type="number" value={form.pay_max} onChange={e => setForm(p => ({ ...p, pay_max: e.target.value }))} placeholder="20" step="0.01" /></div>
            </div>
            <div className="row2" style={{ marginBottom: '0.75rem' }}>
              <div className="field">
                <label>Pay period</label>
                <select value={form.pay_period} onChange={e => setForm(p => ({ ...p, pay_period: e.target.value }))}>
                  <option value="hourly">Hourly</option><option value="yearly">Yearly</option>
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="open">Open</option><option value="draft">Draft</option><option value="closed">Closed</option>
                </select>
              </div>
            </div>
            {errors.length > 0 && (
              <div style={{ marginBottom: '0.75rem', fontSize: '12px', color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button style={primaryBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Post job'}
              </button>
              <button style={ghostBtn} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Share panel */}
        {shareJob && (
          <div style={{ ...cardStyle, marginBottom: '1.25rem', border: '1px solid rgba(29,78,216,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9' }}>Share — {shareJob.title}</div>
              <button onClick={() => setShareJobId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>×</button>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={sectionLabel}>Direct link</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={careersUrl(shareJob)} style={{ flex: 1, fontSize: '12px' }} onFocus={e => e.target.select()} />
                <button style={{ ...ghostBtn, whiteSpace: 'nowrap' }} onClick={() => copy(careersUrl(shareJob), 'link')}>
                  {copied === 'link' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={sectionLabel}>LinkedIn post</div>
              <textarea readOnly value={formatLinkedInPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical' }} onFocus={e => e.target.select()} />
              <button style={{ ...ghostBtn, marginTop: '4px' }} onClick={() => copy(formatLinkedInPost(shareJob, careersUrl(shareJob)), 'linkedin')}>
                {copied === 'linkedin' ? '✓ Copied' : 'Copy for LinkedIn'}
              </button>
            </div>
            <div>
              <div style={sectionLabel}>Indeed post</div>
              <textarea readOnly value={formatIndeedPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical' }} onFocus={e => e.target.select()} />
              <button style={{ ...ghostBtn, marginTop: '4px' }} onClick={() => copy(formatIndeedPost(shareJob, careersUrl(shareJob)), 'indeed')}>
                {copied === 'indeed' ? '✓ Copied' : 'Copy for Indeed'}
              </button>
            </div>
          </div>
        )}

        {/* Job postings — compact horizontal scroll */}
        {loading ? (
          <div style={cardStyle}><div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }}>Loading...</div></div>
        ) : jobs.length === 0 ? (
          <div style={cardStyle}><div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }}>No job postings yet — create your first one above.</div></div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '1.25rem', paddingBottom: '2px' }}>
            {jobs.map(job => {
              const jobApps = apps.filter(a => a.job_posting_id === job.id)
              return (
                <div key={job.id} style={{ flexShrink: 0, minWidth: '220px', maxWidth: '260px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.title}</span>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: statusColor(job.status), flexShrink: 0 }}>● {statusLabel(job.status)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[job.employment_type, job.location, formatPayRange(job.pay_min, job.pay_max, job.pay_period)].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#93c5fd', background: 'rgba(29,78,216,0.15)', borderRadius: '999px', padding: '1px 8px' }}>
                      {jobApps.length} applicant{jobApps.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button style={{ ...ghostBtn, padding: '3px 8px', fontSize: '11px' }} onClick={() => setShareJobId(shareJobId === job.id ? null : job.id)}>
                      {shareJobId === job.id ? 'Hide' : 'Share'}
                    </button>
                    <button style={{ ...ghostBtn, padding: '3px 8px', fontSize: '11px' }} onClick={() => openEdit(job)}>Edit</button>
                    <button style={{ ...ghostBtn, padding: '3px 8px', fontSize: '11px' }} onClick={() => toggleStatus(job)}>
                      {job.status === 'open' ? 'Close' : 'Reopen'}
                    </button>
                    <button style={{ ...dangerBtn, padding: '3px 8px', fontSize: '11px' }} onClick={() => deleteJob(job.id)}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Candidate pipeline */}
        {jobs.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <input
                value={candidateSearch}
                onChange={e => setCandidateSearch(e.target.value)}
                placeholder="Search candidates by name or email"
                style={{ flex: 1, minWidth: '200px', fontSize: '13px' }}
              />
              <select
                value={jobFilter === 'all' ? 'all' : String(jobFilter)}
                onChange={e => setJobFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                style={{ fontSize: '13px', minWidth: '160px' }}
              >
                <option value="all">All jobs</option>
                {jobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
              </select>
            </div>

            {pipelineApps.length === 0 ? (
              <div style={cardStyle}><div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }}>
                {apps.length === 0 ? 'No applicants yet.' : 'No candidates match your search.'}
              </div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '10px', overflowX: 'auto' }}>
                {STAGES.map(stage => {
                  const stageApps = pipelineApps.filter(a => a.status === stage.key)
                  const isDropTarget = dragOverStage === stage.key
                  return (
                    <div
                      key={stage.key}
                      onDragOver={e => { e.preventDefault(); if (draggingAppId) setDragOverStage(stage.key) }}
                      onDragLeave={() => setDragOverStage(prev => (prev === stage.key ? null : prev))}
                      onDrop={e => { e.preventDefault(); handleDropOnStage(stage.key) }}
                      style={{
                        borderRadius: '10px', padding: '6px',
                        background: isDropTarget ? 'rgba(59,130,246,0.08)' : 'transparent',
                        border: isDropTarget ? '1px dashed rgba(59,130,246,0.5)' : '1px dashed transparent',
                        transition: 'background 0.1s, border-color 0.1s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', padding: '0 2px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: stage.color }}>{stage.label}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: stage.color, background: stage.bg, borderRadius: '999px', padding: '1px 7px' }}>
                          {stageApps.length}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '40px' }}>
                        {stageApps.map(app => {
                          const isSelected = selected?.id === app.id
                          const isDragging = draggingAppId === app.id
                          const jobTitle = jobs.find(j => j.id === app.job_posting_id)?.title
                          return (
                            <div
                              key={app.id}
                              draggable
                              onDragStart={() => setDraggingAppId(app.id)}
                              onDragEnd={() => { setDraggingAppId(null); setDragOverStage(null) }}
                              onClick={() => setSelected(isSelected ? null : app)}
                              style={{
                                padding: '10px', borderRadius: '8px', cursor: 'grab',
                                background: isSelected ? stage.bg : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${isSelected ? stage.color : 'rgba(255,255,255,0.08)'}`,
                                opacity: isDragging ? 0.35 : 1,
                                transition: 'all 0.1s',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: stage.bg, color: stage.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0 }}>
                                  {app.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                  {app.name}
                                </div>
                              </div>
                              {jobTitle && (
                                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {jobTitle}
                                </div>
                              )}
                              {app.interview_at && (
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#93c5fd', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                                  {fmtInterview(app.interview_at)}
                                </div>
                              )}
                              {isStale(app) && (
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#fbbf24', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                                  ⚠ Stale — {daysSinceUpdate(app)} days
                                </div>
                              )}
                              <div style={{ fontSize: '10px', color: '#475569' }}>{timeAgo(app.created_at)}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Applicant detail drawer */}
        {selected && (
          <>
            <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40, backdropFilter: 'blur(2px)' }} />
            <div style={{
              position: 'fixed', top: 0, right: 0, height: '100vh', width: '360px', maxWidth: '100vw',
              background: '#1e293b', borderLeft: '1px solid rgba(255,255,255,0.08)',
              zIndex: 50, overflowY: 'auto', padding: '1.25rem',
              boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '16px', color: '#f1f5f9' }}>{selected.name}</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '18px', padding: '0 4px' }}>×</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}><MailIcon size={13} />{selected.email}</div>
                {selected.phone && <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}><PhoneIcon size={13} />{selected.phone}</div>}
                <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}><TagIcon size={13} />{jobs.find(j => j.id === selected.job_posting_id)?.title ?? 'Unknown role'}</div>
                {selected.source && <div style={{ fontSize: '12px', color: '#64748b' }}>Source: <span style={{ color: '#c084fc' }}>{selected.source}</span></div>}
              </div>

              {selected.resume_file_name && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={sectionLabel}>Resume</div>
                  <button onClick={() => viewResume(selected.id)} disabled={resumeLoading} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#93c5fd',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px',
                    padding: '0.6rem 0.75rem', cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}>
                    {resumeLoading ? 'Opening...' : selected.resume_file_name}
                  </button>
                </div>
              )}

              {selected.cover_letter && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={sectionLabel}>Cover letter</div>
                  <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {selected.cover_letter}
                  </div>
                </div>
              )}

              <div style={sectionLabel}>Interview</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1.5rem' }}>
                <input
                  key={selected.id}
                  type="datetime-local"
                  defaultValue={selected.interview_at ? toDatetimeLocalValue(selected.interview_at) : ''}
                  onChange={e => scheduleInterview(selected.id, e.target.value)}
                  style={{ flex: 1, fontSize: '13px' }}
                />
                {selected.interview_at && (
                  <button style={{ ...ghostBtn, whiteSpace: 'nowrap' }} onClick={() => scheduleInterview(selected.id, '')}>
                    Clear
                  </button>
                )}
              </div>

              <div style={sectionLabel}>Move to stage</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1.5rem' }}>
                {STAGES.map(stage => (
                  <button key={stage.key} onClick={() => moveStage(selected.id, stage.key)}
                    style={{
                      padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                      background: selected.status === stage.key ? stage.color : stage.bg,
                      color: selected.status === stage.key ? '#0f172a' : stage.color,
                    }}>
                    {stage.label}
                  </button>
                ))}
                {selected.status !== 'rejected' && selected.status !== 'hired' && (
                  <button onClick={() => moveStage(selected.id, 'rejected', true)}
                    title="Move to Rejected and send the candidate a short, kind email letting them know"
                    style={{ padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', fontFamily: 'inherit', background: 'transparent', color: '#f87171' }}>
                    Decline & notify
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <a href={`mailto:${selected.email}`} style={{ ...primaryBtn, flex: 1, textAlign: 'center', textDecoration: 'none', display: 'inline-block' }}>
                  Email applicant
                </a>
                <button onClick={() => deleteApp(selected.id)} style={dangerBtn}>
                  Delete
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
