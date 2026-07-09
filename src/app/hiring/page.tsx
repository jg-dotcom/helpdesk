'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
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
  status: 'applied' | 'interviewing' | 'offer' | 'hired' | 'rejected'
  created_at: string
  interview_at?: string | null
}

const STAGES: { key: Application['status']; label: string; color: string; bg: string }[] = [
  { key: 'applied',      label: 'Applied',      color: '#6b6b6b', bg: '#f0f2f5' },
  { key: 'interviewing', label: 'Interviewing',  color: '#185fa5', bg: '#e6f1fb' },
  { key: 'offer',        label: 'Offer',         color: '#b45309', bg: '#fef3c7' },
  { key: 'hired',        label: 'Hired',         color: '#15803d', bg: '#dcfce7' },
  { key: 'rejected',     label: 'Rejected',      color: '#991b1b', bg: '#fee2e2' },
]

function stageFor(s: Application['status']) {
  return STAGES.find(st => st.key === s) ?? STAGES[0]
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
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

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)
    setToken(session.access_token)
    const [{ data: jobData }, { data: appData }] = await Promise.all([
      supabase.from('job_postings').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('job_applications').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
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

  async function moveStage(appId: string, status: Application['status']) {
    await fetch(`/api/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    })
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a))
    setSelected(prev => prev?.id === appId ? { ...prev, status } : prev)
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

  return (
    <div className="dash-wrap">
      <Nav active="hiring" />
      <div className="dash-content">

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700 }}>Jobs & Applicants</div>
            <div style={{ fontSize: '13px', color: '#6b6b6b', marginTop: '4px' }}>
              {userId && (
                <>Careers page: <a href={`/careers/${userId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#185fa5' }}>{typeof window !== 'undefined' ? window.location.origin : ''}/careers/{userId}</a>
                  <button onClick={() => copy(`${window.location.origin}/careers/${userId}`, 'page')} style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px', border: '0.5px solid rgba(0,0,0,0.22)', borderRadius: '4px', background: 'transparent', cursor: 'pointer', color: '#6b6b6b', fontFamily: 'inherit' }}>
                    {copied === 'page' ? '✓ Copied' : 'Copy link'}
                  </button>
                </>
              )}
            </div>
          </div>
          <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={showForm && !editingId ? () => setShowForm(false) : openNew}>
            {showForm && !editingId ? 'Cancel' : '+ New job'}
          </button>
        </div>

        {/* Create/Edit form */}
        {showForm && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>{editingId ? 'Edit job' : 'New job posting'}</div>
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
              <div className="auth-error" style={{ marginBottom: '0.75rem' }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn auth-btn-primary" style={{ width: 'auto' }} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Post job'}
              </button>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Share panel */}
        {shareJob && (
          <div className="card" style={{ marginBottom: '1.5rem', borderColor: '#c2d4f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600 }}>Share — {shareJob.title}</div>
              <button onClick={() => setShareJobId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#9a9a9a' }}>×</button>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '4px', fontWeight: 500 }}>Direct link</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={careersUrl(shareJob)} style={{ flex: 1, fontSize: '12px' }} onFocus={e => e.target.select()} />
                <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', whiteSpace: 'nowrap' }} onClick={() => copy(careersUrl(shareJob), 'link')}>
                  {copied === 'link' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '4px', fontWeight: 500 }}>LinkedIn post</div>
              <textarea readOnly value={formatLinkedInPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical' }} onFocus={e => e.target.select()} />
              <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', marginTop: '4px' }} onClick={() => copy(formatLinkedInPost(shareJob, careersUrl(shareJob)), 'linkedin')}>
                {copied === 'linkedin' ? '✓ Copied' : 'Copy for LinkedIn'}
              </button>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '4px', fontWeight: 500 }}>Indeed post</div>
              <textarea readOnly value={formatIndeedPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical' }} onFocus={e => e.target.select()} />
              <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', marginTop: '4px' }} onClick={() => copy(formatIndeedPost(shareJob, careersUrl(shareJob)), 'indeed')}>
                {copied === 'indeed' ? '✓ Copied' : 'Copy for Indeed'}
              </button>
            </div>
          </div>
        )}

        {/* Job list with inline applicants */}
        {loading ? (
          <div className="card"><div className="loading-state">Loading...</div></div>
        ) : jobs.length === 0 ? (
          <div className="card"><div className="empty-state">No job postings yet — create your first one above.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {jobs.map(job => {
              const jobApps = apps.filter(a => a.job_posting_id === job.id)
              return (
                <div key={job.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Job header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{job.title}</div>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor(job.status) }}>● {statusLabel(job.status)}</span>
                        {jobApps.length > 0 && (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#185fa5', background: '#e6f1fb', borderRadius: '999px', padding: '1px 7px' }}>
                            {jobApps.length} applicant{jobApps.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#9a9a9a' }}>
                        {[job.employment_type, job.location, formatPayRange(job.pay_min, job.pay_max, job.pay_period)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
                      <button className="btn" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => setShareJobId(shareJobId === job.id ? null : job.id)}>
                        {shareJobId === job.id ? 'Hide' : 'Share'}
                      </button>
                      <button className="btn" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => openEdit(job)}>Edit</button>
                      <button className="btn" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => toggleStatus(job)}>
                        {job.status === 'open' ? 'Close' : 'Reopen'}
                      </button>
                      <button className="btn" style={{ fontSize: '12px', padding: '4px 10px', color: '#c0392b' }} onClick={() => deleteJob(job.id)}>Delete</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Candidate pipeline */}
        {jobs.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
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
              <div className="card"><div className="empty-state">
                {apps.length === 0 ? 'No applicants yet.' : 'No candidates match your search.'}
              </div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '10px', overflowX: 'auto' }}>
                {STAGES.map(stage => {
                  const stageApps = pipelineApps.filter(a => a.status === stage.key)
                  return (
                    <div key={stage.key}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', padding: '0 2px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: stage.color }}>{stage.label}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: stage.color, background: stage.bg, borderRadius: '999px', padding: '1px 7px' }}>
                          {stageApps.length}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {stageApps.map(app => {
                          const isSelected = selected?.id === app.id
                          const jobTitle = jobs.find(j => j.id === app.job_posting_id)?.title
                          return (
                            <div
                              key={app.id}
                              onClick={() => setSelected(isSelected ? null : app)}
                              style={{
                                padding: '10px', borderRadius: '8px', cursor: 'pointer',
                                background: isSelected ? stage.bg : '#fff',
                                border: `0.5px solid ${isSelected ? stage.color : 'rgba(0,0,0,0.10)'}`,
                                transition: 'all 0.1s',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: stage.bg, color: stage.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0 }}>
                                  {app.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                  {app.name}
                                </div>
                              </div>
                              {jobTitle && (
                                <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {jobTitle}
                                </div>
                              )}
                              {app.interview_at && (
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#185fa5', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                                  {fmtInterview(app.interview_at)}
                                </div>
                              )}
                              <div style={{ fontSize: '10px', color: '#b0b0b0' }}>{timeAgo(app.created_at)}</div>
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

        {/* Applicant detail panel */}
        {selected && (
          <div className="detail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} className="btn-ghost" style={{ fontSize: '18px', padding: '0 4px' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><MailIcon size={13} />{selected.email}</div>
              {selected.phone && <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><PhoneIcon size={13} />{selected.phone}</div>}
              <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><TagIcon size={13} />{jobs.find(j => j.id === selected.job_posting_id)?.title ?? 'Unknown role'}</div>
            </div>

            {selected.cover_letter && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div className="section-label">Cover letter</div>
                <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f7f7f5', borderRadius: '8px', padding: '0.75rem', border: '0.5px solid rgba(0,0,0,0.08)' }}>
                  {selected.cover_letter}
                </div>
              </div>
            )}

            <div className="section-label">Interview</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1.5rem' }}>
              <input
                key={selected.id}
                type="datetime-local"
                defaultValue={selected.interview_at ? toDatetimeLocalValue(selected.interview_at) : ''}
                onChange={e => scheduleInterview(selected.id, e.target.value)}
                style={{ flex: 1, fontSize: '13px' }}
              />
              {selected.interview_at && (
                <button className="btn" style={{ fontSize: '12px', padding: '5px 10px', whiteSpace: 'nowrap' }} onClick={() => scheduleInterview(selected.id, '')}>
                  Clear
                </button>
              )}
            </div>

            <div className="section-label">Move to stage</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1.5rem' }}>
              {STAGES.map(stage => (
                <button key={stage.key} onClick={() => moveStage(selected.id, stage.key)}
                  style={{
                    padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                    background: selected.status === stage.key ? stage.color : stage.bg,
                    color: selected.status === stage.key ? '#fff' : stage.color,
                  }}>
                  {stage.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <a href={`mailto:${selected.email}`} className="btn auth-btn-primary" style={{ flex: 1, textAlign: 'center' }}>
                Email applicant
              </a>
              <button onClick={() => deleteApp(selected.id)} className="btn" style={{ color: '#c0392b' }}>
                Delete
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
