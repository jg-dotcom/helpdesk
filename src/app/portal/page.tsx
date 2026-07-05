'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type Employee = { id: number; name: string; role: string; email: string }
type Shift = { id: number; shift_date: string; start_time: string; end_time: string; notes: string | null; status?: string }
type TimeEntry = { id: number; clock_in: string; clock_out: string | null; total_minutes: number | null }
type TimeOffRequest = { id: number; start_date: string; end_date: string; type: string; reason: string | null; status: string }
type PTOBalance = { total: number; used: number; remaining: number }

function fmt(t: string) {
  const [h, m] = t.split(':'); const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function elapsed(clockIn: string) {
  const mins = Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function weekStartISO() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString()
}

export default function PortalPage() {
  const [token, setToken] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [currentEntry, setCurrentEntry] = useState<TimeEntry | null>(null)
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [ptoBalance, setPtoBalance] = useState<PTOBalance | null>(null)
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockMsg, setClockMsg] = useState('')
  const [ticker, setTicker] = useState(0)

  const [showTOForm, setShowTOForm] = useState(false)
  const [toStart, setToStart] = useState('')
  const [toEnd, setToEnd] = useState('')
  const [toType, setToType] = useState('PTO')
  const [toReason, setToReason] = useState('')
  const [toSaving, setToSaving] = useState(false)
  const [toMsg, setToMsg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      await loadAll(session.access_token)
    })
    const t = setInterval(() => setTicker(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  async function loadAll(tk: string) {
    const headers = { Authorization: `Bearer ${tk}` }
    const [meRes, shiftsRes, ptoRes, toRes, entriesRes] = await Promise.all([
      fetch('/api/employee/me', { headers }),
      fetch('/api/employee/shifts', { headers }),
      fetch('/api/employee/pto-balance', { headers }),
      fetch('/api/employee/time-off', { headers }),
      fetch('/api/employee/time-entries', { headers }),
    ])
    const [me, sh, pto, to, ents] = await Promise.all([meRes.json(), shiftsRes.json(), ptoRes.json(), toRes.json(), entriesRes.json()])

    if (!me.employee) { window.location.href = '/'; return } // not an employee — redirect to owner dashboard

    setEmployee(me.employee)
    setShifts(sh.shifts ?? [])
    setPtoBalance(pto.balance)
    setTimeOffRequests(to.requests ?? [])

    const allEntries: TimeEntry[] = ents.entries ?? []
    setCurrentEntry(allEntries.find(e => !e.clock_out) ?? null)
    setWeekEntries(allEntries.filter(e => e.clock_out))
    setLoading(false)
  }

  async function clockIn() {
    setClockLoading(true); setClockMsg('')
    const res = await fetch('/api/employee/clock-in', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) { setCurrentEntry(data.entry); setClockMsg('Clocked in!') }
    else setClockMsg(data.error ?? 'Error')
    setClockLoading(false); setTimeout(() => setClockMsg(''), 3000)
  }

  async function clockOut() {
    setClockLoading(true); setClockMsg('')
    const res = await fetch('/api/employee/clock-out', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) {
      setWeekEntries(prev => [...prev, { ...currentEntry!, clock_out: data.entry.clock_out, total_minutes: data.entry.total_minutes }])
      setCurrentEntry(null); setClockMsg('Clocked out.')
    } else setClockMsg(data.error ?? 'Error')
    setClockLoading(false); setTimeout(() => setClockMsg(''), 3000)
  }

  async function submitTimeOff() {
    if (!toStart || !toEnd) return
    setToSaving(true); setToMsg('')
    const res = await fetch('/api/employee/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ startDate: toStart, endDate: toEnd, type: toType, reason: toReason }),
    })
    if (res.ok) {
      setToMsg('Request submitted.'); setToStart(''); setToEnd(''); setToReason(''); setShowTOForm(false)
      const toRes = await fetch('/api/employee/time-off', { headers: { Authorization: `Bearer ${token}` } })
      const toData = await toRes.json(); setTimeOffRequests(toData.requests ?? [])
    } else {
      const data = await res.json(); setToMsg(data.error ?? 'Error')
    }
    setToSaving(false); setTimeout(() => setToMsg(''), 4000)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayShift = shifts.find(s => s.shift_date === today && s.status !== 'called_out')
  const upcomingShifts = shifts.filter(s => s.shift_date > today)
  const weeklyMins = weekEntries.reduce((s, e) => s + (e.total_minutes ?? 0), 0)
  const weeklyHrs = Math.floor(weeklyMins / 60)
  const weeklyMinsRem = weeklyMins % 60
  const statusColor = { approved: '#27ae60', denied: '#c0392b', pending: '#e67e22' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '18px', fontWeight: 800 }}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: '#555', fontWeight: 500 }}>{employee?.name}</div>
          <button onClick={signOut} style={{ fontSize: '12px', color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '1.5rem 1rem' }}>

        {/* Greeting */}
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '0.25rem' }}>
          {greeting()}, {employee?.name.split(' ')[0]}!
        </div>
        <div style={{ fontSize: '13px', color: '#888', marginBottom: '1.5rem' }}>{employee?.role}</div>

        {/* Clock in/out card */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {currentEntry ? (
            <>
              <div style={{ fontSize: '13px', color: '#27ae60', fontWeight: 600, marginBottom: '4px' }}>
                Currently clocked in
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>{elapsed(currentEntry.clock_in)}</div>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '1rem' }}>Since {fmtTime(currentEntry.clock_in)}</div>
              <button
                onClick={clockOut}
                disabled={clockLoading}
                style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', background: '#c0392b', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
              >
                {clockLoading ? 'Clocking out...' : 'Clock out'}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>
                {todayShift
                  ? `Scheduled today: ${fmt(todayShift.start_time)} – ${fmt(todayShift.end_time)}`
                  : 'No shift scheduled today'}
              </div>
              <button
                onClick={clockIn}
                disabled={clockLoading}
                style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
              >
                {clockLoading ? 'Clocking in...' : 'Clock in'}
              </button>
            </>
          )}
          {clockMsg && <div style={{ marginTop: '0.75rem', fontSize: '13px', color: clockMsg.includes('Error') || clockMsg.includes('Already') ? '#c0392b' : '#27ae60' }}>{clockMsg}</div>}
        </div>

        {/* Hours this week */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid #eee' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>This week</div>
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{weeklyHrs}h{weeklyMinsRem > 0 ? ` ${weeklyMinsRem}m` : ''}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Hours worked</div>
            </div>
            {currentEntry && (
              <div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#27ae60' }}>{elapsed(currentEntry.clock_in)}</div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Current session</div>
              </div>
            )}
          </div>
          {weeklyMins > 0 && (
            <div style={{ marginTop: '12px', height: 6, background: '#f0f0f0', borderRadius: 3 }}>
              <div style={{ height: '100%', width: `${Math.min((weeklyMins / (40 * 60)) * 100, 100)}%`, background: weeklyMins >= 40 * 60 ? '#c0392b' : '#185fa5', borderRadius: 3 }} />
            </div>
          )}
        </div>

        {/* Upcoming shifts */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid #eee' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#888', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {todayShift ? 'Schedule' : 'Upcoming shifts'}
          </div>
          {todayShift && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', background: '#f0f6ff', border: '1px solid #d0e4fa', marginBottom: '8px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Today</div>
                <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>{fmt(todayShift.start_time)} – {fmt(todayShift.end_time)}{todayShift.notes ? ` · ${todayShift.notes}` : ''}</div>
              </div>
            </div>
          )}
          {upcomingShifts.length === 0 && !todayShift ? (
            <div style={{ fontSize: '13px', color: '#bbb', padding: '8px 0' }}>No upcoming shifts scheduled.</div>
          ) : (
            upcomingShifts.slice(0, 7).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ width: '80px', fontSize: '12px', color: '#888', flexShrink: 0 }}>
                  {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{fmt(s.start_time)} – {fmt(s.end_time)}</div>
                {s.notes && <div style={{ fontSize: '11px', color: '#aaa' }}>{s.notes}</div>}
              </div>
            ))
          )}
        </div>

        {/* PTO */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid #eee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time off</div>
            <button
              onClick={() => setShowTOForm(v => !v)}
              style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid #dde1ea', background: showTOForm ? '#f0f2f5' : '#fff', cursor: 'pointer', fontWeight: 500 }}
            >
              {showTOForm ? 'Cancel' : '+ Request'}
            </button>
          </div>

          {ptoBalance && (
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
              <div><div style={{ fontSize: '22px', fontWeight: 700 }}>{ptoBalance.remaining}</div><div style={{ fontSize: '12px', color: '#888' }}>Days remaining</div></div>
              <div><div style={{ fontSize: '22px', fontWeight: 700, color: '#888' }}>{ptoBalance.used}</div><div style={{ fontSize: '12px', color: '#888' }}>Used this year</div></div>
              <div><div style={{ fontSize: '22px', fontWeight: 700, color: '#bbb' }}>{ptoBalance.total}</div><div style={{ fontSize: '12px', color: '#888' }}>Total</div></div>
            </div>
          )}

          {showTOForm && (
            <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', border: '1px solid #eee' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>From</label>
                  <input type="date" value={toStart} onChange={e => setToStart(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '6px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>To</label>
                  <input type="date" value={toEnd} onChange={e => setToEnd(e.target.value)} min={toStart} style={{ width: '100%', fontSize: '13px', padding: '6px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Type</label>
                <select value={toType} onChange={e => setToType(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '6px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }}>
                  <option>PTO</option><option>Sick</option><option>Personal</option><option>Unpaid</option>
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Reason (optional)</label>
                <input value={toReason} onChange={e => setToReason(e.target.value)} placeholder="e.g. Doctor appointment" style={{ width: '100%', fontSize: '13px', padding: '6px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
              </div>
              <button
                onClick={submitTimeOff}
                disabled={toSaving || !toStart || !toEnd}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >
                {toSaving ? 'Submitting...' : 'Submit request'}
              </button>
              {toMsg && <div style={{ marginTop: '0.5rem', fontSize: '13px', color: toMsg.includes('Error') ? '#c0392b' : '#27ae60' }}>{toMsg}</div>}
            </div>
          )}

          {timeOffRequests.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {timeOffRequests.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.type}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor[r.status as keyof typeof statusColor] ?? '#888', textTransform: 'capitalize' }}>{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
