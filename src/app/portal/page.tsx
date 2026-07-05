'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type Employee = { id: number; name: string; role: string; email: string }
type Shift = { id: number; shift_date: string; start_time: string; end_time: string; notes: string | null; status?: string }
type OpenShift = { id: number; shift_date: string; start_time: string; end_time: string; notes: string | null }
type CoworkerShift = { id: number; employee_id: number; employee_name: string; shift_date: string; start_time: string; end_time: string }
type SwapRequest = { id: number; requester_shift_id: number; target_shift_id: number | null; target_employee_id: number | null; status: string; notes: string | null; created_at: string }
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
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([])
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [coworkerShifts, setCoworkerShifts] = useState<CoworkerShift[]>([])
  const [currentEntry, setCurrentEntry] = useState<TimeEntry | null>(null)
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [ptoBalance, setPtoBalance] = useState<PTOBalance | null>(null)
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockMsg, setClockMsg] = useState('')
  const [ticker, setTicker] = useState(0)

  // PTO form
  const [showTOForm, setShowTOForm] = useState(false)
  const [toStart, setToStart] = useState('')
  const [toEnd, setToEnd] = useState('')
  const [toType, setToType] = useState('PTO')
  const [toReason, setToReason] = useState('')
  const [toSaving, setToSaving] = useState(false)
  const [toMsg, setToMsg] = useState('')

  // Swap form
  const [swapShiftId, setSwapShiftId] = useState<number | null>(null)
  const [swapTargetShiftId, setSwapTargetShiftId] = useState<number | ''>('')
  const [swapNotes, setSwapNotes] = useState('')
  const [swapSaving, setSwapSaving] = useState(false)
  const [swapMsg, setSwapMsg] = useState('')

  // Claim open shift
  const [claimingId, setClaimingId] = useState<number | null>(null)

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
    const [meRes, shiftsRes, ptoRes, toRes, entriesRes, openRes, swapRes, coworkerRes] = await Promise.all([
      fetch('/api/employee/me', { headers }),
      fetch('/api/employee/shifts', { headers }),
      fetch('/api/employee/pto-balance', { headers }),
      fetch('/api/employee/time-off', { headers }),
      fetch('/api/employee/time-entries', { headers }),
      fetch('/api/employee/open-shifts', { headers }),
      fetch('/api/employee/swap-requests', { headers }),
      fetch('/api/employee/coworker-shifts', { headers }),
    ])
    const [me, sh, pto, to, ents, open, swaps, coworkers] = await Promise.all([
      meRes.json(), shiftsRes.json(), ptoRes.json(), toRes.json(), entriesRes.json(),
      openRes.json(), swapRes.json(), coworkerRes.json(),
    ])

    if (!me.employee) { window.location.href = '/'; return }

    setEmployee(me.employee)
    setShifts(sh.shifts ?? [])
    setOpenShifts(open.shifts ?? [])
    setSwapRequests(swaps.swaps ?? [])
    setCoworkerShifts(coworkers.shifts ?? [])
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

  async function claimShift(shiftId: number) {
    setClaimingId(shiftId)
    const res = await fetch('/api/employee/claim-shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shiftId }),
    })
    const data = await res.json()
    if (res.ok) {
      setOpenShifts(prev => prev.filter(s => s.id !== shiftId))
      const claimed = openShifts.find(s => s.id === shiftId)
      if (claimed) setShifts(prev => [...prev, { ...claimed, status: undefined }].sort((a, b) => a.shift_date.localeCompare(b.shift_date)))
    } else {
      alert(data.error ?? 'Could not claim shift.')
    }
    setClaimingId(null)
  }

  async function submitSwapRequest() {
    if (!swapShiftId) return
    setSwapSaving(true); setSwapMsg('')
    const res = await fetch('/api/employee/swap-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requesterShiftId: swapShiftId,
        targetShiftId: swapTargetShiftId || null,
        targetEmployeeId: swapTargetShiftId ? (coworkerShifts.find(s => s.id === Number(swapTargetShiftId))?.employee_id ?? null) : null,
        notes: swapNotes,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setSwapMsg('Swap request sent!')
      setSwapShiftId(null); setSwapTargetShiftId(''); setSwapNotes('')
      setSwapRequests(prev => [data.swap, ...prev])
    } else {
      setSwapMsg(data.error ?? 'Error')
    }
    setSwapSaving(false); setTimeout(() => setSwapMsg(''), 3000)
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f5f6fa' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )

  const initials = employee?.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '0 2rem', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{employee?.name}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{employee?.role}</div>
          </div>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#185fa5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
            {initials}
          </div>
          <button onClick={signOut} style={{ fontSize: '12px', color: '#aaa', background: 'none', border: '1px solid #e5e5e5', borderRadius: '6px', cursor: 'pointer', padding: '5px 10px' }}>Sign out</button>
        </div>
      </div>

      {/* Page body */}
      <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Greeting row */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a' }}>
            {greeting()}, {employee?.name.split(' ')[0]}
          </div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '3px' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {/* Two-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.25rem', alignItems: 'start' }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Clock in / out */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>Time clock</div>
              {currentEntry ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#27ae60', fontWeight: 600, marginBottom: '4px' }}>&#9679; Clocked in</div>
                    <div style={{ fontSize: '36px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{elapsed(currentEntry.clock_in)}</div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '5px' }}>Since {fmtTime(currentEntry.clock_in)}</div>
                  </div>
                  <button
                    onClick={clockOut}
                    disabled={clockLoading}
                    style={{ padding: '11px 28px', borderRadius: '9px', border: 'none', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {clockLoading ? 'Clocking out...' : 'Clock out'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: '#888', marginBottom: '2px' }}>
                      {todayShift
                        ? `Today: ${fmt(todayShift.start_time)} – ${fmt(todayShift.end_time)}`
                        : 'No shift scheduled today'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#bbb' }}>Ready to start your shift?</div>
                  </div>
                  <button
                    onClick={clockIn}
                    disabled={clockLoading}
                    style={{ padding: '11px 28px', borderRadius: '9px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {clockLoading ? 'Clocking in...' : 'Clock in'}
                  </button>
                </div>
              )}
              {clockMsg && <div style={{ marginTop: '0.75rem', fontSize: '13px', color: clockMsg.includes('Error') || clockMsg.includes('Already') ? '#c0392b' : '#27ae60' }}>{clockMsg}</div>}
            </div>

            {/* Upcoming shifts */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>Schedule</div>

              {todayShift && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '9px', background: '#f0f6ff', border: '1px solid #d0e4fa', marginBottom: '10px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#185fa5' }}>Today</div>
                    <div style={{ fontSize: '13px', color: '#333', marginTop: '1px' }}>{fmt(todayShift.start_time)} – {fmt(todayShift.end_time)}{todayShift.notes ? ` · ${todayShift.notes}` : ''}</div>
                  </div>
                </div>
              )}

              {upcomingShifts.length === 0 && !todayShift ? (
                <div style={{ fontSize: '13px', color: '#bbb', padding: '4px 0' }}>No upcoming shifts scheduled.</div>
              ) : (
                upcomingShifts.slice(0, 8).map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ width: '90px', fontSize: '12px', color: '#888', flexShrink: 0 }}>
                      {fmtDate(s.shift_date)}
                    </div>
                    <div style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#222' }}>{fmt(s.start_time)} – {fmt(s.end_time)}</div>
                    {s.notes && <div style={{ fontSize: '11px', color: '#bbb', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.notes}</div>}
                    {swapShiftId === s.id ? (
                      <button onClick={() => setSwapShiftId(null)} style={{ fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Cancel</button>
                    ) : (
                      <button
                        onClick={() => { setSwapShiftId(s.id); setSwapTargetShiftId(''); setSwapNotes('') }}
                        style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '5px', border: '1px solid #dde1ea', background: '#fff', cursor: 'pointer', color: '#555', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        ⇔ Swap
                      </button>
                    )}
                  </div>
                ))
              )}

              {/* Swap request form */}
              {swapShiftId != null && (
                <div style={{ marginTop: '1rem', background: '#f9fafb', borderRadius: '10px', padding: '1rem', border: '1px solid #eee' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.75rem' }}>Request shift swap</div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Swap with (optional)</label>
                    <select
                      value={swapTargetShiftId}
                      onChange={e => setSwapTargetShiftId(e.target.value ? Number(e.target.value) : '')}
                      style={{ width: '100%', fontSize: '13px', padding: '7px 9px', border: '1px solid #dde1ea', borderRadius: '7px' }}
                    >
                      <option value="">— Let manager find cover —</option>
                      {coworkerShifts.map(cs => (
                        <option key={cs.id} value={cs.id}>
                          {cs.employee_name} · {fmtDate(cs.shift_date)} {fmt(cs.start_time)}–{fmt(cs.end_time)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Reason (optional)</label>
                    <input value={swapNotes} onChange={e => setSwapNotes(e.target.value)} placeholder="e.g. Doctor appointment"
                      style={{ width: '100%', fontSize: '13px', padding: '7px 9px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                  </div>
                  <button
                    onClick={submitSwapRequest}
                    disabled={swapSaving}
                    style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                    {swapSaving ? 'Sending...' : 'Send swap request'}
                  </button>
                  {swapMsg && <div style={{ marginTop: '0.5rem', fontSize: '13px', color: swapMsg.includes('Error') ? '#c0392b' : '#27ae60' }}>{swapMsg}</div>}
                </div>
              )}
            </div>

            {/* Open shifts */}
            {openShifts.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #d1fae5' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>
                  Open shifts — available to claim
                </div>
                {openShifts.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f0fdf4' }}>
                    <div style={{ width: '90px', fontSize: '12px', color: '#888', flexShrink: 0 }}>{fmtDate(s.shift_date)}</div>
                    <div style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{fmt(s.start_time)} – {fmt(s.end_time)}</div>
                    {s.notes && <div style={{ fontSize: '11px', color: '#aaa' }}>{s.notes}</div>}
                    <button
                      onClick={() => claimShift(s.id)}
                      disabled={claimingId === s.id}
                      style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '7px', border: 'none', background: '#166534', color: '#fff', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                      {claimingId === s.id ? '...' : 'Claim'}
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Hours this week */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>This week</div>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{weeklyHrs}h{weeklyMinsRem > 0 ? ` ${weeklyMinsRem}m` : ''}</div>
                  <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>Hours worked</div>
                </div>
                {currentEntry && (
                  <div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#27ae60', lineHeight: 1 }}>{elapsed(currentEntry.clock_in)}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>This session</div>
                  </div>
                )}
              </div>
              <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${Math.min((weeklyMins / (40 * 60)) * 100, 100)}%`, background: weeklyMins >= 40 * 60 ? '#c0392b' : '#185fa5', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '11px', color: '#bbb', marginTop: '5px' }}>{Math.round((weeklyMins / (40 * 60)) * 100)}% of 40h week</div>
            </div>

            {/* Time off */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Time off</div>
                <button
                  onClick={() => setShowTOForm(v => !v)}
                  style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid #dde1ea', background: showTOForm ? '#f0f2f5' : '#fff', cursor: 'pointer', fontWeight: 500 }}
                >
                  {showTOForm ? 'Cancel' : '+ Request'}
                </button>
              </div>

              {ptoBalance && (
                <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f5f5f5' }}>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a' }}>{ptoBalance.remaining}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Remaining</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#999' }}>{ptoBalance.used}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Used</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#ccc' }}>{ptoBalance.total}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Total</div>
                  </div>
                </div>
              )}

              {showTOForm && (
                <div style={{ background: '#f9fafb', borderRadius: '9px', padding: '1rem', marginBottom: '1rem', border: '1px solid #eee' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.65rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>From</label>
                      <input type="date" value={toStart} onChange={e => setToStart(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>To</label>
                      <input type="date" value={toEnd} onChange={e => setToEnd(e.target.value)} min={toStart} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Type</label>
                    <select value={toType} onChange={e => setToType(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }}>
                      <option>PTO</option><option>Sick</option><option>Personal</option><option>Unpaid</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Reason (optional)</label>
                    <input value={toReason} onChange={e => setToReason(e.target.value)} placeholder="e.g. Doctor appointment" style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
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
                <div>
                  {timeOffRequests.slice(0, 5).map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
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

            {/* Swap requests */}
            {swapRequests.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>My swap requests</div>
                {swapRequests.slice(0, 5).map(sr => {
                  const myShift = shifts.find(s => s.id === sr.requester_shift_id)
                  const swapStatusColor = sr.status === 'approved' ? '#27ae60' : sr.status === 'denied' ? '#c0392b' : '#e67e22'
                  return (
                    <div key={sr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div style={{ fontSize: '12px', color: '#555' }}>
                        {myShift ? fmtDate(myShift.shift_date) : `Shift #${sr.requester_shift_id}`}
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: swapStatusColor, textTransform: 'capitalize' }}>{sr.status}</span>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
