'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import CalloutModal from '../components/CalloutModal'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type BusinessHours = Record<DayKey, { open: string; close: string; closed: boolean }>
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

type Employee = { id: number; name: string; role: string; pay_type: string; pay_rate: number | null }
type Shift = { id: number; employee_id: number | null; shift_date: string; start_time: string; end_time: string; notes: string | null; status?: string; is_open_shift?: boolean }
type ShiftSwap = { id: number; requester_employee_id: number; requester_shift_id: number; target_employee_id: number | null; target_shift_id: number | null; status: string; notes: string | null; created_at: string }
type TimeOffRequest = { id: number; employee_id: number; start_date: string; end_date: string; type: string; reason: string | null; status: string; created_at: string }
type TimeEntry = { id: number; employee_id: number; clock_in: string; clock_out: string | null; total_minutes: number | null }
type Availability = { employee_id: number; day_of_week: number; start_time: string; end_time: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(t: string) {
  const [h, m] = t.split(':'); const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`
}
function fmtMins(mins: number) {
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function fmtDate(iso: string) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function elapsed(clockIn: string) { return fmtMins(Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)) }
function weekStartISO() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString()
}
function getWeekDays(offset: number) {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + offset * 7); d.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(d.getDate() + i); return day.toISOString().slice(0, 10) })
}
// Stable per-employee color palette
const EMP_COLORS = [
  { bg: '#dbeafe', text: '#1e40af' },
  { bg: '#dcfce7', text: '#166534' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#ede9fe', text: '#6d28d9' },
  { bg: '#ffedd5', text: '#9a3412' },
  { bg: '#cffafe', text: '#155e75' },
  { bg: '#d1fae5', text: '#065f46' },
  { bg: '#fee2e2', text: '#991b1b' },
  { bg: '#f3e8ff', text: '#7e22ce' },
]

function getMonthGrid(offset: number) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const year = d.getFullYear(); const month = d.getMonth()
  const firstDay = new Date(year, month, 1)
  const start = new Date(firstDay); start.setDate(1 - firstDay.getDay())
  return {
    label: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    month,
    days: Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start); day.setDate(start.getDate() + i)
      return { iso: day.toISOString().slice(0, 10), inMonth: day.getMonth() === month }
    }),
  }
}

function shiftHours(s: Shift) {
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60
}

// Role → dark-theme color mapping for schedule grid
function getRoleColor(role: string): { bg: string; text: string; border: string } {
  const r = role.toLowerCase()
  if (r.includes('cashier'))                             return { bg: 'rgba(29,78,216,0.18)',  text: '#93c5fd', border: 'rgba(29,78,216,0.32)' }
  if (r.includes('floor'))                               return { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80', border: 'rgba(34,197,94,0.28)' }
  if (r.includes('lead') || r.includes('manager'))       return { bg: 'rgba(245,158,11,0.16)', text: '#fbbf24', border: 'rgba(245,158,11,0.28)' }
  if (r.includes('stock'))                               return { bg: 'rgba(139,92,246,0.16)', text: '#c4b5fd', border: 'rgba(139,92,246,0.28)' }
  return                                                        { bg: 'rgba(100,116,139,0.14)', text: '#94a3b8', border: 'rgba(100,116,139,0.22)' }
}

export default function TimePage() {
  const router = useRouter()
  const [tab, setTab] = useState<'shifts' | 'timeoff' | 'timesheets'>('shifts')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [requests, setRequests] = useState<TimeOffRequest[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [ticker, setTicker] = useState(0)

  // Shift form
  const [showShiftForm, setShowShiftForm] = useState(false)
  const [shiftEmpId, setShiftEmpId] = useState<number | ''>('')
  const [shiftDate, setShiftDate] = useState('')
  const [shiftStart, setShiftStart] = useState('09:00')
  const [shiftEnd, setShiftEnd] = useState('17:00')
  const [shiftNotes, setShiftNotes] = useState('')
  const [savingShift, setSavingShift] = useState(false)
  const [shiftMsg, setShiftMsg] = useState('')
  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatWeeks, setRepeatWeeks] = useState(1)
  const [shiftIsOpen, setShiftIsOpen] = useState(false)
  const [swapRequests, setSwapRequests] = useState<ShiftSwap[]>([])

  // Weekly / monthly view
  const [weekOffset, setWeekOffset] = useState(0)
  const [shiftView, setShiftView] = useState<'grid' | 'week' | 'month'>('grid')
  const [monthOffset, setMonthOffset] = useState(0)

  // Generate schedule
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [genWeekStart, setGenWeekStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10)
  })

  // Business hours
  const [bizHours, setBizHours] = useState<BusinessHours | null>(null)

  // Callout modal
  type CalloutTarget = { shiftId: number; shiftDate: string; startTime: string; endTime: string; employee: { id: number; name: string } }
  const [calloutTarget, setCalloutTarget] = useState<CalloutTarget | null>(null)

  useEffect(() => {
    load()
    const t = setInterval(() => setTicker(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)

    // Load business hours
    fetch('/api/settings/business', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json()).then(d => { if (d.profile?.business_hours) setBizHours(d.profile.business_hours) })

    const [{ data: emps }, { data: sh }, { data: reqs }, { data: ents }] = await Promise.all([
      supabase.from('employees').select('id, name, role, pay_type, pay_rate').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('shifts').select('*').eq('user_id', session.user.id).order('shift_date'),
      supabase.from('time_off_requests').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('time_entries').select('*').eq('user_id', session.user.id).gte('clock_in', weekStartISO()).order('clock_in', { ascending: false }),
    ])

    const empList = emps ?? []
    setEmployees(empList)
    setShifts(sh ?? [])
    setRequests(reqs ?? [])
    setEntries(ents ?? [])

    if (empList.length > 0) {
      const { data: avail } = await supabase.from('employee_availability').select('*').in('employee_id', empList.map(e => e.id))
      if (avail) setAvailability(avail)
    }

    const { data: swaps } = await supabase
      .from('shift_swaps')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setSwapRequests(swaps ?? [])

    setLoading(false)
  }

  // ── Shift actions ─────────────────────────────────────────────────────────

  async function handleAddShift() {
    if (!shiftIsOpen && !shiftEmpId) { setShiftMsg('Select an employee or mark as open shift.'); return }
    if (!shiftDate) { setShiftMsg('Select a date.'); return }
    setSavingShift(true)

    const baseDate = new Date(shiftDate + 'T00:00:00')
    const shiftsToInsert = Array.from({ length: repeatWeeks }, (_, i) => {
      const d = new Date(baseDate); d.setDate(baseDate.getDate() + i * 7)
      return {
        user_id: userId,
        employee_id: shiftIsOpen ? null : shiftEmpId,
        is_open_shift: shiftIsOpen,
        shift_date: d.toISOString().slice(0, 10),
        start_time: shiftStart, end_time: shiftEnd,
        notes: shiftNotes.trim() || null,
      }
    })

    const { data, error } = await supabase.from('shifts').insert(shiftsToInsert).select()
    if (error) { setShiftMsg('Error saving.') }
    else {
      setShifts(prev => [...prev, ...(data ?? [])].sort((a, b) => a.shift_date.localeCompare(b.shift_date)))
      setShiftMsg(repeatWeeks > 1 ? `${repeatWeeks} shifts added.` : 'Shift added.')
      setShowShiftForm(false); setShiftEmpId(''); setShiftDate(''); setShiftNotes('')
      setRepeatEnabled(false); setRepeatWeeks(1); setShiftIsOpen(false)
      setTimeout(() => setShiftMsg(''), 2500)
    }
    setSavingShift(false)
  }

  async function handleDeleteShift(id: number) {
    await supabase.from('shifts').delete().eq('id', id)
    setShifts(prev => prev.filter(s => s.id !== id))
  }

  async function handleSwapDecision(
    swapId: number, status: 'approved' | 'denied',
    reqShiftId: number | null, tgtShiftId: number | null,
    reqEmpId: number | null, tgtEmpId: number | null,
  ) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch(`/api/shifts/swaps/${swapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ status }),
    })
    if (status === 'approved' && reqShiftId && tgtShiftId && reqEmpId !== null && tgtEmpId !== null) {
      await supabase.from('shifts').update({ employee_id: tgtEmpId }).eq('id', reqShiftId)
      await supabase.from('shifts').update({ employee_id: reqEmpId }).eq('id', tgtShiftId)
      setShifts(prev => prev.map(s => {
        if (s.id === reqShiftId) return { ...s, employee_id: tgtEmpId }
        if (s.id === tgtShiftId) return { ...s, employee_id: reqEmpId }
        return s
      }))
    }
    setSwapRequests(prev => prev.filter(s => s.id !== swapId))
  }

  function openShiftFormForDate(dateStr: string) {
    const dayKey = DAY_KEYS[new Date(dateStr + 'T00:00:00').getDay()]
    const hours = bizHours?.[dayKey]
    setShiftDate(dateStr); setShiftEmpId('')
    setShiftStart(hours && !hours.closed ? hours.open : '09:00')
    setShiftEnd(hours && !hours.closed ? hours.close : '17:00')
    setShiftNotes('')
    setShowShiftForm(true)
  }

  // ── Time off actions ──────────────────────────────────────────────────────

  async function handleTimeOff(id: number, status: 'approved' | 'denied') {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch(`/api/time-off/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ status }),
    })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  // ── Generate schedule ─────────────────────────────────────────────────────

  async function generateSchedule() {
    if (!availability.length) { setGenMsg('No employee availability set yet.'); return }
    setGenerating(true); setGenMsg('')
    const weekStart = new Date(genWeekStart + 'T00:00:00')
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d.toISOString().slice(0, 10)
    })
    const approvedOff = requests.filter(r => r.status === 'approved')
    const isOff = (empId: number, date: string) => approvedOff.some(r => r.employee_id === empId && r.start_date <= date && r.end_date >= date)
    const existing = shifts.filter(s => weekDates.includes(s.shift_date))
    const newShifts: object[] = []
    weekDates.forEach((date, i) => {
      const dayKey = DAY_KEYS[i]
      const dayHours = bizHours?.[dayKey]
      // Skip days the business is closed
      if (dayHours?.closed) return
      availability.filter(a => a.day_of_week === i && !isOff(a.employee_id, date) && !existing.some(s => s.employee_id === a.employee_id && s.shift_date === date))
        .forEach(a => {
          // Clamp shift times to business hours if set
          const start = dayHours ? (a.start_time < dayHours.open ? dayHours.open : a.start_time) : a.start_time
          const end = dayHours ? (a.end_time > dayHours.close ? dayHours.close : a.end_time) : a.end_time
          if (start >= end) return // skip zero-length shifts after clamping
          newShifts.push({ user_id: userId, employee_id: a.employee_id, shift_date: date, start_time: start, end_time: end, notes: 'Auto-generated' })
        })
    })
    if (!newShifts.length) { setGenMsg('No new shifts to generate.'); setGenerating(false); return }
    const { error } = await supabase.from('shifts').insert(newShifts)
    if (error) setGenMsg('Error generating schedule.')
    else { setGenMsg(`Generated ${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''}.`); load() }
    setGenerating(false); setTimeout(() => setGenMsg(''), 4000)
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const empMap = Object.fromEntries(employees.map(e => [e.id, e]))
  const today = new Date().toISOString().slice(0, 10)
  const weekDays = getWeekDays(weekOffset)
  const weekStart = new Date(weekDays[0] + 'T00:00:00')
  const weekEnd = new Date(weekDays[6] + 'T00:00:00')
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Scheduled hours + estimated cost this week
  const weekShifts = shifts.filter(s => weekDays.includes(s.shift_date) && s.status !== 'called_out')
  const scheduledHours = weekShifts.reduce((sum, s) => sum + shiftHours(s), 0)
  const estimatedCost = weekShifts.reduce((sum, s) => {
    const emp = s.employee_id != null ? empMap[s.employee_id] : null
    if (!emp?.pay_rate) return sum
    const hrs = shiftHours(s)
    return sum + (emp.pay_type === 'salary' ? (emp.pay_rate / 52 / 40) * hrs : emp.pay_rate * hrs)
  }, 0)

  // Timesheet data
  const clockedIn = entries.filter(e => !e.clock_out)
  const completed = entries.filter(e => e.clock_out)
  const weeklyHours = new Map<number, number>()
  for (const e of completed) weeklyHours.set(e.employee_id, (weeklyHours.get(e.employee_id) ?? 0) + (e.total_minutes ?? 0))

  // Flagged: active entries > 10h
  const flagged = clockedIn.filter(e => (Date.now() - new Date(e.clock_in).getTime()) > 10 * 60 * 60 * 1000)

  // On-time rate: clock_in within 10 min of scheduled start
  let onTimeCount = 0; let onTimeTotal = 0
  for (const e of [...completed, ...clockedIn]) {
    const matchingShift = shifts.find(s => s.employee_id === e.employee_id && s.shift_date === e.clock_in.slice(0, 10))
    if (!matchingShift) continue
    onTimeTotal++
    const [sh, sm] = matchingShift.start_time.split(':').map(Number)
    const scheduledMs = new Date(e.clock_in.slice(0, 10) + 'T00:00:00').getTime() + (sh * 60 + sm) * 60000
    if (new Date(e.clock_in).getTime() <= scheduledMs + 10 * 60000) onTimeCount++
  }
  const onTimeRate = onTimeTotal > 0 ? Math.round((onTimeCount / onTimeTotal) * 100) : null

  const pendingRequests = requests.filter(r => r.status === 'pending')
  const pendingSwaps = swapRequests.filter(s => s.status === 'pending')

  if (loading) return (
    <div className="dash-wrap"><Nav active="time" />
      <div className="dash-content"><div className="loading-state">Loading...</div></div>
    </div>
  )

  return (
    <>
    <div className="dash-wrap">
      <Nav active="time" />
      <div className="dash-content">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Time</div>
          <button
            onClick={() => { setShowShiftForm(true); setTab('shifts') }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', background: '#1d4ed8', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add shift
          </button>
        </div>

        {/* Stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9', letterSpacing: '-0.02em' }}>{scheduledHours % 1 === 0 ? scheduledHours : scheduledHours.toFixed(1)}h</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Scheduled this week</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9', letterSpacing: '-0.02em' }}>{estimatedCost > 0 ? `$${estimatedCost.toFixed(0)}` : '—'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Est. labor cost</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: clockedIn.length > 0 ? '#4ade80' : '#475569', letterSpacing: '-0.02em' }}>{clockedIn.length}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Clocked in now</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: onTimeRate === null ? '#475569' : onTimeRate >= 80 ? '#4ade80' : '#fbbf24', letterSpacing: '-0.02em' }}>{onTimeRate !== null ? `${onTimeRate}%` : '—'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>On-time this week</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '1.25rem' }}>
          {([['shifts', 'Shifts'], ['timeoff', `Time Off${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}`], ['timesheets', 'Timesheets']] as [typeof tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '8px 18px', fontWeight: tab === key ? 600 : 400, fontSize: '13px', color: tab === key ? '#93c5fd' : '#64748b', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: '-1px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── SHIFTS TAB ── */}
        {tab === 'shifts' && (
          <div>
            {showShiftForm && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '14px', color: '#f1f5f9' }}>
                  {shiftDate ? `New shift — ${new Date(shiftDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}` : 'New shift'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => { setShiftIsOpen(v => !v); if (!shiftIsOpen) setShiftEmpId('') }}
                    style={{ fontSize: '12px', fontWeight: 500, padding: '4px 12px', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${shiftIsOpen ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`, background: shiftIsOpen ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)', color: shiftIsOpen ? '#4ade80' : '#94a3b8', transition: 'all 0.15s', fontFamily: 'inherit' }}
                  >
                    {shiftIsOpen ? '✓ Open shift (no employee)' : 'Open shift — post to pool'}
                  </button>
                </div>
                <div className="row2" style={{ marginBottom: '0.75rem' }}>
                  {!shiftIsOpen && (
                    <div className="field"><label>Employee</label>
                      <select value={shiftEmpId} onChange={e => setShiftEmpId(Number(e.target.value))}>
                        <option value="">Select...</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="field"><label>Date</label><input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} /></div>
                </div>
                <div className="row2" style={{ marginBottom: '0.75rem' }}>
                  <div className="field"><label>Start time</label><input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} /></div>
                  <div className="field"><label>End time</label><input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} /></div>
                </div>
                <div className="field" style={{ marginBottom: '0.75rem' }}>
                  <label>Notes (optional)</label><input value={shiftNotes} onChange={e => setShiftNotes(e.target.value)} placeholder="e.g. Opening shift" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={repeatEnabled} onChange={e => { setRepeatEnabled(e.target.checked); if (!e.target.checked) setRepeatWeeks(1) }} />
                    Repeat weekly for
                  </label>
                  {repeatEnabled && (
                    <select value={repeatWeeks} onChange={e => setRepeatWeeks(Number(e.target.value))} style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', background: '#0f172a', color: '#e2e8f0' }}>
                      {[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>{n} weeks</option>)}
                    </select>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button style={{ padding: '7px 16px', borderRadius: '8px', background: '#1d4ed8', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }} onClick={handleAddShift} disabled={savingShift}>{savingShift ? 'Saving…' : 'Save shift'}</button>
                  <button style={{ padding: '7px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => { setShowShiftForm(false); setShiftIsOpen(false); setRepeatEnabled(false); setRepeatWeeks(1) }}>Cancel</button>
                  {shiftMsg && <span style={{ fontSize: '12px', color: '#4ade80' }}>{shiftMsg}</span>}
                </div>
              </div>
            )}

            {/* Generate */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
              <span style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>Auto-generate from availability</span>
              <input type="date" value={genWeekStart} onChange={e => setGenWeekStart(e.target.value)} style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', background: '#0f172a', color: '#94a3b8' }} />
              <button style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }} onClick={generateSchedule} disabled={generating}>{generating ? 'Generating…' : 'Generate week'}</button>
              {genMsg && <span style={{ fontSize: '12px', color: genMsg.startsWith('Error') || genMsg.startsWith('No employee') || genMsg.startsWith('No new') ? '#f87171' : '#4ade80' }}>{genMsg}</span>}
            </div>

            {/* Open shift pool */}
            {(() => {
              const openPool = shifts.filter(s => s.is_open_shift && !s.employee_id)
              if (!openPool.length) return null
              return (
                <div style={{ background: '#1e293b', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Open shift pool</span>
                    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: '#4ade80', borderRadius: '10px', padding: '1px 7px' }}>{openPool.length}</span>
                  </div>
                  {openPool.map(s => {
                    const isPast = s.shift_date < today
                    return (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: isPast ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isPast ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)'}`, marginBottom: '0.5rem' }}>
                        <div style={{ width: '110px', fontSize: '12px', flexShrink: 0, color: isPast ? '#f87171' : '#94a3b8' }}>
                          {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {isPast && <span style={{ display: 'block', fontSize: '10px', color: '#fbbf24' }}>overdue</span>}
                        </div>
                        <div style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>
                          {fmt(s.start_time)} – {fmt(s.end_time)}
                          {s.notes && <span style={{ fontWeight: 400, color: '#64748b', fontSize: '12px' }}> · {s.notes}</span>}
                        </div>
                        <select
                          defaultValue=""
                          onChange={async e => {
                            const empId = Number(e.target.value)
                            if (!empId) return
                            await supabase.from('shifts').update({ employee_id: empId, is_open_shift: false }).eq('id', s.id)
                            setShifts(prev => prev.map(sh => sh.id === s.id ? { ...sh, employee_id: empId, is_open_shift: false } : sh))
                          }}
                          style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer', background: '#0f172a', color: '#e2e8f0' }}
                        >
                          <option value="">Assign to…</option>
                          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <button onClick={() => handleDeleteShift(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '18px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Pending swap requests */}
            {pendingSwaps.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Swap requests</span>
                  <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', borderRadius: '10px', padding: '1px 7px' }}>{pendingSwaps.length}</span>
                </div>
                {pendingSwaps.map(swap => {
                  const requester = empMap[swap.requester_employee_id]
                  const target = swap.target_employee_id != null ? empMap[swap.target_employee_id] : null
                  const reqShift = shifts.find(s => s.id === swap.requester_shift_id)
                  const tgtShift = swap.target_shift_id != null ? shifts.find(s => s.id === swap.target_shift_id) : null
                  return (
                    <div key={swap.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', background: '#fffbf5', border: '1px solid #fde8c8', marginBottom: '0.5rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>
                          {requester?.name ?? '?'} wants to swap{target ? ` with ${target.name}` : ''}
                        </div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                          {reqShift ? `Their shift: ${fmtDate(reqShift.shift_date)} ${fmt(reqShift.start_time)}–${fmt(reqShift.end_time)}` : ''}
                          {tgtShift ? ` ↔ ${fmtDate(tgtShift.shift_date)} ${fmt(tgtShift.start_time)}–${fmt(tgtShift.end_time)}` : ''}
                          {swap.notes ? ` · "${swap.notes}"` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          onClick={() => handleSwapDecision(swap.id, 'approved', swap.requester_shift_id, swap.target_shift_id, swap.requester_employee_id, swap.target_employee_id)}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #27ae60', background: '#f0faf4', color: '#27ae60', cursor: 'pointer', fontWeight: 500 }}>
                          Approve
                        </button>
                        <button
                          onClick={() => handleSwapDecision(swap.id, 'denied', null, null, null, null)}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e0e0e0', background: '#fafafa', color: '#c0392b', cursor: 'pointer', fontWeight: 500 }}>
                          Deny
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* View toggle */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem' }}>
              {(['grid', 'week', 'month'] as const).map(v => (
                <button key={v} onClick={() => setShiftView(v)} style={{ padding: '5px 14px', fontSize: '12px', fontWeight: shiftView === v ? 600 : 400, borderRadius: '6px', border: `1px solid ${shiftView === v ? 'rgba(29,78,216,0.6)' : 'rgba(255,255,255,0.08)'}`, background: shiftView === v ? 'rgba(29,78,216,0.25)' : 'rgba(255,255,255,0.03)', color: shiftView === v ? '#93c5fd' : '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {v === 'grid' ? 'Schedule' : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>

            {/* ── GRID VIEW (Schedule) ── */}
            {shiftView === 'grid' && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem', overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o - 1)}>←</button>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>{weekLabel}</div>
                  <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o + 1)}>→</button>
                </div>
                <div style={{ minWidth: '560px' }}>
                  {/* Day header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '130px repeat(7, 1fr)', gap: '4px', marginBottom: '6px' }}>
                    <div />
                    {weekDays.map((dateStr, i) => {
                      const isToday = dateStr === today
                      const dayNum = new Date(dateStr + 'T00:00:00').getDate()
                      return (
                        <div key={dateStr} style={{ textAlign: 'center', padding: '6px 4px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: isToday ? '#93c5fd' : '#475569' }}>
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}
                          </div>
                          <div style={{ fontSize: '14px', fontWeight: isToday ? 700 : 400, color: isToday ? '#93c5fd' : '#94a3b8', marginTop: '1px' }}>
                            {dayNum}
                          </div>
                          {isToday && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#3b82f6', margin: '3px auto 0' }} />}
                        </div>
                      )
                    })}
                  </div>

                  {/* Employee rows */}
                  {employees.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }}>No employees yet.</div>
                  ) : employees.map(emp => {
                    const rc = getRoleColor(emp.role)
                    return (
                      <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '130px repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
                        {/* Name cell */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', minWidth: 0 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: rc.bg, color: rc.text, fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${rc.border}` }}>
                            {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name.split(' ')[0]}</div>
                            <div style={{ fontSize: '10px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.role}</div>
                          </div>
                        </div>
                        {/* Day cells */}
                        {weekDays.map(dateStr => {
                          const dayShift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr && !s.is_open_shift)
                          const isToday = dateStr === today
                          const isCallout = dayShift?.status === 'called_out'
                          const cellColor = isCallout
                            ? { bg: 'rgba(239,68,68,0.15)', text: '#f87171', border: 'rgba(239,68,68,0.3)' }
                            : dayShift ? rc : null
                          return (
                            <div
                              key={dateStr}
                              onClick={() => { if (!dayShift) { openShiftFormForDate(dateStr); setShiftEmpId(emp.id) } }}
                              style={{
                                borderRadius: '6px',
                                minHeight: '54px',
                                padding: '6px',
                                cursor: dayShift ? 'default' : 'pointer',
                                background: cellColor ? cellColor.bg : isToday ? 'rgba(29,78,216,0.06)' : 'rgba(255,255,255,0.02)',
                                border: cellColor ? `1px solid ${cellColor.border}` : `1px dashed rgba(255,255,255,${isToday ? '0.12' : '0.05'})`,
                                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
                                transition: 'border-color 0.1s',
                              }}
                              onMouseEnter={e => { if (!dayShift) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(29,78,216,0.5)' }}
                              onMouseLeave={e => { if (!dayShift) (e.currentTarget as HTMLDivElement).style.borderColor = isToday ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)' }}
                            >
                              {dayShift ? (
                                <div>
                                  <div style={{ fontSize: '11px', fontWeight: 600, color: cellColor!.text }}>
                                    {isCallout ? 'Called out' : `${fmt(dayShift.start_time)}–${fmt(dayShift.end_time)}`}
                                  </div>
                                  {!isCallout && (
                                    <div style={{ fontSize: '10px', color: cellColor!.text, opacity: 0.65, marginTop: '2px' }}>
                                      {shiftHours(dayShift) % 1 === 0 ? shiftHours(dayShift) : shiftHours(dayShift).toFixed(1)}h
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div style={{ fontSize: '10px', color: '#334155', textAlign: 'center' }}>+ add</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}

                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {[
                      { label: 'Cashier',  bg: 'rgba(29,78,216,0.35)' },
                      { label: 'Floor',    bg: 'rgba(34,197,94,0.3)' },
                      { label: 'Lead',     bg: 'rgba(245,158,11,0.3)' },
                      { label: 'Stock',    bg: 'rgba(139,92,246,0.3)' },
                      { label: 'Callout',  bg: 'rgba(239,68,68,0.35)' },
                    ].map(c => (
                      <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '2px', background: c.bg }} />
                        <span style={{ fontSize: '11px', color: '#64748b' }}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── WEEK VIEW ── */}
            {shiftView === 'week' && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o - 1)}>←</button>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>{weekLabel}</div>
                  <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o + 1)}>→</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
                  {weekDays.map((dateStr, i) => {
                    const dayShifts = shifts.filter(s => s.shift_date === dateStr)
                    const isToday = dateStr === today
                    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]
                    const dayNum = new Date(dateStr + 'T00:00:00').getDate()
                    return (
                      <div key={dateStr} onClick={() => openShiftFormForDate(dateStr)}
                        style={{ minHeight: '100px', border: `1px solid ${isToday ? '#185fa5' : '#eee'}`, borderRadius: '8px', padding: '8px', background: isToday ? '#f0f6ff' : '#fafafa', cursor: 'pointer', transition: 'border-color 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#185fa5')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = isToday ? '#185fa5' : '#eee')}
                      >
                        <div style={{ fontSize: '11px', fontWeight: 600, color: isToday ? '#185fa5' : '#888', marginBottom: '6px' }}>{dayName} {dayNum}</div>
                        {dayShifts.length === 0 ? (
                          <div style={{ fontSize: '10px', color: '#ccc' }}>+ Add</div>
                        ) : dayShifts.map(s => {
                          const isCalledOut = s.status === 'called_out'
                          const isOpen = s.is_open_shift && !s.employee_id
                          const emp = s.employee_id != null ? empMap[s.employee_id] : null
                          const empIdx = s.employee_id != null ? employees.findIndex(e => e.id === s.employee_id) : -1
                          const color = isOpen ? { bg: '#dcfce7', text: '#166534' } : isCalledOut ? { bg: '#fff0f0', text: '#c0392b' } : EMP_COLORS[empIdx >= 0 ? empIdx % EMP_COLORS.length : 0]
                          return (
                            <div key={s.id} style={{ marginBottom: '4px' }}>
                              <div style={{ fontSize: '10px', background: color.bg, color: color.text, borderRadius: '4px', padding: '3px 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '3px', border: isOpen ? '1px dashed #166534' : 'none' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                                  {isOpen ? 'OPEN' : (emp?.name.split(' ')[0] ?? '?')}{isCalledOut ? ' ✗' : ''}
                                </span>
                                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                  {!isCalledOut && !isOpen && emp && (
                                    <button onClick={e => { e.stopPropagation(); setCalloutTarget({ shiftId: s.id, shiftDate: s.shift_date, startTime: s.start_time, endTime: s.end_time, employee: { id: emp.id, name: emp.name } }) }}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e67e22', fontSize: '10px', lineHeight: 1, padding: '0 2px' }} title="Call out">!</button>
                                  )}
                                  <button onClick={e => { e.stopPropagation(); handleDeleteShift(s.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: '11px', lineHeight: 1, padding: 0 }}>×</button>
                                </div>
                              </div>
                              <div style={{ fontSize: '10px', color: isCalledOut ? '#c0392b' : '#888', marginTop: '1px' }}>
                                {isCalledOut ? 'Called out' : `${fmt(s.start_time)}–${fmt(s.end_time)}`}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── MONTH VIEW ── */}
            {shiftView === 'month' && (() => {
              const { label: monthLabel, month: currentMonth, days } = getMonthGrid(monthOffset)
              const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
              return (
                <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
                  {/* Month nav */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setMonthOffset(o => o - 1)}>←</button>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>{monthLabel}</div>
                    <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setMonthOffset(o => o + 1)}>→</button>
                  </div>

                  {/* Employee color legend */}
                  {employees.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.75rem' }}>
                      {employees.map((emp, idx) => {
                        const color = EMP_COLORS[idx % EMP_COLORS.length]
                        return (
                          <span key={emp.id} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: color.bg, color: color.text, fontWeight: 500 }}>
                            {emp.name.split(' ')[0]}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Day headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '3px' }}>
                    {DAY_NAMES.map(d => (
                      <div key={d} style={{ fontSize: '11px', fontWeight: 600, color: '#aaa', textAlign: 'center', padding: '4px 0' }}>{d}</div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
                    {days.map(({ iso, inMonth }) => {
                      const dayShifts = shifts.filter(s => s.shift_date === iso)
                      const isToday = iso === today
                      const dayNum = new Date(iso + 'T00:00:00').getDate()
                      const visible = dayShifts.slice(0, 3)
                      const overflow = dayShifts.length - 3
                      return (
                        <div
                          key={iso}
                          onClick={() => openShiftFormForDate(iso)}
                          style={{
                            minHeight: '80px',
                            border: `1px solid ${isToday ? '#185fa5' : '#eee'}`,
                            borderRadius: '6px',
                            padding: '5px',
                            background: isToday ? '#f0f6ff' : inMonth ? '#fff' : '#f8f8f8',
                            cursor: 'pointer',
                            opacity: inMonth ? 1 : 0.45,
                            transition: 'border-color 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = '#185fa5')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = isToday ? '#185fa5' : '#eee')}
                        >
                          <div style={{ fontSize: '11px', fontWeight: isToday ? 700 : 500, color: isToday ? '#185fa5' : inMonth ? '#333' : '#bbb', marginBottom: '3px' }}>
                            {dayNum}
                          </div>
                          {visible.map(s => {
                            const isOpen = s.is_open_shift && !s.employee_id
                            const empIdx = s.employee_id != null ? employees.findIndex(e => e.id === s.employee_id) : -1
                            const color = isOpen ? { bg: '#dcfce7', text: '#166534' } : s.status === 'called_out' ? { bg: '#fee2e2', text: '#991b1b' } : EMP_COLORS[empIdx >= 0 ? empIdx % EMP_COLORS.length : 0]
                            const emp = s.employee_id != null ? empMap[s.employee_id] : null
                            return (
                              <div
                                key={s.id}
                                title={isOpen ? `Open shift · ${fmt(s.start_time)}–${fmt(s.end_time)}` : `${emp?.name ?? 'Unknown'} · ${fmt(s.start_time)}–${fmt(s.end_time)}${s.status === 'called_out' ? ' · Called out' : ''}`}
                                style={{ fontSize: '10px', background: color.bg, color: color.text, borderRadius: '3px', padding: '2px 4px', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, border: isOpen ? '1px dashed #166534' : 'none' }}
                              >
                                {isOpen ? 'OPEN' : (emp?.name.split(' ')[0] ?? '?')} {s.status !== 'called_out' ? fmt(s.start_time).replace(' AM','a').replace(' PM','p') : '✗'}
                              </div>
                            )
                          })}
                          {overflow > 0 && (
                            <div style={{ fontSize: '10px', color: '#999', fontWeight: 500 }}>+{overflow} more</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ── TIME OFF TAB ── */}
        {tab === 'timeoff' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pendingRequests.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending requests</span>
                  <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, background: 'rgba(29,78,216,0.2)', color: '#93c5fd', borderRadius: '10px', padding: '1px 7px' }}>{pendingRequests.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {pendingRequests.map(req => {
                    const emp = employees.find(e => e.id === req.employee_id)
                    return (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(29,78,216,0.2)', color: '#93c5fd', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {emp ? emp.name.split(' ').map(w => w[0]).join('').slice(0, 2) : '??'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name || 'Employee'} <span style={{ fontWeight: 400, color: '#64748b' }}>— {req.type}</span></div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{fmtDate(req.start_date)} – {fmtDate(req.end_date)}{req.reason ? ` · ${req.reason}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                          <button onClick={() => handleTimeOff(req.id, 'approved')} style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: '#4ade80', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>Approve</button>
                          <button onClick={() => handleTimeOff(req.id, 'denied')} style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>Deny</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>All requests</div>
              {requests.length === 0 ? <div style={{ color: '#475569', fontSize: '13px', padding: '0.5rem 0' }}>No time off requests yet.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {requests.map(req => {
                    const emp = employees.find(e => e.id === req.employee_id)
                    const statusColor = req.status === 'approved' ? '#4ade80' : req.status === 'denied' ? '#f87171' : '#fbbf24'
                    return (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name || 'Employee'} <span style={{ fontWeight: 400, color: '#64748b' }}>— {req.type}</span></div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '1px' }}>{fmtDate(req.start_date)} – {fmtDate(req.end_date)}</div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor, textTransform: 'capitalize' }}>{req.status}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TIMESHEETS TAB ── */}
        {tab === 'timesheets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Flagged anomalies */}
            {flagged.length > 0 && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#f87171', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Anomalies — still clocked in after 10h</div>
                {flagged.map(e => {
                  const emp = empMap[e.employee_id]
                  return (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(239,68,68,0.15)', fontSize: '13px' }}>
                      <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{emp?.name ?? 'Unknown'}</span>
                      <span style={{ color: '#f87171', fontWeight: 600 }}>{elapsed(e.clock_in)} — in at {fmtTime(e.clock_in)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Clocked in now */}
            {clockedIn.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.75rem' }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#4ade80' }} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clocked in now ({clockedIn.length})</span>
                </div>
                {clockedIn.filter(e => !flagged.find(f => f.id === e.id)).map(e => {
                  const emp = empMap[e.employee_id]
                  return (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{emp?.name ?? 'Unknown'}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Since {fmtTime(e.clock_in)}</div>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#4ade80' }}>{elapsed(e.clock_in)}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Weekly hours per employee */}
            {weeklyHours.size > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>Weekly hours</div>
                {[...weeklyHours.entries()].sort((a, b) => b[1] - a[1]).map(([empId, mins]) => {
                  const emp = empMap[empId]
                  const pct = Math.min((mins / (40 * 60)) * 100, 100)
                  const isOver = mins >= 40 * 60
                  return (
                    <div key={empId} style={{ marginBottom: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name ?? 'Unknown'}</span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: isOver ? '#f87171' : '#93c5fd' }}>{fmtMins(mins)}{isOver ? ' · OT' : ''}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: isOver ? '#ef4444' : '#3b82f6', borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* All entries */}
            <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>All entries this week</div>
              {entries.length === 0 ? (
                <div style={{ color: '#475569', fontSize: '13px', padding: '0.5rem 0' }}>No time entries this week.</div>
              ) : [...clockedIn, ...completed].map(e => {
                const emp = empMap[e.employee_id]
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{emp?.name ?? 'Unknown'}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        {new Date(e.clock_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : <span style={{ color: '#4ade80' }}>now</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: e.clock_out ? '#94a3b8' : '#4ade80', minWidth: '40px', textAlign: 'right' }}>
                      {e.clock_out && e.total_minutes ? fmtMins(e.total_minutes) : elapsed(e.clock_in)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>

    {calloutTarget && (
      <CalloutModal
        shiftId={calloutTarget.shiftId}
        shiftDate={calloutTarget.shiftDate}
        startTime={calloutTarget.startTime}
        endTime={calloutTarget.endTime}
        calledOutEmployee={calloutTarget.employee}
        onClose={() => setCalloutTarget(null)}
        onCalloutMarked={id => { setShifts(prev => prev.map(s => s.id === id ? { ...s, status: 'called_out' } : s)); setCalloutTarget(null) }}
      />
    )}
    </>
  )
}
