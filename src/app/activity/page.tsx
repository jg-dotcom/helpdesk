'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type ActivityEvent = {
  id: string
  type: 'hire' | 'payroll' | 'application' | 'announcement' | 'swap'
  title: string
  detail?: string
  created_at: string
  actorId?: number | null
  actorName?: string
}

const FILTERS: { key: ActivityEvent['type'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'hire', label: 'Team' },
  { key: 'application', label: 'Hiring' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'swap', label: 'Scheduling' },
  { key: 'announcement', label: 'Announcements' },
]

const TYPE_META: Record<ActivityEvent['type'], { color: string; bg: string; icon: React.ReactNode }> = {
  hire: {
    color: 'var(--success)', bg: 'rgba(34,197,94,0.15)',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
  },
  payroll: {
    color: 'var(--accent)', bg: 'rgba(59,130,246,0.15)',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  },
  application: {
    color: 'var(--purple)', bg: 'rgba(168,85,247,0.15)',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  announcement: {
    color: 'var(--amber)', bg: 'rgba(245,158,11,0.15)',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>,
  },
  swap: {
    color: 'var(--accent)', bg: 'rgba(59,130,246,0.15)',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>,
  },
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function groupByDate(events: ActivityEvent[]) {
  const groups: { date: string; events: ActivityEvent[] }[] = []
  for (const ev of events) {
    const date = new Date(ev.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.date === date) last.events.push(ev)
    else groups.push({ date, events: [ev] })
  }
  return groups
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const STAGE_LABEL: Record<string, string> = {
  applied: 'applied', interviewing: 'moved to interviewing', offer: 'received an offer', hired: 'was hired', rejected: 'was rejected',
}

export default function ActivityPage() {
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [filter, setFilter] = useState<ActivityEvent['type'] | 'all'>('all')
  const [actorFilter, setActorFilter] = useState<number | 'all'>('all')
  const [employeeRoster, setEmployeeRoster] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const uid = session.user.id
      const since = new Date(); since.setDate(since.getDate() - 60)
      const sinceIso = since.toISOString()

      const [{ data: emps }, { data: payroll }, { data: runItems }, { data: apps }, { data: announcements }, { data: swaps }] = await Promise.all([
        supabase.from('employees').select('id, name, role, created_at').eq('user_id', uid).gte('created_at', sinceIso),
        supabase.from('payroll_entries').select('id, employee_id, gross_pay, created_at').eq('user_id', uid).gte('created_at', sinceIso),
        // JAY-88 — "Run Payroll" writes to payroll_run_items, not
        // payroll_entries, so payroll processed that way never showed up
        // here even though it's the primary payroll path. payroll_run_items
        // carries user_id directly (see supabase/migrations/payroll_runs.sql),
        // same direct-query shape already used in api/ai/chat/route.ts's
        // get_analytics_summary tool.
        supabase.from('payroll_run_items').select('id, employee_id, gross_pay, created_at').eq('user_id', uid).gte('created_at', sinceIso),
        supabase.from('job_applications').select('id, name, status, created_at').eq('user_id', uid).gte('created_at', sinceIso),
        supabase.from('announcements').select('id, title, message, created_at').eq('user_id', uid).gte('created_at', sinceIso),
        supabase.from('shift_swaps').select('id, status, created_at, requester_employee_id, target_employee_id').eq('user_id', uid).gte('created_at', sinceIso),
      ])

      // Also pull all-time employees (not just last 60 days) so the actor filter has a full roster
      const { data: allEmps } = await supabase.from('employees').select('id, name').eq('user_id', uid)
      const empMap = new Map((allEmps ?? []).map(e => [e.id, e.name]))

      const evts: ActivityEvent[] = []

      for (const e of emps ?? []) {
        evts.push({ id: `hire-${e.id}`, type: 'hire', title: `${e.name} joined the team`, detail: e.role, created_at: e.created_at, actorId: e.id, actorName: e.name })
      }

      for (const p of payroll ?? []) {
        const name = empMap.get(p.employee_id) ?? 'An employee'
        evts.push({ id: `pay-${p.id}`, type: 'payroll', title: `Payroll logged for ${name}`, detail: fmtMoney(p.gross_pay), created_at: p.created_at, actorId: p.employee_id, actorName: name })
      }

      for (const p of runItems ?? []) {
        const name = empMap.get(p.employee_id) ?? 'An employee'
        evts.push({ id: `pay-run-${p.id}`, type: 'payroll', title: `Payroll logged for ${name}`, detail: fmtMoney(p.gross_pay), created_at: p.created_at, actorId: p.employee_id, actorName: name })
      }

      for (const a of apps ?? []) {
        evts.push({ id: `app-${a.id}`, type: 'application', title: `${a.name} ${STAGE_LABEL[a.status] ?? `is now ${a.status}`}`, created_at: a.created_at, actorName: a.name })
      }

      for (const an of announcements ?? []) {
        evts.push({ id: `ann-${an.id}`, type: 'announcement', title: `Announcement: ${an.title}`, detail: an.message, created_at: an.created_at })
      }

      for (const s of swaps ?? []) {
        const requesterName = empMap.get(s.requester_employee_id)
        const targetName = s.target_employee_id ? empMap.get(s.target_employee_id) : null
        const detail = requesterName ? `${requesterName}${targetName ? ` → ${targetName}` : ''}` : undefined
        evts.push({ id: `swap-${s.id}`, type: 'swap', title: `Shift swap request ${s.status}`, detail, created_at: s.created_at, actorId: s.requester_employee_id, actorName: requesterName })
      }

      evts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setEvents(evts)
      setEmployeeRoster((allEmps ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
      setLoading(false)
    })
  }, [])

  function exportCSV() {
    const rows = [
      ['Date', 'Type', 'Actor', 'Title', 'Detail'],
      ...filtered.map(e => [e.created_at, e.type, e.actorName ?? '', e.title, e.detail ?? '']),
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'activity-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    let list = filter === 'all' ? events : events.filter(e => e.type === filter)
    if (actorFilter !== 'all') list = list.filter(e => e.actorId === actorFilter)
    return list
  }, [events, filter, actorFilter])
  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1
    return c
  }, [events])

  const actorsWithActivity = useMemo(() => {
    const ids = new Set(events.filter(e => e.actorId != null).map(e => e.actorId as number))
    return employeeRoster.filter(e => ids.has(e.id))
  }, [events, employeeRoster])

  return (
    <div className="dash-wrap">
      <Nav active="activity" />
      <div className="dash-content" style={{ background: 'var(--bg)', minHeight: '100vh', padding: '2rem' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>Activity</div>
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>What&apos;s happened across your team in the last 60 days</div>
          </div>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: filtered.length === 0 ? 'default' : 'pointer', background: 'rgba(255,255,255,0.05)', color: filtered.length === 0 ? 'var(--text-secondary)' : 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
        </div>

        {/* Filter tabs + actor filter */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map(f => {
            const isActive = filter === f.key
            const count = counts[f.key] ?? 0
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '99px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                  background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                {f.label}
                <span style={{ fontSize: '11px', opacity: 0.75 }}>{count}</span>
              </button>
            )
          })}

          {actorsWithActivity.length > 0 && (
            <select
              value={actorFilter}
              onChange={e => setActorFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ marginLeft: 'auto', fontSize: '12.5px', fontWeight: 500, padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
            >
              <option value="all">All employees</option>
              {actorsWithActivity.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>

        <div>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', padding: '3rem 1.5rem' }}>Loading activity…</div>
          ) : grouped.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem 1.5rem' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 10px' }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <div style={{ fontSize: '14px' }}>Nothing here yet.</div>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.date} style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '10px' }}>{group.date}</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {group.events.map((ev, i) => {
                    const meta = TYPE_META[ev.type]
                    const isLast = i === group.events.length - 1
                    return (
                      <div key={ev.id} style={{ display: 'flex', gap: '12px', padding: '10px 8px', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: '8px', background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {meta.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13.5px', color: 'var(--text)', fontWeight: 500 }}>{ev.title}</div>
                          {ev.detail && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.detail}</div>}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap', paddingTop: '2px' }}>{timeAgo(ev.created_at)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
