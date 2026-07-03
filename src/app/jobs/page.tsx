'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import {
  formatPayRange, validateJobPosting, statusLabel, statusColor,
  formatLinkedInPost, formatIndeedPost, type JobPosting,
} from '../../lib/jobs'

const EMPTY_FORM = {
  title: '', department: '', location: '', employment_type: 'Full-time',
  description: '', requirements: '', pay_min: '', pay_max: '', pay_period: 'hourly', status: 'open',
}

export default function JobsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [shareJobId, setShareJobId] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)
    const { data } = await supabase
      .from('job_postings')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
    if (data) setJobs(data)
    setLoading(false)
  }

  function openNew() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setErrors([])
    setShowForm(true)
  }

  function openEdit(job: JobPosting) {
    setEditingId(job.id)
    setForm({
      title: job.title,
      department: job.department ?? '',
      location: job.location ?? '',
      employment_type: job.employment_type,
      description: job.description ?? '',
      requirements: job.requirements ?? '',
      pay_min: job.pay_min != null ? String(job.pay_min) : '',
      pay_max: job.pay_max != null ? String(job.pay_max) : '',
      pay_period: job.pay_period,
      status: job.status,
    })
    setErrors([])
    setShowForm(true)
    setShareJobId(null)
  }

  async function handleSave() {
    const payload = {
      title: form.title.trim(),
      department: form.department.trim() || null,
      location: form.location.trim() || null,
      employment_type: form.employment_type,
      description: form.description.trim() || null,
      requirements: form.requirements.trim() || null,
      pay_min: form.pay_min ? parseFloat(form.pay_min) : null,
      pay_max: form.pay_max ? parseFloat(form.pay_max) : null,
      pay_period: form.pay_period,
      status: form.status,
    }

    const errs = validateJobPosting(payload)
    if (errs.length) { setErrors(errs); return }

    setSaving(true)
    setErrors([])

    if (editingId) {
      const { error } = await supabase.from('job_postings').update(payload).eq('id', editingId)
      if (!error) {
        setJobs(prev => prev.map(j => j.id === editingId ? { ...j, ...payload } : j))
        setShowForm(false)
      }
    } else {
      const { data, error } = await supabase
        .from('job_postings')
        .insert([{ ...payload, user_id: userId }])
        .select()
        .single()
      if (!error && data) {
        setJobs(prev => [data, ...prev])
        setShowForm(false)
      }
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

  function careersUrl(job: JobPosting) {
    return `${window.location.origin}/careers/${userId}#job-${job.id}`
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const shareJob = jobs.find(j => j.id === shareJobId)

  return (
    <div className="dash-wrap">
      <Nav active="jobs" />
      <div className="dash-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700 }}>Job postings</div>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
              {userId && (
                <>Your careers page: <a href={`/careers/${userId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#185fa5' }}>{window?.location?.origin}/careers/{userId}</a>
                  <button onClick={() => copy(`${window.location.origin}/careers/${userId}`, 'page')} style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px', border: '1px solid #dde1ea', borderRadius: '4px', background: 'transparent', cursor: 'pointer', color: '#666' }}>
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
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: 500 }}>Direct link</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={careersUrl(shareJob)} style={{ flex: 1, fontSize: '12px' }} onFocus={e => e.target.select()} />
                <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', whiteSpace: 'nowrap' }} onClick={() => copy(careersUrl(shareJob), 'link')}>
                  {copied === 'link' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: 500 }}>LinkedIn post</div>
              <textarea readOnly value={formatLinkedInPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical', boxSizing: 'border-box' }} onFocus={e => e.target.select()} />
              <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', marginTop: '4px' }} onClick={() => copy(formatLinkedInPost(shareJob, careersUrl(shareJob)), 'linkedin')}>
                {copied === 'linkedin' ? '✓ Copied' : 'Copy for LinkedIn'}
              </button>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: 500 }}>Indeed post</div>
              <textarea readOnly value={formatIndeedPost(shareJob, careersUrl(shareJob))} style={{ width: '100%', fontSize: '12px', minHeight: '100px', resize: 'vertical', boxSizing: 'border-box' }} onFocus={e => e.target.select()} />
              <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', marginTop: '4px' }} onClick={() => copy(formatIndeedPost(shareJob, careersUrl(shareJob)), 'indeed')}>
                {copied === 'indeed' ? '✓ Copied' : 'Copy for Indeed'}
              </button>
            </div>
          </div>
        )}

        {/* Job list */}
        <div className="card">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="empty-state">No job postings yet — create your first one above.</div>
          ) : (
            <div className="upload-list">
              {jobs.map(job => (
                <div key={job.id} className="upload-item" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <div className="upload-name">{job.title}</div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor(job.status) }}>● {statusLabel(job.status)}</span>
                    </div>
                    <div className="upload-meta">
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
