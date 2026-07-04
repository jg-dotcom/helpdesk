'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

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
  { key: 'applied',      label: 'Applied',      color: '#666',    bg: '#f0f2f5' },
  { key: 'interviewing', label: 'Interviewing',  color: '#185fa5', bg: '#e8f0fb' },
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

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Application | null>(null)
  const [filterJob, setFilterJob] = useState<string>('all')
  const [token, setToken] = useState('')

  const load = useCallback(async (tok: string) => {
    const res = await fetch('/api/applications', { headers: { Authorization: `Bearer ${tok}` } })
    const d = await res.json()
    setApps(d.applications ?? [])
    setLoading(false)
  }, [])

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
    <div style={{ minHeight: '100vh', background: '#f7f8fa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Nav active="applications" />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Applicants</h1>
            <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{apps.length} total application{apps.length !== 1 ? 's' : ''}</div>
          </div>
          {jobTitles.length > 1 && (
            <select value={filterJob} onChange={e => setFilterJob(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #dde1ea', borderRadius: '8px', fontSize: '13px', background: '#fff' }}>
              <option value="all">All roles</option>
              {jobTitles.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>Loading...</div>
        ) : apps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: '#fff', borderRadius: '12px', border: '1px solid #eee' }}>
            <div style={{ fontSize: '32px', marginBottom: '0.75rem' }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>No applications yet</div>
            <div style={{ fontSize: '13px', color: '#888' }}>Applications submitted via your careers page will appear here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
            {STAGES.map(stage => {
              const stageApps = filtered.filter(a => a.status === stage.key)
              return (
                <div key={stage.key} style={{ minWidth: '220px', flex: '1' }}>
                  {/* Column header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#333' }}>{stage.label}</span>
                    <span style={{
                      background: stage.bg, color: stage.color,
                      borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                      padding: '2px 8px',
                    }}>{stageApps.length}</span>
                  </div>

                  {/* Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {stageApps.map(app => (
                      <div
                        key={app.id}
                        onClick={() => setSelected(selected?.id === app.id ? null : app)}
                        style={{
                          background: '#fff', border: `1px solid ${selected?.id === app.id ? '#185fa5' : '#e5e7eb'}`,
                          borderRadius: '10px', padding: '0.875rem', cursor: 'pointer',
                          boxShadow: selected?.id === app.id ? '0 0 0 2px #bfdbfe' : 'none',
                          transition: 'all 0.1s',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px' }}>{app.name}</div>
                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{app.job_postings?.title ?? '—'}</div>
                        <div style={{ fontSize: '11px', color: '#aaa' }}>{timeAgo(app.created_at)}</div>
                      </div>
                    ))}
                    {stageApps.length === 0 && (
                      <div style={{ padding: '1rem', background: '#fafafa', borderRadius: '10px', border: '1px dashed #e5e7eb', fontSize: '12px', color: '#bbb', textAlign: 'center' }}>
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Detail panel */}
        {selected && (
          <div style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: '360px',
            background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
            padding: '1.5rem', overflowY: 'auto', zIndex: 100,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '17px' }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#888' }}>×</button>
            </div>

            <div style={{ fontSize: '13px', color: '#666', marginBottom: '0.5rem' }}>📧 {selected.email}</div>
            {selected.phone && <div style={{ fontSize: '13px', color: '#666', marginBottom: '0.5rem' }}>📞 {selected.phone}</div>}
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '1.25rem' }}>🏷 {selected.job_postings?.title ?? 'Unknown role'}</div>

            {selected.cover_letter && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Cover letter</div>
                <div style={{ fontSize: '13px', color: '#333', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f7f8fa', borderRadius: '8px', padding: '0.75rem' }}>
                  {selected.cover_letter}
                </div>
              </div>
            )}

            <div style={{ fontSize: '11px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Move to stage</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {STAGES.map(stage => (
                <button key={stage.key} onClick={() => moveStage(selected.id, stage.key)}
                  style={{
                    padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: selected.status === stage.key ? stage.color : stage.bg,
                    color: selected.status === stage.key ? '#fff' : stage.color,
                  }}>
                  {stage.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <a href={`mailto:${selected.email}`} style={{
                flex: 1, textAlign: 'center', padding: '8px', background: '#185fa5', color: '#fff',
                borderRadius: '8px', fontSize: '13px', fontWeight: 600, textDecoration: 'none',
              }}>Email applicant</a>
              <button onClick={() => deleteApp(selected.id)} style={{
                padding: '8px 14px', background: '#fee2e2', color: '#991b1b',
                border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}>Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
