'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

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
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [tab, setTab] = useState<Tab>('clock')

  const [clockedIn, setClockedIn] = useState<TimeEntry | null>(null)
  const [clockLoading, setClockLoading] = useState(false)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [ticker, setTicker] = useState(0)

  const [stubs, setStubs] = useState<PayStub[]>([])
  const [requests, setRequests] = useState<TimeOffRequest[]>([])
  const [ptoBalance, setPtoBalance] = useState<{ total: number; used: number; remaining: number } | null>(null)

  // Time off form
  const [toStart, setToStart] = useState('')
  const [toEnd, setToEnd] = useState('')
  const [toType, setToType] = useState('PTO / Vacation')
  const [toReason, setToReason] = useState('')
  const [toPortion, setToPortion] = useState<'full' | 'first_half' | 'second_half'>('full')
  const [toSaving, setToSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/employee/login'; return }
      setAccessToken(session.access_token)

      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [meRes, entriesRes, stubsRes, torRes, ptoRes] = await Promise.all([
        fetch('/api/employee/me', { headers }),
        fetch('/api/employee/time-entries', { headers }),
        fetch('/api/employee/pay-stubs', { headers }),
        fetch('/api/employee/time-off', { headers }),
        fetch('/api/employee/pto-balance', { headers }),
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

      const ptoData = await ptoRes.json()
      if (ptoData.balance) setPtoBalance(ptoData.balance)

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
    const res = await fetch('/api/employee/clock-in', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error, 'error'); setClockLoading(false); return }
    setClockedIn(data.entry)
    setEntries(prev => [data.entry, ...prev])
    setClockLoading(false)
  }

  async function clockOut() {
    setClockLoading(true)
    const res = await fetch('/api/employee/clock-out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error, 'error'); setClockLoading(false); return }
    setClockedIn(null)
    setEntries(prev => prev.map(e => e.id === data.entry.id ? data.entry : e))
    setClockLoading(false)
  }

  async function submitTimeOff() {
    if (!toStart || !toEnd || !toType) return
    setToSaving(true)
    const res = await fetch('/api/employee/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ startDate: toStart, endDate: toEnd, type: toType, reason: toReason, portion: toStart === toEnd && toPortion !== 'full' ? toPortion : undefined }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error, 'error') } else {
      showToast('Request submitted.', 'success')
      setToStart(''); setToEnd(''); setToReason(''); setToPortion('full')
      const torRes = await fetch('/api/employee/time-off', { headers: { Authorization: `Bearer ${accessToken}` } })
      const torData = await torRes.json()
      if (torData.requests) setRequests(torData.requests)
    }
    setToSaving(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/employee/login'
  }

  // JAY-73 — this page (the employee self-serve portal reached via the
  // magic-link login, distinct from portal/page.tsx which was already dark)
  // never got the dark-theme redesign pass. Matches the established palette:
  // #0f172a page bg, #1e293b cards, rgba(255,255,255,0.07) borders,
  // #e2e8f0/#94a3b8/#64748b text tiers, #3b82f6/#1d4ed8 accent.
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <div style={{ fontSize: '14px', color: '#64748b' }}>Loading...</div>
      </div>
    )
  }

  const statusColor = { pending: '#fbbf24', approved: '#4ade80', denied: '#f87171' } as Record<string, string>

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', maxWidth: '480px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#e2e8f0' }}>help<span style={{ color: '#3b82f6' }}>desk</span></div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>{employee?.name} · {employee?.role}</div>
        </div>
        <button onClick={handleLogout} style={{ fontSize: '12px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex' }}>
        {([['clock', 'Clock'], ['pay', 'Pay stubs'], ['timeoff', 'Time off']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '12px 0', fontSize: '13px', fontWeight: tab === key ? 700 : 400,
            color: tab === key ? '#93c5fd' : '#64748b', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === key ? '2px solid #3b82f6' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '1.25rem' }}>

        {/* CLOCK TAB */}
        {tab === 'clock' && (
          <>
            {/* Big clock button */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '20px', padding: '2rem', textAlign: 'center', marginBottom: '1rem' }}>
              {clockedIn ? (
                <>
                  <div style={{ fontSize: '13px', color: '#4ade80', fontWeight: 600, marginBottom: '0.5rem' }}>● Clocked in</div>
                  <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '0.25rem' }}>Since {fmtTime(clockedIn.clock_in)}</div>
                  <div style={{ fontSize: '32px', fontWeight: 800, color: '#e2e8f0', margin: '1rem 0' }}>
                    {elapsed(clockedIn.clock_in)}
                  </div>
                  <button
                    onClick={clockOut}
                    disabled={clockLoading}
                    style={{
                      width: '140px', height: '140px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: '#f87171', color: '#fff', fontSize: '18px', fontWeight: 800,
                      boxShadow: '0 4px 20px rgba(248,113,113,0.3)', transition: 'transform 0.1s',
                    }}
                  >
                    {clockLoading ? '...' : 'Clock\nOut'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '1rem' }}>You are not clocked in</div>
                  <button
                    onClick={clockIn}
                    disabled={clockLoading}
                    style={{
                      width: '140px', height: '140px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: '#1d4ed8', color: '#fff', fontSize: '18px', fontWeight: 800,
                      boxShadow: '0 4px 20px rgba(29,78,216,0.35)', transition: 'transform 0.1s',
                    }}
                  >
                    {clockLoading ? '...' : 'Clock\nIn'}
                  </button>
                </>
              )}
            </div>

            {/* Recent entries */}
            {entries.filter(e => e.clock_out).length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '1.25rem' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Recent shifts</div>
                {entries.filter(e => e.clock_out).slice(0, 7).map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{fmt(e.clock_in)}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{fmtTime(e.clock_in)} – {fmtTime(e.clock_out!)}</div>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#93c5fd' }}>
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
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '1.25rem' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Pay history</div>
            {stubs.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#475569', textAlign: 'center', padding: '2rem 0' }}>No pay records yet.</div>
            ) : stubs.map(s => (
              <div key={s.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{fmt(s.period_start)} – {fmt(s.period_end)}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                      {s.pay_type === 'hourly' && s.hours_worked ? `${s.hours_worked}h × ${fmtMoney(s.gross_pay / s.hours_worked)}/hr` : s.pay_type}
                    </div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#e2e8f0' }}>{fmtMoney(s.gross_pay)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIME OFF TAB */}
        {tab === 'timeoff' && (
          <>
            {/* PTO Balance */}
            {ptoBalance && ptoBalance.total > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.875rem' }}>PTO Balance — {new Date().getFullYear()}</div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {[
                    { label: 'Total', value: ptoBalance.total, color: '#93c5fd' },
                    { label: 'Used', value: ptoBalance.used, color: '#94a3b8' },
                    { label: 'Remaining', value: ptoBalance.remaining, color: '#4ade80' },
                  ].map(item => (
                    <div key={item.label} style={{ flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '0.75rem 0.5rem' }}>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{item.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '0.875rem', height: '6px', background: '#334155', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (ptoBalance.used / ptoBalance.total) * 100)}%`, background: ptoBalance.remaining === 0 ? '#f87171' : '#3b82f6', borderRadius: '999px', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '1.25rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '1rem', color: '#e2e8f0' }}>Request time off</div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '3px' }}>From</label>
                  <input type="date" value={toStart} onChange={e => { const v = e.target.value; setToStart(v); if (v !== toEnd) setToPortion('full') }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '3px' }}>To</label>
                  <input type="date" value={toEnd} onChange={e => { const v = e.target.value; setToEnd(v); if (v !== toStart) setToPortion('full') }} />
                </div>
              </div>
              {toStart && toEnd && toStart === toEnd && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {([['full', 'Full day'], ['first_half', 'Half day — morning'], ['second_half', 'Half day — afternoon']] as [typeof toPortion, string][]).map(([value, label]) => (
                    <label key={value} style={{ flex: 1, fontSize: '11px', color: toPortion === value ? '#93c5fd' : '#64748b', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input type="radio" name="toPortion" checked={toPortion === value} onChange={() => setToPortion(value)} />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              <select value={toType} onChange={e => setToType(e.target.value)} style={{ marginBottom: '0.75rem' }}>
                <option>PTO / Vacation</option>
                <option>Sick leave</option>
                <option>Unpaid leave</option>
              </select>
              <textarea value={toReason} onChange={e => setToReason(e.target.value)} placeholder="Reason (optional)" style={{ minHeight: '70px', marginBottom: '0.75rem' }} />
              <button className="btn auth-btn-primary" onClick={submitTimeOff} disabled={toSaving || !toStart || !toEnd} style={{ width: '100%' }}>
                {toSaving ? 'Submitting...' : 'Submit request'}
              </button>
            </div>

            {requests.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '1.25rem' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>My requests</div>
                {requests.map(r => (
                  <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{fmt(r.start_date)} – {fmt(r.end_date)}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{r.type}</div>
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
