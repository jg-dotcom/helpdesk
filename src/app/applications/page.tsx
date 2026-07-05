'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import { ClipboardIcon, MailIcon, PhoneIcon, TagIcon } from '../components/Icons'

type Application = {
  id: string
  name: string
  email: string
  phone: string | null
  cover_letter: string | null
  status: 'applied' | 'interviewing' | 'offer' | 'hired' | 'rejected'
  created_at: string
  job_postings: { title: string } | null
}

const STAGES: { key: Application['status']; label: string; color: string; bg: string }[] = [
  { key: 'applied',      label: 'Applied',      color: '#6b6b6b', bg: '#f0f2f5' },
  { key: 'interviewing', label: 'Interviewing',  color: '#185fa5', bg: '#e6f1fb' },
  { key: 'offer',        label: 'Offer',         color: '#b45309', bg: '#fef3c7' },
  { key: 'hired',        label: 'Hired',         color: '#15803d', bg: '#dcfce7' },
  { key: 'rejected',     label: 'Rejected',      color: '#991b1b', bg: '#fee2e2' },
]

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function ApplicationsPage() {
  const searchParams = useSearchParams()
  const jobIdParam = searchParams.get('job')

  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Application | null>(null)
  const [filterJob, setFilterJob] = useState<string>('all')
  const [token, setToken] = useState('')

  const load = useCallback(async (tok: string) => {
    const url = jobIdParam
      ? `/api/applications?job_id=${jobIdParam}`
      : '/api/applications'
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
    const d = await res.json()
    setApps(d.applications ?? [])
    setLoading(false)
  }, [jobIdParam])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      load(session.access_token)
    })
  }, [load])

  async function moveStage(appId: string, status: Application['status']) {
    await fetch(`/api/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    })
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a))
    setSelected(prev => prev?.id === appId ? { ...prev, status } : prev)
  }

  async function deleteApp(appId: string) {
    if (!confirm('Delete this application?')) return
    await fetch(`/api/applications/${appId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    setApps(prev => prev.filter(a => a.id !== appId))
    if (selected?.id === appId) setSelected(null)
  }

  const jobTitles = [...new Set(apps.map(a => a.job_postings?.title ?? 'Unknown'))]
  const filtered = filterJob === 'all' ? apps : apps.filter(a => a.job_postings?.title === filterJob)

  return (
    <div className="dash-wrap">
      <Nav active="applications" />
      <div className="dash-content">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>Applicants</div>
              {jobIdParam && apps.length > 0 && (
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#185fa5', background: '#e6f1fb', borderRadius: '999px', padding: '2px 10px' }}>
                  {apps[0].job_postings?.title ?? 'Filtered role'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '13px', color: '#6b6b6b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {apps.length} application{apps.length !== 1 ? 's' : ''}
              {jobIdParam && (
                <a href="/applications" style={{ fontSize: '12px', color: '#9a9a9a' }}>← Show all</a>
              )}
            </div>
          </div>
          {!jobIdParam && jobTitles.length > 1 && (
            <select value={filterJob} onChange={e => setFilterJob(e.target.value)}
              style={{ width: 'auto', padding: '7px 10px' }}>
              <option value="all">All roles</option>
              {jobTitles.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div className="card"><div className="loading-state">Loading...</div></div>
        ) : apps.length === 0 ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <div style={{ marginBottom: '0.75rem', color: '#9a9a9a' }}><ClipboardIcon size={32} /></div>
            <div className="empty-state">No applications yet — they'll appear here once candidates apply via your careers page.</div>
          </div>
        ) : (
          <div className="kanban-board">
            {STAGES.map(stage => {
              const stageApps = filtered.filter(a => a.status === stage.key)
              return (
                <div key={stage.key} className="kanban-col">
                  <div className="kanban-col-header">
                    <span className="kanban-col-title">{stage.label}</span>
                    <span className="kanban-badge" style={{ background: stage.bg, color: stage.color }}>
                      {stageApps.length}
                    </span>
                  </div>

                  {stageApps.map(app => (
                    <div
                      key={app.id}
                      className={`kanban-card${selected?.id === app.id ? ' selected' : ''}`}
                      onClick={() => setSelected(selected?.id === app.id ? null : app)}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{app.name}</div>
                      <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '4px' }}>
                        {app.job_postings?.title ?? '—'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#9a9a9a' }}>{timeAgo(app.created_at)}</div>
                    </div>
                  ))}

                  {stageApps.length === 0 && (
                    <div className="kanban-empty">Empty</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Detail panel */}
        {selected && (
          <div className="detail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} className="btn-ghost" style={{ fontSize: '18px', padding: '0 4px' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><MailIcon size={13} />{selected.email}</div>
              {selected.phone && <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><PhoneIcon size={13} />{selected.phone}</div>}
              <div style={{ fontSize: '13px', color: '#6b6b6b', display: 'flex', alignItems: 'center', gap: '6px' }}><TagIcon size={13} />{selected.job_postings?.title ?? 'Unknown role'}</div>
            </div>

            {selected.cover_letter && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div className="section-label">Cover letter</div>
                <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f7f7f5', borderRadius: '8px', padding: '0.75rem', border: '0.5px solid rgba(0,0,0,0.08)' }}>
                  {selected.cover_letter}
                </div>
              </div>
            )}

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

export default function ApplicationsPageWrapper() {
  return (
    <Suspense fallback={<div className="dash-wrap"><Nav active="applications" /><div className="dash-content"><div className="card"><div className="loading-state">Loading...</div></div></div></div>}>
      <ApplicationsPage />
    </Suspense>
  )
}
