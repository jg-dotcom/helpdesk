'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type Employee = {
  id: number
  name: string
  role: string
  email: string
  pay_type: string
  pay_rate: number
}

type TimeEntry = {
  id: number
  clock_in: string
  clock_out: string | null
  total_minutes: number | null
}

type PayStub = {
  id: number
  gross_pay: number
  hours_worked: number | null
  pay_type: string
  period_start: string
  period_end: string
  created_at: string
}

type TimeOffRequest = {
  id: number
  start_date: string
  end_date: string
  type: string
  reason: string | null
  status: string
}

type Tab = 'clock' | 'schedule' | 'pay' | 'timeoff'

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtMoney(n: number) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
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

export default function EmployeePortal() {
  const [loading, setLoading] = useState(true)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [tab, setTab] = useState<Tab>('clock')

  const [clockedIn, setClockedIn] = useState<TimeEntry | null>(null)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockMsg, setClockMsg] = useState('')
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [ticker, setTicker] = useState(0)

  const [stubs, setStubs] = useState<PayStub[]>([])
  const [requests, setRequests] = useState<TimeOffRequest[]>([])

  // Time off form
  const [toStart, setToStart] = useState('')
  const [toEnd, setToEnd] = useState('')
  const [toType, setToType] = useState('PTO / Vacation')
  const [toReason, setToReason] = useState('')
  const [toSaving, setToSaving] = useState(false)
  const [toMsg, setToMsg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/employee/login'; return }
      setAccessToken(session.access_token)

      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [meRes, entriesRes, stubsRes, torRes] = await Promise.all([
        fetch('/api/employee/me', { headers }),
        fetch('/api/employee/time-entries', { headers }),
        fetch('/api/employee/pay-stubs', { headers }),
        fetch('/api/employee/time-off', { headers }),
      ])

      const meData = await meRes.json()
      if (!meRes.ok) { window.location.href = '/employee/login'; return }
      setEmployee(meData.employee)

      const entriesData = await entriesRes.json()
      if (entriesData.entries) {
        setEntries(entriesData.entries)
        const open = entriesData.entries.find((e: TimeEntry) => !e.clock_out)
        if (open) setClockedIn(open)
      }

      const stubsData = await stubsRes.json()
      if (stubsData.stubs) setStubs(stubsData.stubs)

      const torData = await torRes.json()
      if (torData.requests) setRequests(torData.requests)

      setLoading(false)
    })
  }, [])

  // Tick every minute to update elapsed time
  useEffect(() => {
    if (!clockedIn) return
    const t = setInterval(() => setTicker(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [clockedIn])

  async function clockIn() {
    setClockLoading(true)
    setClockMsg('')
    const res = await fetch('/api/employee/clock-in', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (!res.ok) { setClockMsg(data.error); setClockLoading(false); return }
    setClockedIn(data.entry)
    setEntries(prev => [data.entry, ...prev])
    setClockLoading(false)
  }

  async function clockOut() {
    setClockLoading(true)
    setClockMsg('')
    const res = await fetch('/api/employee/clock-out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (!res.ok) { setClockMsg(data.error); setClockLoading(false); return }
    setClockedIn(null)
    setEntries(prev => prev.map(e => e.id === data.entry.id ? data.entry : e))
    setClockLoading(false)
  }

  async function submitTimeOff() {
    if (!toStart || !toEnd || !toType) return
    setToSaving(true)
    setToMsg('')
    const res = await fetch('/api/employee/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ startDate: toStart, endDate: toEnd, type: toType, reason: toReason }),
    })
    const data = await res.json()
    if (!res.ok) { setToMsg(data.error); } else {
      setToMsg('Request submitted.')
      setToStart(''); setToEnd(''); setToReason('')
      const torRes = await fetch('/api/employee/time-off', { headers: { Authorization: `Bearer ${accessToken}` } })
      const torData = await torRes.json()
      if (torData.requests) setRequests(torData.requests)
    }
    setToSaving(false)
    setTimeout(() => setToMsg(''), 3000)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/employee/login'
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa' }}>
        <div style={{ fontSize: '14px', color: '#999' }}>Loading...</div>
      </div>
    )
  }

  const statusColor = { pending: '#f59e0b', approved: '#27ae60', denied: '#c0392b' } as Record<string, string>

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', maxWidth: '480px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 800 }}>help<span style={{ color: '#185fa5' }}>desk</span></div>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '1px' }}>{employee?.name} · {employee?.role}</div>
        </div>
        <button onClick={handleLogout} style={{ fontSize: '12px', color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', display: 'flex' }}>
        {([['clock', 'Clock'], ['pay', 'Pay stubs'], ['timeoff', 'Time off']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '12px 0', fontSize: '13px', fontWeight: tab === key ? 700 : 400,
            color: tab === key ? '#185fa5' : '#888', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === key ? '2px solid #185fa5' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '1.25rem' }}>

        {/* CLOCK TAB */}
        {tab === 'clock' && (
          <>
            {/* Big clock button */}
            <div style={{ background: '#fff', borderRadius: '20px', padding: '2rem', textAlign: 'center', marginBottom: '1rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              {clockedIn ? (
                <>
                  <div style={{ fontSize: '13px', color: '#27ae60', fontWeight: 600, marginBottom: '0.5rem' }}>● Clocked in</div>
                  <div style={{ fontSize: '13px', color: '#888', marginBottom: '0.25rem' }}>Since {fmtTime(clockedIn.clock_in)}</div>
                  <div style={{ fontSize: '32px', fontWeight: 800, color: '#111', margin: '1rem 0' }}>
                    {elapsed(clockedIn.clock_in)}
                  </div>
                  <button
                    onClick={clockOut}
                    disabled={clockLoading}
                    style={{
                      width: '140px', height: '140px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: '#c0392b', color: '#fff', fontSize: '18px', fontWeight: 800,
                      boxShadow: '0 4px 20px rgba(192,57,43,0.4)', transition: 'transform 0.1s',
                    }}
                  >
                    {clockLoading ? '...' : 'Clock\nOut'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: '#888', marginBottom: '1rem' }}>You are not clocked in</div>
                  <button
                    onClick={clockIn}
                    disabled={clockLoading}
                    style={{
                      width: '140px', height: '140px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: '#185fa5', color: '#fff', fontSize: '18px', fontWeight: 800,
                      boxShadow: '0 4px 20px rgba(24,95,165,0.35)', transition: 'transform 0.1s',
                    }}
                  >
                    {clockLoading ? '...' : 'Clock\nIn'}
                  </button>
                </>
              )}
              {clockMsg && <div style={{ fontSize: '13px', color: '#c0392b', marginTop: '1rem' }}>{clockMsg}</div>}
            </div>

            {/* Recent entries */}
            {entries.filter(e => e.clock_out).length > 0 && (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Recent shifts</div>
                {entries.filter(e => e.clock_out).slice(0, 7).map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{fmt(e.clock_in)}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{fmtTime(e.clock_in)} – {fmtTime(e.clock_out!)}</div>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#185fa5' }}>
                      {e.total_minutes ? fmtMinutes(e.total_minutes) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* PAY STUBS TAB */}
        {tab === 'pay' && (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Pay history</div>
            {stubs.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#aaa', textAlign: 'center', padding: '2rem 0' }}>No pay records yet.</div>
            ) : stubs.map(s => (
              <div key={s.id} style={{ padding: '12px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{fmt(s.period_start)} – {fmt(s.period_end)}</div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                      {s.pay_type === 'hourly' && s.hours_worked ? `${s.hours_worked}h × ${fmtMoney(s.gross_pay / s.hours_worked)}/hr` : s.pay_type}
                    </div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#111' }}>{fmtMoney(s.gross_pay)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIME OFF TAB */}
        {tab === 'timeoff' && (
          <>
            <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '1rem' }}>Request time off</div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>From</label>
                  <input type="date" value={toStart} onChange={e => setToStart(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>To</label>
                  <input type="date" value={toEnd} onChange={e => setToEnd(e.target.value)} />
                </div>
              </div>
              <select value={toType} onChange={e => setToType(e.target.value)} style={{ marginBottom: '0.75rem' }}>
                <option>PTO / Vacation</option>
                <option>Sick leave</option>
                <option>Unpaid leave</option>
              </select>
              <textarea value={toReason} onChange={e => setToReason(e.target.value)} placeholder="Reason (optional)" style={{ minHeight: '70px', marginBottom: '0.75rem' }} />
              <button className="btn auth-btn-primary" onClick={submitTimeOff} disabled={toSaving || !toStart || !toEnd} style={{ width: '100%' }}>
                {toSaving ? 'Submitting...' : 'Submit request'}
              </button>
              {toMsg && <div style={{ fontSize: '13px', color: toMsg.includes('Error') ? '#c0392b' : '#27ae60', marginTop: '0.5rem' }}>{toMsg}</div>}
            </div>

            {requests.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>My requests</div>
                {requests.map(r => (
                  <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{fmt(r.start_date)} – {fmt(r.end_date)}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{r.type}</div>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: `${statusColor[r.status]}20`, color: statusColor[r.status], textTransform: 'capitalize' }}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
