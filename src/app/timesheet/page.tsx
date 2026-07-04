'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Employee = { id: number; name: string; role: string }

type TimeEntry = {
  id: number
  employee_id: number
  clock_in: string
  clock_out: string | null
  total_minutes: number | null
  notes: string | null
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function elapsed(clockIn: string) {
  const mins = Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)
  return fmtMinutes(mins)
}

function weekStart() {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function TimesheetPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ticker, setTicker] = useState(0)

  useEffect(() => {
    load()
    const t = setInterval(() => setTicker(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const [empRes, entRes] = await Promise.all([
      supabase.from('employees').select('id, name, role').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('time_entries').select('*').eq('user_id', session.user.id).gte('clock_in', weekStart()).order('clock_in', { ascending: false }),
    ])

    setEmployees(empRes.data ?? [])
    setEntries(entRes.data ?? [])
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    await supabase.from('time_entries').delete().eq('id', id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const empMap = new Map(employees.map(e => [e.id, e]))
  const clockedIn = entries.filter(e => !e.clock_out)
  const completed = entries.filter(e => e.clock_out)

  // Weekly hours per employee
  const weeklyHours = new Map<number, number>()
  for (const e of completed) {
    weeklyHours.set(e.employee_id, (weeklyHours.get(e.employee_id) ?? 0) + (e.total_minutes ?? 0))
  }

  return (
    <div className="dash-wrap">
      <Nav active="schedule" />
      <div className="dash-content">
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '0.25rem' }}>Timesheets</div>
        <div style={{ fontSize: '13px', color: '#666', marginBottom: '1.5rem' }}>Week of {new Date(weekStart()).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>

        {loading ? <div className="loading-state">Loading...</div> : (
          <>
            {/* Clocked in now */}
            {clockedIn.length > 0 && (
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#27ae60', marginRight: '6px' }} />
                  Clocked in now ({clockedIn.length})
                </div>
                {clockedIn.map(e => {
                  const emp = empMap.get(e.employee_id)
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{emp?.name ?? 'Unknown'}</div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Since {fmtTime(e.clock_in)}</div>
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#27ae60' }}>{elapsed(e.clock_in)}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Weekly summary */}
            {weeklyHours.size > 0 && (
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>Weekly hours</div>
                {[...weeklyHours.entries()].sort((a, b) => b[1] - a[1]).map(([empId, mins]) => {
                  const emp = empMap.get(empId)
                  const pct = Math.min((mins / (40 * 60)) * 100, 100)
                  return (
                    <div key={empId} style={{ marginBottom: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>{emp?.name ?? 'Unknown'}</span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#185fa5' }}>{fmtMinutes(mins)}</span>
                      </div>
                      <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#185fa5', borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Full entry list */}
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>All entries this week</div>
              {completed.length === 0 && clockedIn.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#aaa', textAlign: 'center', padding: '1.5rem 0' }}>No time entries this week yet.</div>
              ) : [...clockedIn, ...completed].map(e => {
                const emp = empMap.get(e.employee_id)
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{emp?.name ?? 'Unknown'}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                        {fmtDate(e.clock_in)} · {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : <span style={{ color: '#27ae60' }}>now</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: e.clock_out ? '#111' : '#27ae60', minWidth: '40px', textAlign: 'right' }}>
                      {e.clock_out && e.total_minutes ? fmtMinutes(e.total_minutes) : elapsed(e.clock_in)}
                    </div>
                    {e.clock_out && (
                      <button onClick={() => deleteEntry(e.id)} style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>×</button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
