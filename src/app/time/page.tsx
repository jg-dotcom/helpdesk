'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { resolveTenantContext } from '../lib/tenant'
import Nav from '../components/Nav'
import CalloutModal from '../components/CalloutModal'
import { useToast } from '../components/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type BusinessHours = Record<DayKey, { open: string; close: string; closed: boolean }>
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

type Employee = { id: number; name: string; role: string; pay_type: string; pay_rate: number | null; pto_days_per_year: number | null }
type Shift = { id: number; employee_id: number | null; shift_date: string; start_time: string; end_time: string; notes: string | null; status?: string; is_open_shift?: boolean }
type ShiftSwap = { id: number; requester_employee_id: number; requester_shift_id: number; target_employee_id: number | null; target_shift_id: number | null; status: string; notes: string | null; created_at: string }
type TimeOffRequest = { id: number; employee_id: number; start_date: string; end_date: string; type: string; reason: string | null; status: string; created_at: string; portion?: string | null }
// JAY-33 — optional free-text note an employee can leave at clock-out
// ("low on register tape, restocked napkins"). `notes` already exists on
// time_entries (pre-existing schema-drift column, previously fetched but
// never written or displayed anywhere) — no migration needed.
// JAY-32 — optional unpaid break deduction, editable by the owner via the
// entry edit modal below. total_minutes is recalculated server-side whenever
// break_minutes changes, so this page never needs to redo that math itself.
// JAY-18 — optional geofence coordinates + photo captured at clock-in, shown
// to the owner alongside the entry (geofence distance advisory-only, photo a
// manual visual check — no facial-recognition matching, deliberately).
type TimeEntry = { id: number; employee_id: number; clock_in: string; clock_out: string | null; total_minutes: number | null; notes: string | null; break_minutes: number; clock_in_lat: number | null; clock_in_lng: number | null; clock_in_photo_url: string | null }
type Availability = { employee_id: number; day_of_week: number; start_time: string; end_time: string }
type ShiftNote = { id: number; shift_date: string; author_name: string; note: string; created_at: string }

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
// "Not yet seen" escalation nudge — a request can be technically delivered but still
// go unnoticed in a busy inbox. Purely computed from created_at vs now, no new infra.
function daysPending(createdAt: string) { return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) }
// PTO balance for approval-time visibility — same "approved days this year vs. pto_days_per_year"
// math already used by /api/employee/pto-balance, just computed client-side from data already
// loaded (requests, employees), so approving a request doesn't need a fresh fetch. Advisory only.
function ptoBalanceUsedDays(allRequests: TimeOffRequest[], employeeId: number, excludeRequestId?: number) {
  const year = new Date().getFullYear()
  let used = 0
  for (const r of allRequests) {
    if (r.employee_id !== employeeId || r.status !== 'approved' || r.id === excludeRequestId) continue
    if (new Date(r.start_date).getFullYear() !== year) continue
    // JAY-9 — a single-day request with a half-day portion counts as 0.5 days.
    if (r.start_date === r.end_date && (r.portion === 'first_half' || r.portion === 'second_half')) {
      used += 0.5
      continue
    }
    const start = new Date(r.start_date)
    const end = new Date(r.end_date || r.start_date)
    used += Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  }
  return used
}
function elapsed(clockIn: string) { return fmtMins(Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)) }
// JAY-18 — haversine distance in miles, client-side only (geofence is
// advisory: computed for display, never used to block anything).
function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
// JAY-32 — <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" in local time, not the UTC ISO string we store.
function toLocalInputValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function weekStartISO() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString()
}
function getWeekDays(offset: number) {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + offset * 7); d.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(d.getDate() + i); return day.toISOString().slice(0, 10) })
}

function shiftHours(s: Shift) {
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60
}

// JAY-53 — same per-shift cost math already used for the week's estimatedCost
// total (JAY-16's overtime-cost warning), just exposed per shift instead of
// only summed. Salary employees get an implied hourly rate (annual / 52
// weeks / 40 hours) since there's no other rate to attribute a shift's cost
// to — same convention the existing weekly total already uses.
function shiftCost(s: Shift, emp: Employee | undefined | null) {
  if (!emp?.pay_rate) return null
  const hrs = shiftHours(s)
  return emp.pay_type === 'salary' ? (emp.pay_rate / 52 / 40) * hrs : emp.pay_rate * hrs
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
  const { showToast } = useToast()
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
  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatWeeks, setRepeatWeeks] = useState(1)
  const [shiftIsOpen, setShiftIsOpen] = useState(false)
  const [breakWarningDismissed, setBreakWarningDismissed] = useState(false)
  const [swapRequests, setSwapRequests] = useState<ShiftSwap[]>([])

  // JAY-32 — owner-side edit of an existing time entry (break deduction,
  // plus clock_in/clock_out correction since the mockup shows them together).
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editBreakMinutes, setEditBreakMinutes] = useState('0')
  const [savingEntry, setSavingEntry] = useState(false)

  function openEntryEdit(e: TimeEntry) {
    setEditingEntry(e)
    setEditClockIn(toLocalInputValue(e.clock_in))
    setEditClockOut(e.clock_out ? toLocalInputValue(e.clock_out) : '')
    setEditBreakMinutes(String(e.break_minutes ?? 0))
  }

  async function saveEntryEdit() {
    if (!editingEntry) return
    setSavingEntry(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/time-entries/${editingEntry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        clock_in: new Date(editClockIn).toISOString(),
        clock_out: editClockOut ? new Date(editClockOut).toISOString() : null,
        break_minutes: Number(editBreakMinutes) || 0,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setEntries(prev => prev.map(en => en.id === editingEntry.id ? { ...en, ...data.entry } : en))
      showToast('Time entry updated.', 'success')
      setEditingEntry(null)
    } else showToast(data.error ?? 'Error saving entry.', 'error')
    setSavingEntry(false)
  }

  // Weekly view
  const [weekOffset, setWeekOffset] = useState(0)
  // JAY-35: business-hours guardrail banner, dismissible per week
  const [dismissedHoursWarningWeek, setDismissedHoursWarningWeek] = useState<number | null>(null)
  // JAY-6: short-notice schedule change banner, dismissible per week (same pattern)
  const [dismissedChangeWarningWeek, setDismissedChangeWarningWeek] = useState<number | null>(null)
  // JAY-105: "+N more" expand toggles for the two banners above, so overflow rows
  // are reachable instead of dead text
  const [showAllHoursWarnings, setShowAllHoursWarnings] = useState(false)
  const [showAllChangeWarnings, setShowAllChangeWarnings] = useState(false)
  // Active shift pill (for inline action panel)
  const [activeShiftId, setActiveShiftId] = useState<number | null>(null)
  // Drag-and-drop
  const [draggingShiftId, setDraggingShiftId] = useState<number | null>(null)
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)

  // Generate schedule
  const [generating, setGenerating] = useState(false)
  const [copyingWeek, setCopyingWeek] = useState(false)
  // Publish schedule
  const [publishing, setPublishing] = useState(false)
  // Employee sort/grouping
  const [empSort, setEmpSort] = useState<'default' | 'alpha' | 'dept'>('default')
  const [departments, setDepartments] = useState<{ id: number; name: string; color: string }[]>([])
  const [deptMembers, setDeptMembers] = useState<Record<number, number[]>>({})
  // Business hours
  const [bizHours, setBizHours] = useState<BusinessHours | null>(null)
  // JAY-54 (prerequisite step) — weekly labor budget in cents, null if unset.
  const [laborBudgetCents, setLaborBudgetCents] = useState<number | null>(null)
  // JAY-18
  const [geofence, setGeofence] = useState<{ lat: number; lng: number; radiusM: number } | null>(null)
  // JAY-6 — short-notice schedule change flags. Not persisted server-side —
  // dismissal is per-week client state only, matching the JAY-35 pattern.
  const [shiftChangeLog, setShiftChangeLog] = useState<{ id: number; shift_id: number; employee_id: number | null; shift_date: string; start_time: string; change_type: string; changed_at: string }[]>([])

  // Callout modal
  type CalloutTarget = { shiftId: number; shiftDate: string; startTime: string; endTime: string; employee: { id: number; name: string } }
  const [calloutTarget, setCalloutTarget] = useState<CalloutTarget | null>(null)

  // ── Manager logbook ────────────────────────────────────────────────────────
  const [logEntries, setLogEntries] = useState<ShiftNote[]>([])
  const [newLogText, setNewLogText] = useState('')
  const [savingLog, setSavingLog] = useState(false)
  const [authorName, setAuthorName] = useState('Manager')

  // JAY-6 — short-notice schedule change flags. There is no existing
  // shift-edit-history table (the ticket assumed one existed under
  // `shift_logbook`; that name actually belongs to the free-text manager
  // logbook table, `shift_notes` — a separate feature entirely, with no
  // per-edit timestamps). This logs the mutable change types that actually
  // exist in this UI today (create / move / reassign / delete); a passive
  // banner reads it back in load() to flag anything changed within 24h of
  // the shift's start.
  async function logShiftChange(shift: { id: number; employee_id: number | null; shift_date: string; start_time: string; end_time: string }, changeType: 'created' | 'moved' | 'reassigned' | 'deleted') {
    await supabase.from('shift_change_log').insert({
      user_id: userId,
      shift_id: shift.id,
      employee_id: shift.employee_id,
      shift_date: shift.shift_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      change_type: changeType,
    })
  }

  async function handleDropShift(empId: number, date: string) {
    if (!draggingShiftId) return
    const shift = shifts.find(s => s.id === draggingShiftId)
    if (!shift) { setDraggingShiftId(null); setDragOverCell(null); return }
    // Already on the same cell — no-op
    if (shift.employee_id === empId && shift.shift_date === date) { setDraggingShiftId(null); setDragOverCell(null); return }
    // Target cell already occupied — no-op
    const occupied = shifts.find(s => s.employee_id === empId && s.shift_date === date && !s.is_open_shift && s.id !== draggingShiftId)
    if (occupied) { setDraggingShiftId(null); setDragOverCell(null); return }
    // Optimistic update
    setShifts(prev => prev.map(s => s.id === draggingShiftId ? { ...s, employee_id: empId, shift_date: date } : s))
    setDraggingShiftId(null); setDragOverCell(null); setActiveShiftId(null)
    await supabase.from('shifts').update({ employee_id: empId, shift_date: date }).eq('id', draggingShiftId)
    logShiftChange({ ...shift, employee_id: empId, shift_date: date }, 'moved')
  }

  function closeDrawer() {
    setShowShiftForm(false)
    setShiftIsOpen(false)
    setRepeatEnabled(false)
    setRepeatWeeks(1)
    setShiftEmpId('')
    setBreakWarningDismissed(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(() => setTicker(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    // JAY-50 — an invited admin/manager's own auth id is never the tenant id;
    // resolve which business's data they should actually see (their own, if
    // they're the owner, or the inviting owner's, if not) before querying
    // anything. Previously this page used session.user.id directly, which is
    // why admins/managers landed on a blank schedule with zero data.
    const tenant = await resolveTenantContext(session.user.id, session.user.email)
    if (!tenant) { router.push('/login'); return }
    const tenantId = tenant.tenantId
    setUserId(tenantId)

    // Load business hours
    fetch('/api/settings/business', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json()).then(d => {
        if (d.profile?.business_hours) setBizHours(d.profile.business_hours)
        setLaborBudgetCents(d.profile?.weekly_labor_budget_cents ?? null)
        // JAY-18
        if (d.profile?.geofence_lat != null && d.profile?.geofence_lng != null && d.profile?.geofence_radius_m != null) {
          setGeofence({ lat: d.profile.geofence_lat, lng: d.profile.geofence_lng, radiusM: d.profile.geofence_radius_m })
        }
      })

    const [{ data: emps }, { data: sh }, { data: reqs }, { data: ents }, { data: depts }, { data: memberships }] = await Promise.all([
      supabase.from('employees').select('id, name, role, pay_type, pay_rate, pto_days_per_year').eq('user_id', tenantId).eq('status', 'active'),
      supabase.from('shifts').select('*').eq('user_id', tenantId).order('shift_date'),
      supabase.from('time_off_requests').select('*').eq('user_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('time_entries').select('*').eq('user_id', tenantId).gte('clock_in', weekStartISO()).order('clock_in', { ascending: false }),
      supabase.from('departments').select('id, name, color').eq('user_id', tenantId).order('name'),
      supabase.from('department_members').select('employee_id, department_id'),
    ])
    // JAY-6 — last 14 days of changes is enough to cover "this week" plus a
    // little slack for week-boundary edge cases, without pulling the entire
    // history.
    const changeLogSince = new Date(); changeLogSince.setDate(changeLogSince.getDate() - 14)
    const { data: changeLog } = await supabase
      .from('shift_change_log')
      .select('id, shift_id, employee_id, shift_date, start_time, change_type, changed_at')
      .eq('user_id', tenantId)
      .gte('changed_at', changeLogSince.toISOString())
      .order('changed_at', { ascending: false })
    setShiftChangeLog(changeLog ?? [])

    setDepartments(depts ?? [])
    const memberMap: Record<number, number[]> = {}
    for (const m of (memberships ?? [])) {
      if (!memberMap[m.employee_id]) memberMap[m.employee_id] = []
      memberMap[m.employee_id].push(m.department_id)
    }
    setDeptMembers(memberMap)

    const empList = emps ?? []
    setEmployees(empList)
    setShifts(sh ?? [])
    setRequests(reqs ?? [])
    setEntries(ents ?? [])

    // JAY-86 — "seen" read receipts for pending time-off requests, reusing
    // chat_read_receipts via a pseudo-channel per request (`timeoff:<id>`),
    // same mechanism as JAY-27's announcement seen-tracking. Best-effort:
    // never blocks the page, and silently no-ops for non-owner managers
    // (mark-read is scoped to chat channel permissions, same limitation the
    // announcement feature already has).
    const pendingReqs = (reqs ?? []).filter(r => r.status === 'pending')
    if (pendingReqs.length > 0) {
      Promise.allSettled(
        pendingReqs.map(r =>
          fetch('/api/messages/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ channel: `timeoff:${r.id}`, businessId: tenantId }),
          })
        )
      )
    }

    if (empList.length > 0) {
      const { data: avail } = await supabase.from('employee_availability').select('*').in('employee_id', empList.map(e => e.id))
      if (avail) setAvailability(avail)
    }

    const { data: swaps } = await supabase
      .from('shift_swaps')
      .select('*')
      .eq('user_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setSwapRequests(swaps ?? [])

    // JAY-86 — same "seen" read-receipt pattern as time-off requests above,
    // pseudo-channel `swap:<id>`. `swaps` is already filtered to pending.
    if ((swaps ?? []).length > 0) {
      Promise.allSettled(
        (swaps ?? []).map(s =>
          fetch('/api/messages/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ channel: `swap:${s.id}`, businessId: tenantId }),
          })
        )
      )
    }

    const fullName = (session.user.user_metadata?.full_name ?? '').trim()
    setAuthorName(fullName || session.user.email || 'Manager')

    const since = new Date(); since.setDate(since.getDate() - 60)
    const { data: notes } = await supabase
      .from('shift_notes')
      .select('*')
      .eq('user_id', tenantId)
      .gte('shift_date', since.toISOString().slice(0, 10))
      .order('created_at', { ascending: false })
    setLogEntries(notes ?? [])

    setLoading(false)
  }

  async function addLogEntry(date: string) {
    if (!newLogText.trim() || !userId) return
    setSavingLog(true)
    const { data, error } = await supabase
      .from('shift_notes')
      .insert({ user_id: userId, shift_date: date, author_name: authorName, note: newLogText.trim() })
      .select()
      .single()
    if (!error && data) {
      setLogEntries(prev => [data, ...prev])
      setNewLogText('')
    } else {
      showToast('Could not save note.', 'error')
    }
    setSavingLog(false)
  }

  // ── Shift actions ─────────────────────────────────────────────────────────

  async function handleAddShift() {
    if (!shiftIsOpen && !shiftEmpId) { showToast('Select an employee or mark as open shift.', 'error'); return }
    if (!shiftDate) { showToast('Select a date.', 'error'); return }
    setSavingShift(true)

    const approvedOff = requests.filter(r => r.status === 'approved')
    const isOff = (empId: number, date: string) => approvedOff.some(r => r.employee_id === empId && r.start_date <= date && r.end_date >= date)

    const baseDate = new Date(shiftDate + 'T00:00:00')
    let skippedClosed = 0
    let skippedTimeOff = 0
    const shiftsToInsert = Array.from({ length: repeatWeeks }, (_, i) => {
      const d = new Date(baseDate); d.setDate(baseDate.getDate() + i * 7)
      const date = d.toISOString().slice(0, 10)
      const dayKey = DAY_KEYS[d.getDay()]
      return { date, dayKey, i }
    }).filter(({ date, dayKey }) => {
      // JAY-84 — skip closed business days / approved time off, same guards
      // already enforced by generateSchedule and copyLastWeek.
      if (bizHours?.[dayKey]?.closed) { skippedClosed++; return false }
      if (!shiftIsOpen && shiftEmpId && isOff(shiftEmpId, date)) { skippedTimeOff++; return false }
      return true
    }).map(({ date }) => ({
      user_id: userId,
      employee_id: shiftIsOpen ? null : shiftEmpId,
      is_open_shift: shiftIsOpen,
      shift_date: date,
      start_time: shiftStart, end_time: shiftEnd,
      notes: shiftNotes.trim() || null,
    }))

    if (!shiftsToInsert.length) {
      showToast('No shifts created — business closed and/or employee has approved time off on the selected date(s).', 'error')
      setSavingShift(false)
      return
    }

    const { data, error } = await supabase.from('shifts').insert(shiftsToInsert).select()
    if (error) { showToast('Error saving.', 'error') }
    else {
      setShifts(prev => [...prev, ...(data ?? [])].sort((a, b) => a.shift_date.localeCompare(b.shift_date)))
      const skippedParts = []
      if (skippedClosed) skippedParts.push(`${skippedClosed} on closed day${skippedClosed > 1 ? 's' : ''}`)
      if (skippedTimeOff) skippedParts.push(`${skippedTimeOff} on approved time off`)
      const skippedNote = skippedParts.length ? ` (${skippedParts.join(', ')} skipped)` : ''
      showToast((shiftsToInsert.length > 1 ? `${shiftsToInsert.length} shifts added.` : 'Shift added.') + skippedNote, 'success')
      setShowShiftForm(false); setShiftEmpId(''); setShiftDate(''); setShiftNotes('')
      setRepeatEnabled(false); setRepeatWeeks(1); setShiftIsOpen(false)
      for (const s of data ?? []) logShiftChange(s, 'created')
    }
    setSavingShift(false)
  }

  async function handleDeleteShift(id: number) {
    const shift = shifts.find(s => s.id === id)
    await supabase.from('shifts').delete().eq('id', id)
    setShifts(prev => prev.filter(s => s.id !== id))
    if (shift) logShiftChange(shift, 'deleted')
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
      const reqShift = shifts.find(s => s.id === reqShiftId)
      const tgtShift = shifts.find(s => s.id === tgtShiftId)
      await supabase.from('shifts').update({ employee_id: tgtEmpId }).eq('id', reqShiftId)
      await supabase.from('shifts').update({ employee_id: reqEmpId }).eq('id', tgtShiftId)
      setShifts(prev => prev.map(s => {
        if (s.id === reqShiftId) return { ...s, employee_id: tgtEmpId }
        if (s.id === tgtShiftId) return { ...s, employee_id: reqEmpId }
        return s
      }))
      if (reqShift) logShiftChange({ ...reqShift, employee_id: tgtEmpId }, 'reassigned')
      if (tgtShift) logShiftChange({ ...tgtShift, employee_id: reqEmpId }, 'reassigned')
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
    setBreakWarningDismissed(false)
    setShowShiftForm(true)
  }

  // JAY-105: scroll a shift-warning banner row into view in the grid below and
  // highlight it, reusing the existing activeShiftId highlight styling.
  function jumpToShift(shiftId: number) {
    setActiveShiftId(shiftId)
    document.getElementById(`shift-cell-${shiftId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
    if (!availability.length) { showToast('No employee availability set yet.', 'error'); return }
    setGenerating(true)
    // Always use the currently viewed week — no date picker needed
    const weekDates = getWeekDays(weekOffset)
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
    if (!newShifts.length) { showToast('No new shifts to generate.', 'error'); setGenerating(false); return }
    const { error } = await supabase.from('shifts').insert(newShifts)
    if (error) showToast('Error generating schedule.', 'error')
    else { showToast(`Generated ${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''}.`, 'success'); load() }
    setGenerating(false)
  }

  // ── Copy last week's schedule into the currently viewed week ──────────────

  async function copyLastWeek() {
    setCopyingWeek(true)
    const thisWeek = getWeekDays(weekOffset)
    const lastWeek = getWeekDays(weekOffset - 1)
    const approvedOff = requests.filter(r => r.status === 'approved')
    const isOff = (empId: number, date: string) => approvedOff.some(r => r.employee_id === empId && r.start_date <= date && r.end_date >= date)
    const existing = shifts.filter(s => thisWeek.includes(s.shift_date))
    const lastWeekShifts = shifts.filter(s => lastWeek.includes(s.shift_date) && s.status !== 'called_out' && !s.is_open_shift && s.employee_id != null)

    const newShifts: object[] = []
    lastWeekShifts.forEach(s => {
      const dayIdx = lastWeek.indexOf(s.shift_date)
      const targetDate = thisWeek[dayIdx]
      const dayKey = DAY_KEYS[dayIdx]
      const dayHours = bizHours?.[dayKey]
      if (dayHours?.closed) return
      if (isOff(s.employee_id!, targetDate)) return
      if (existing.some(e => e.employee_id === s.employee_id && e.shift_date === targetDate)) return
      newShifts.push({
        user_id: userId, employee_id: s.employee_id, shift_date: targetDate,
        start_time: s.start_time, end_time: s.end_time, notes: s.notes,
      })
    })

    if (!newShifts.length) { showToast('No shifts to copy from last week.', 'error'); setCopyingWeek(false); return }
    const { error } = await supabase.from('shifts').insert(newShifts)
    if (error) showToast('Error copying last week.', 'error')
    else { showToast(`Copied ${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''} from last week.`, 'success'); load() }
    setCopyingWeek(false)
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const empMap = Object.fromEntries(employees.map(e => [e.id, e]))
  const today = new Date().toISOString().slice(0, 10)
  const weekDays = getWeekDays(weekOffset)
  const weekStart = new Date(weekDays[0] + 'T00:00:00')
  const weekEnd = new Date(weekDays[6] + 'T00:00:00')
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // JAY-6 — flag shift changes (create/move/reassign/delete) logged less
  // than 24h before the affected shift's own scheduled start. Scoped to
  // shifts falling in the currently-viewed week, matching the mockup
  // ("N shifts changed with under 24h notice this week").
  const shortNoticeChanges = shiftChangeLog.filter(c => {
    if (!weekDays.includes(c.shift_date)) return false
    const shiftStartMs = new Date(`${c.shift_date}T${c.start_time}`).getTime()
    const hoursNotice = (shiftStartMs - new Date(c.changed_at).getTime()) / 3600000
    return hoursNotice >= 0 && hoursNotice < 24
  })

  // Scheduled hours + estimated cost this week
  const weekShifts = shifts.filter(s => weekDays.includes(s.shift_date) && s.status !== 'called_out')
  const scheduledHours = weekShifts.reduce((sum, s) => sum + shiftHours(s), 0)
  const estimatedCost = weekShifts.reduce((sum, s) => {
    const emp = s.employee_id != null ? empMap[s.employee_id] : null
    if (!emp?.pay_rate) return sum
    const hrs = shiftHours(s)
    return sum + (emp.pay_type === 'salary' ? (emp.pay_rate / 52 / 40) * hrs : emp.pay_rate * hrs)
  }, 0)

  // Scheduled hours per employee this week — surfaced as a grid column so
  // overtime (>40h) is visible without adding up shifts by hand.
  const scheduledHoursByEmployee = new Map<number, number>()
  for (const s of weekShifts) {
    if (s.employee_id == null) continue
    scheduledHoursByEmployee.set(s.employee_id, (scheduledHoursByEmployee.get(s.employee_id) ?? 0) + shiftHours(s))
  }

  // Whether Auto-generate / Copy last week would actually produce anything this week —
  // mirrors the same filtering the two actions do, so the header buttons can be dimmed
  // when there's nothing left to do instead of always looking equally actionable.
  const approvedOffThisWeek = requests.filter(r => r.status === 'approved')
  const isOffThisWeek = (empId: number, date: string) => approvedOffThisWeek.some(r => r.employee_id === empId && r.start_date <= date && r.end_date >= date)
  const existingThisWeek = shifts.filter(s => weekDays.includes(s.shift_date))

  const canAutoGenerate = availability.length > 0 && weekDays.some((date, i) => {
    const dayKey = DAY_KEYS[i]
    if (bizHours?.[dayKey]?.closed) return false
    return availability.some(a =>
      a.day_of_week === i &&
      !isOffThisWeek(a.employee_id, date) &&
      !existingThisWeek.some(s => s.employee_id === a.employee_id && s.shift_date === date)
    )
  })

  const lastWeekDays = getWeekDays(weekOffset - 1)
  const lastWeekShiftsPreview = shifts.filter(s => lastWeekDays.includes(s.shift_date) && s.status !== 'called_out' && !s.is_open_shift && s.employee_id != null)
  const canCopyLastWeek = lastWeekShiftsPreview.some(s => {
    const dayIdx = lastWeekDays.indexOf(s.shift_date)
    const targetDate = weekDays[dayIdx]
    const dayKey = DAY_KEYS[dayIdx]
    if (bizHours?.[dayKey]?.closed) return false
    if (isOffThisWeek(s.employee_id!, targetDate)) return false
    if (existingThisWeek.some(e => e.employee_id === s.employee_id && e.shift_date === targetDate)) return false
    return true
  })

  // Daily subtotals — total scheduled hours per day across all employees
  const dailyTotals = weekDays.map(d =>
    weekShifts.filter(s => s.shift_date === d).reduce((sum, s) => sum + shiftHours(s), 0)
  )

  // Days missing lead/manager coverage — flagged so gaps in supervision are visible at a glance
  const noLeadDays = new Set(
    weekDays.filter((d, i) => {
      const dayKey = DAY_KEYS[i]
      if (bizHours?.[dayKey]?.closed) return false
      const dayShifts = weekShifts.filter(s => s.shift_date === d && s.employee_id != null)
      if (!dayShifts.length) return false
      return !dayShifts.some(s => {
        const emp = empMap[s.employee_id!]
        return emp && /lead|manager/i.test(emp.role)
      })
    })
  )

  // JAY-35: shifts that fall outside the business's saved hours (or on a day marked
  // closed). Passive, dismissable — business_hours is already used to clamp
  // auto-generate/copy-last-week and to default the new-shift form, but a manually
  // typed or edited shift can still land outside it with no signal today.
  const outOfHoursShifts = weekDays.flatMap((dateStr, dayIdx) => {
    const dayKey = DAY_KEYS[dayIdx]
    const dayHours = bizHours?.[dayKey]
    if (!dayHours) return []
    return weekShifts
      .filter(s => s.shift_date === dateStr && s.employee_id != null && s.status !== 'called_out')
      .filter(s => dayHours.closed || s.start_time < dayHours.open || s.end_time > dayHours.close)
      .map(s => ({ shift: s, dateStr, dayHours }))
  })

  // Availability lookup — graying only applies to employees who have submitted availability
  // themselves. If this employee has zero rows at all, treat it as "no data" (don't gray any
  // of their cells) rather than assuming every day is unavailable.
  const employeesWithAvailability = new Set(availability.map(a => a.employee_id))
  function isAvailable(empId: number, dayIdx: number) {
    return availability.some(a => a.employee_id === empId && a.day_of_week === dayIdx)
  }

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

  // Sorted/grouped employees
  const sortedEmployees = (() => {
    if (empSort === 'alpha') return [...employees].sort((a, b) => a.name.localeCompare(b.name))
    if (empSort === 'dept') {
      const getDeptName = (emp: Employee) => {
        const ids = deptMembers[emp.id] ?? []
        const dept = departments.find(d => ids.includes(d.id))
        return dept?.name ?? '￿' // sorts unassigned to end
      }
      return [...employees].sort((a, b) => getDeptName(a).localeCompare(getDeptName(b)) || a.name.localeCompare(b.name))
    }
    return employees
  })()

  // Dept label to show between groups when sorting by dept
  function deptLabelFor(emp: Employee, idx: number): string | null {
    if (empSort !== 'dept') return null
    const ids = deptMembers[emp.id] ?? []
    const dept = departments.find(d => ids.includes(d.id))
    const label = dept?.name ?? 'No Department'
    if (idx === 0) return label
    const prev = sortedEmployees[idx - 1]
    const prevIds = deptMembers[prev.id] ?? []
    const prevDept = departments.find(d => prevIds.includes(d.id))
    const prevLabel = prevDept?.name ?? 'No Department'
    return label !== prevLabel ? label : null
  }

  // Drawer helpers
  const drawerSelectedEmp = shiftEmpId !== '' ? empMap[shiftEmpId as number] ?? null : null
  const drawerHours = (() => {
    if (!shiftStart || !shiftEnd) return null
    const [sh, sm] = shiftStart.split(':').map(Number)
    const [eh, em] = shiftEnd.split(':').map(Number)
    const h = ((eh * 60 + em) - (sh * 60 + sm)) / 60
    return h > 0 ? h : null
  })()
  // JAY-85 — CA-style break policy: shifts over 5 hours require a 30-min break.
  // Advisory only, at schedule-build time (proactive counterpart to JAY-70's
  // after-the-fact missed-break premium pay). Detects an existing break via the
  // notes field since shifts have no dedicated break column (no schema change).
  const needsBreakWarning = drawerHours != null && drawerHours > 5 && !/break/i.test(shiftNotes) && !breakWarningDismissed
  const openShiftsCount = shifts.filter(s => s.is_open_shift && !s.employee_id && s.shift_date >= today).length
  const pendingApprovalCount = pendingRequests.length + pendingSwaps.length

  async function publishSchedule() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setPublishing(true)
    const res = await fetch('/api/schedule/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ weekStart: weekDays[0] }),
    })
    const data = await res.json()
    if (res.ok) showToast(`Notified ${data.notified} employee${data.notified !== 1 ? 's' : ''}`, 'success')
    else showToast('Error publishing', 'error')
    setPublishing(false)
  }

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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              onClick={generateSchedule}
              disabled={generating || !canAutoGenerate}
              title={canAutoGenerate ? 'Fill this week from employee availability' : 'Nothing left to generate — every available slot this week is already covered'}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: generating ? '#4ade80' : canAutoGenerate ? '#94a3b8' : '#3f4a5c', fontSize: '12px', fontWeight: 500, cursor: generating ? 'not-allowed' : canAutoGenerate ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'color 0.15s', opacity: canAutoGenerate || generating ? 1 : 0.6 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              {generating ? 'Generating…' : 'Auto-generate'}
            </button>
            <button
              onClick={copyLastWeek}
              disabled={copyingWeek || !canCopyLastWeek}
              title={canCopyLastWeek ? "Copy last week's shifts into this week" : 'Nothing to copy — no eligible shifts from last week'}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: copyingWeek ? '#4ade80' : canCopyLastWeek ? '#94a3b8' : '#3f4a5c', fontSize: '12px', fontWeight: 500, cursor: copyingWeek ? 'not-allowed' : canCopyLastWeek ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'color 0.15s', opacity: canCopyLastWeek || copyingWeek ? 1 : 0.6 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {copyingWeek ? 'Copying…' : 'Copy last week'}
            </button>
            <button
              onClick={publishSchedule}
              disabled={publishing}
              title="Notify employees their schedule is ready"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: publishing ? '#64748b' : '#4ade80', fontSize: '12px', fontWeight: 500, cursor: publishing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
            <button
              onClick={() => { setShowShiftForm(true); setTab('shifts') }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', background: '#1d4ed8', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add shift
            </button>
          </div>
        </div>

        {/* Stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: clockedIn.length > 0 ? '#4ade80' : '#475569', letterSpacing: '-0.02em' }}>{clockedIn.length}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Clocked in now</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: openShiftsCount > 0 ? '#fbbf24' : '#475569', letterSpacing: '-0.02em' }}>{openShiftsCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Open shifts</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px', cursor: pendingApprovalCount > 0 ? 'pointer' : 'default' }} onClick={() => { if (pendingApprovalCount > 0) setTab('timeoff') }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: pendingApprovalCount > 0 ? '#f87171' : '#475569', letterSpacing: '-0.02em' }}>{pendingApprovalCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Pending approvals</div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9', letterSpacing: '-0.02em' }}>{estimatedCost > 0 ? `$${estimatedCost.toFixed(0)}` : '—'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Est. labor cost</div>
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
                            logShiftChange({ ...s, employee_id: empId }, 'reassigned')
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
                    <div key={swap.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)', marginBottom: '0.5rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>
                          {requester?.name ?? '?'} wants to swap{target ? ` with ${target.name}` : ''}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                          {reqShift ? `Their shift: ${fmtDate(reqShift.shift_date)} ${fmt(reqShift.start_time)}–${fmt(reqShift.end_time)}` : ''}
                          {tgtShift ? ` ↔ ${fmtDate(tgtShift.shift_date)} ${fmt(tgtShift.start_time)}–${fmt(tgtShift.end_time)}` : ''}
                          {swap.notes ? ` · "${swap.notes}"` : ''}
                        </div>
                        {daysPending(swap.created_at) >= 1 && (
                          <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>⚠</span>
                            {daysPending(swap.created_at)} day{daysPending(swap.created_at) !== 1 ? 's' : ''}, not yet reviewed
                            <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', borderRadius: '8px', padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>New</span>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          onClick={() => handleSwapDecision(swap.id, 'approved', swap.requester_shift_id, swap.target_shift_id, swap.requester_employee_id, swap.target_employee_id)}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: '#4ade80', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>
                          Approve
                        </button>
                        <button
                          onClick={() => handleSwapDecision(swap.id, 'denied', null, null, null, null)}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>
                          Deny
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── SCHEDULE GRID ── */}
            {(
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1rem', overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o - 1)}>←</button>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9', minWidth: '180px', textAlign: 'center' }}>{weekLabel}</div>
                    <button style={{ padding: '4px 12px', fontSize: '14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setWeekOffset(o => o + 1)}>→</button>
                  </div>
                  <select
                    value={empSort}
                    onChange={e => setEmpSort(e.target.value as typeof empSort)}
                    style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <option value="default">Default order</option>
                    <option value="alpha">A – Z</option>
                    {departments.length > 0 && <option value="dept">By department</option>}
                  </select>
                </div>

                {outOfHoursShifts.length > 0 && dismissedHoursWarningWeek !== weekOffset && (
                  <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '8px', padding: '10px 12px', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>⚠</span> Shift{outOfHoursShifts.length !== 1 ? 's' : ''} outside business hours
                      </div>
                      <button
                        onClick={() => setDismissedHoursWarningWeek(weekOffset)}
                        style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                      >
                        Dismiss
                      </button>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {(showAllHoursWarnings ? outOfHoursShifts : outOfHoursShifts.slice(0, 5)).map(({ shift, dateStr, dayHours }) => {
                        const emp = empMap[shift.employee_id!]
                        const reason = dayHours.closed
                          ? 'business is closed this day'
                          : `outside ${fmt(dayHours.open)}–${fmt(dayHours.close)}`
                        return (
                          <div
                            key={shift.id}
                            onClick={() => jumpToShift(shift.id)}
                            style={{ fontSize: '12px', color: '#e2e8f0', cursor: 'pointer' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.textDecoration = 'underline' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.textDecoration = 'none' }}
                          >
                            {emp?.name ?? 'Unknown'} — {fmtDate(dateStr)} {fmt(shift.start_time)}–{fmt(shift.end_time)} ({reason})
                          </div>
                        )
                      })}
                      {outOfHoursShifts.length > 5 && (
                        <button
                          onClick={() => setShowAllHoursWarnings(v => !v)}
                          style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'left' }}
                        >
                          {showAllHoursWarnings ? 'Show fewer' : `+${outOfHoursShifts.length - 5} more`}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* JAY-6 — passive, dismissible, zero enforcement: some cities require
                    extra pay for short-notice schedule changes (NYC/SF/Chicago/Seattle/
                    Philadelphia/Oregon "Fair Workweek" laws), but this app doesn't attempt
                    jurisdiction-specific penalty-pay math — it just surfaces the fact so
                    the owner can decide whether to look into it. */}
                {shortNoticeChanges.length > 0 && dismissedChangeWarningWeek !== weekOffset && (
                  <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '8px', padding: '10px 12px', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>⚠</span> {shortNoticeChanges.length} shift{shortNoticeChanges.length !== 1 ? 's' : ''} changed with under 24h notice this week
                      </div>
                      <button
                        onClick={() => setDismissedChangeWarningWeek(weekOffset)}
                        style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                      >
                        Dismiss
                      </button>
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Some cities require extra pay for late schedule changes. Review below.
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {(showAllChangeWarnings ? shortNoticeChanges : shortNoticeChanges.slice(0, 5)).map(c => {
                        const emp = c.employee_id != null ? empMap[c.employee_id] : null
                        const verb = c.change_type === 'created' ? 'added' : c.change_type === 'deleted' ? 'removed' : c.change_type === 'reassigned' ? 'reassigned' : 'moved'
                        // Deleted shifts no longer exist in the grid below, so only rows for
                        // shifts still on the schedule are clickable/jumpable.
                        const stillScheduled = c.change_type !== 'deleted' && shifts.some(s => s.id === c.shift_id)
                        return (
                          <div
                            key={c.id}
                            onClick={stillScheduled ? () => jumpToShift(c.shift_id) : undefined}
                            style={{ fontSize: '12px', color: '#e2e8f0', cursor: stillScheduled ? 'pointer' : 'default' }}
                            onMouseEnter={e => { if (stillScheduled) (e.currentTarget as HTMLDivElement).style.textDecoration = 'underline' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.textDecoration = 'none' }}
                          >
                            {emp?.name ?? 'Employee'} — {fmtDate(c.shift_date)} shift {verb} ({fmtTime(c.changed_at)})
                          </div>
                        )
                      })}
                      {shortNoticeChanges.length > 5 && (
                        <button
                          onClick={() => setShowAllChangeWarnings(v => !v)}
                          style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'left' }}
                        >
                          {showAllChangeWarnings ? 'Show fewer' : `+${shortNoticeChanges.length - 5} more`}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ minWidth: '560px' }}>
                  {/* Day header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '130px repeat(7, 1fr) 52px', gap: '4px', marginBottom: '6px' }}>
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
                          {noLeadDays.has(dateStr) && (
                            <div title="No lead or manager scheduled this day" style={{ fontSize: '9px', fontWeight: 600, color: '#fbbf24', marginTop: '3px', whiteSpace: 'nowrap' }}>
                              ⚠ No lead
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ textAlign: 'center', padding: '6px 4px', fontSize: '10px', fontWeight: 600, color: '#475569', alignSelf: 'end' }}>Hrs</div>
                  </div>

                  {/* Employee rows */}
                  {sortedEmployees.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }}>No employees yet.</div>
                  ) : sortedEmployees.map((emp, empIdx) => {
                    const deptLabel = deptLabelFor(emp, empIdx)
                    const rc = getRoleColor(emp.role)
                    return (
                      <div key={emp.id}>
                      {deptLabel && (
                        <div style={{ gridColumn: '1 / -1', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 4px 4px', borderTop: empIdx > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none', marginTop: empIdx > 0 ? '4px' : 0 }}>
                          {deptLabel}
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '130px repeat(7, 1fr) 52px', gap: '4px', marginBottom: '4px' }}>
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
                        {weekDays.map((dateStr, dayIdx) => {
                          const dayShift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr && !s.is_open_shift)
                          const isToday = dateStr === today
                          const isCallout = dayShift?.status === 'called_out'
                          const cellColor = isCallout
                            ? { bg: 'rgba(239,68,68,0.15)', text: '#f87171', border: 'rgba(239,68,68,0.3)' }
                            : dayShift ? rc : null
                          const isActive = dayShift?.id === activeShiftId
                          const isDragging = dayShift?.id === draggingShiftId
                          const cellKey = `${emp.id}-${dateStr}`
                          const isDragOver = dragOverCell === cellKey && !dayShift
                          // Grayed out when the employee has submitted availability but didn't mark this day — still
                          // clickable so a manager can schedule anyway, just visually flagged.
                          const isUnavailable = !dayShift && employeesWithAvailability.has(emp.id) && !isAvailable(emp.id, dayIdx)
                          return (
                            <div
                              key={dateStr}
                              id={dayShift ? `shift-cell-${dayShift.id}` : undefined}
                              onClick={() => {
                                if (draggingShiftId) return
                                if (dayShift) {
                                  setActiveShiftId(isActive ? null : dayShift.id)
                                  setShowShiftForm(false)
                                } else {
                                  openShiftFormForDate(dateStr)
                                  setShiftEmpId(emp.id)
                                  setActiveShiftId(null)
                                }
                              }}
                              onDragOver={e => { e.preventDefault(); if (draggingShiftId) setDragOverCell(cellKey) }}
                              onDragLeave={() => setDragOverCell(null)}
                              onDrop={e => { e.preventDefault(); handleDropShift(emp.id, dateStr) }}
                              style={{
                                borderRadius: '6px',
                                minHeight: '54px',
                                padding: '6px',
                                cursor: draggingShiftId ? 'copy' : 'pointer',
                                background: isDragOver
                                  ? 'rgba(29,78,216,0.18)'
                                  : isActive
                                    ? (cellColor ? cellColor.bg : 'rgba(29,78,216,0.12)')
                                    : cellColor ? cellColor.bg
                                      : isUnavailable ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.015), rgba(255,255,255,0.015) 5px, rgba(255,255,255,0.035) 5px, rgba(255,255,255,0.035) 10px)'
                                      : isToday ? 'rgba(29,78,216,0.06)' : 'rgba(255,255,255,0.02)',
                                border: isDragOver
                                  ? '2px dashed rgba(59,130,246,0.7)'
                                  : isActive
                                    ? `2px solid ${cellColor ? cellColor.text : '#3b82f6'}`
                                    : cellColor ? `1px solid ${cellColor.border}` : `1px dashed rgba(255,255,255,${isToday ? '0.12' : '0.05'})`,
                                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
                                transition: 'border-color 0.1s, background 0.1s',
                                outline: 'none',
                                opacity: isDragging ? 0.35 : 1,
                              }}
                              onMouseEnter={e => { if (!dayShift && !draggingShiftId) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(29,78,216,0.5)' }}
                              onMouseLeave={e => { if (!dayShift && !draggingShiftId) (e.currentTarget as HTMLDivElement).style.borderColor = isToday ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)' }}
                            >
                              {dayShift ? (
                                <div
                                  draggable
                                  onDragStart={e => { e.stopPropagation(); setDraggingShiftId(dayShift.id); setActiveShiftId(null) }}
                                  onDragEnd={() => { setDraggingShiftId(null); setDragOverCell(null) }}
                                  style={{ cursor: 'grab', userSelect: 'none' }}
                                >
                                  <div style={{ fontSize: '11px', fontWeight: 600, color: cellColor!.text }}>
                                    {isCallout ? 'Called out' : `${fmt(dayShift.start_time)}–${fmt(dayShift.end_time)}`}
                                  </div>
                                  {!isCallout && (
                                    <div style={{ fontSize: '10px', color: cellColor!.text, opacity: 0.65, marginTop: '2px' }}>
                                      {shiftHours(dayShift) % 1 === 0 ? shiftHours(dayShift) : shiftHours(dayShift).toFixed(1)}h
                                    </div>
                                  )}
                                  {/* JAY-53 — per-shift labor cost, same math as the week's
                                      estimatedCost total, just shown per shift so an owner sees
                                      cost while building the schedule, not only in the weekly
                                      budget banner below. */}
                                  {!isCallout && (() => {
                                    const cost = shiftCost(dayShift, emp)
                                    return cost != null ? (
                                      <div style={{ fontSize: '10px', color: cellColor!.text, opacity: 0.5, marginTop: '1px' }}>
                                        ${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      </div>
                                    ) : null
                                  })()}
                                </div>
                              ) : (
                                <div style={{ fontSize: '10px', color: isDragOver ? '#93c5fd' : '#334155', textAlign: 'center' }}>
                                  {isDragOver ? 'Drop here' : isUnavailable ? 'Unavailable' : '+ add'}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {/* Weekly hours total — bold red when scheduled (not yet worked) hours
                            cross 40h, plus an explicit warning icon so it reads as a flag rather
                            than just a color change. Passive only: doesn't block Publish. */}
                        {(() => {
                          const hrs = scheduledHoursByEmployee.get(emp.id) ?? 0
                          const isOT = hrs > 40
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
                              {isOT && <span title={`${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h scheduled this week — over 40h`} style={{ color: '#f87171', fontSize: '10px' }}>⚠</span>}
                              <div style={{ fontSize: '11px', fontWeight: isOT ? 700 : 500, color: isOT ? '#f87171' : '#64748b' }}>
                                {hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                      </div>
                    )
                  })}

                  {/* Daily subtotals */}
                  {sortedEmployees.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '130px repeat(7, 1fr) 52px', gap: '4px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 4px', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Total
                      </div>
                      {dailyTotals.map((hrs, i) => (
                        <div key={weekDays[i]} style={{ textAlign: 'center', padding: '2px 4px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>
                            {hrs > 0 ? `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h` : '—'}
                          </div>
                        </div>
                      ))}
                      <div style={{ textAlign: 'center', padding: '2px 4px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#93c5fd' }}>
                          {scheduledHours % 1 === 0 ? scheduledHours : scheduledHours.toFixed(1)}h
                        </div>
                      </div>
                    </div>
                  )}

                  {/* JAY-54 (prerequisite step) — budget vs. actual, only shown once an
                      owner has actually set a weekly labor budget in Settings. This is
                      the validation signal for whether the full auto-scheduling engine
                      is worth building: if this goes unused, it isn't. */}
                  {sortedEmployees.length > 0 && laborBudgetCents != null && (() => {
                    const budget = laborBudgetCents / 100
                    const diff = budget - estimatedCost
                    const overBudget = diff < 0
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: overBudget ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)', border: `1px solid ${overBudget ? 'rgba(248,113,113,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Weekly labor budget: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>${budget.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: overBudget ? '#f87171' : '#4ade80' }}>
                          Projected: ${estimatedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({overBudget ? 'over' : 'under'} by ${Math.abs(diff).toLocaleString(undefined, { maximumFractionDigits: 0 })})
                        </div>
                      </div>
                    )
                  })()}

                  {/* Active shift action panel */}
                  {activeShiftId != null && (() => {
                    const s = shifts.find(sh => sh.id === activeShiftId)
                    const emp = s?.employee_id != null ? empMap[s.employee_id] : null
                    if (!s) return null
                    const isCalloutShift = s.status === 'called_out'
                    const rc2 = emp ? getRoleColor(emp.role) : { bg: 'rgba(100,116,139,0.14)', text: '#94a3b8', border: 'rgba(100,116,139,0.22)' }
                    return (
                      <div style={{ margin: '0.75rem 0 0.25rem', padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${rc2.border}`, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: rc2.bg, color: rc2.text, fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${rc2.border}`, flexShrink: 0 }}>
                            {emp ? emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2) : 'OS'}
                          </div>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                              {emp?.name ?? 'Open shift'} <span style={{ fontWeight: 400, color: '#64748b' }}>— {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: isCalloutShift ? '#f87171' : '#64748b', marginTop: '1px' }}>
                              {isCalloutShift ? 'Called out' : `${fmt(s.start_time)} – ${fmt(s.end_time)} · ${shiftHours(s) % 1 === 0 ? shiftHours(s) : shiftHours(s).toFixed(1)}h`}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                          {!isCalloutShift && emp && (
                            <button
                              onClick={() => { setCalloutTarget({ shiftId: s.id, shiftDate: s.shift_date, startTime: s.start_time, endTime: s.end_time, employee: { id: emp.id, name: emp.name } }); setActiveShiftId(null) }}
                              style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.12)', color: '#fbbf24', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}
                            >Mark callout</button>
                          )}
                          <button
                            onClick={() => { handleDeleteShift(s.id); setActiveShiftId(null) }}
                            style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}
                          >Delete</button>
                          <button
                            onClick={() => setActiveShiftId(null)}
                            style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}
                          >✕</button>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Manager logbook — notes scoped to the selected shift's day */}
                  {activeShiftId != null && (() => {
                    const s = shifts.find(sh => sh.id === activeShiftId)
                    if (!s) return null
                    const dayNotes = logEntries.filter(n => n.shift_date === s.shift_date)
                    return (
                      <div style={{ margin: '0.5rem 0 0.25rem', padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
                          Logbook — {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        {dayNotes.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.6rem', maxHeight: '160px', overflowY: 'auto' }}>
                            {dayNotes.map(n => (
                              <div key={n.id} style={{ fontSize: '12.5px', color: '#e2e8f0', padding: '0.4rem 0.6rem', borderRadius: '7px', background: 'rgba(255,255,255,0.03)' }}>
                                <div>{n.note}</div>
                                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{n.author_name} · {fmtTime(n.created_at)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            value={newLogText}
                            onChange={e => setNewLogText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addLogEntry(s.shift_date) }}
                            placeholder="Add a note about this day…"
                            style={{ flex: 1, fontSize: '12.5px', padding: '6px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontFamily: 'inherit' }}
                          />
                          <button
                            onClick={() => addLogEntry(s.shift_date)}
                            disabled={savingLog || !newLogText.trim()}
                            style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(29,78,216,0.4)', background: newLogText.trim() ? '#1d4ed8' : 'rgba(255,255,255,0.05)', color: newLogText.trim() ? '#fff' : '#475569', cursor: newLogText.trim() ? 'pointer' : 'default', fontWeight: 500, fontFamily: 'inherit' }}
                          >Add</button>
                        </div>
                      </div>
                    )
                  })()}

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
                    const isHalfDay = req.start_date === req.end_date && (req.portion === 'first_half' || req.portion === 'second_half')
                    const requestDays = isHalfDay ? 0.5 : Math.round((new Date(req.end_date).getTime() - new Date(req.start_date).getTime()) / 86400000) + 1
                    const totalPto = emp?.pto_days_per_year ?? null
                    const usedSoFar = emp ? ptoBalanceUsedDays(requests, emp.id, req.id) : 0
                    const wouldRemain = totalPto !== null ? totalPto - usedSoFar - requestDays : null
                    return (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(29,78,216,0.2)', color: '#93c5fd', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {emp ? emp.name.split(' ').map(w => w[0]).join('').slice(0, 2) : '??'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name || 'Employee'} <span style={{ fontWeight: 400, color: '#64748b' }}>— {req.type}</span></div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{fmtDate(req.start_date)} – {fmtDate(req.end_date)}{isHalfDay ? ` (${req.portion === 'first_half' ? 'first half' : 'second half'})` : ''}{req.reason ? ` · ${req.reason}` : ''}</div>
                          {totalPto !== null && (
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                              Balance: {usedSoFar} of {totalPto} days used this year
                              {wouldRemain !== null && wouldRemain <= 0 && (
                                <span style={{ color: '#fbbf24', marginLeft: '6px' }}>⚠ Approving would leave {Math.max(0, wouldRemain)} days remaining</span>
                              )}
                            </div>
                          )}
                          {daysPending(req.created_at) >= 1 && (
                            <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>⚠</span>
                              {daysPending(req.created_at)} day{daysPending(req.created_at) !== 1 ? 's' : ''}, not yet reviewed
                              <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', borderRadius: '8px', padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>New</span>
                            </div>
                          )}
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
                    const isHalfDay = req.start_date === req.end_date && (req.portion === 'first_half' || req.portion === 'second_half')
                    return (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name || 'Employee'} <span style={{ fontWeight: 400, color: '#64748b' }}>— {req.type}</span></div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '1px' }}>{fmtDate(req.start_date)} – {fmtDate(req.end_date)}{isHalfDay ? ` (${req.portion === 'first_half' ? 'first half' : 'second half'})` : ''}</div>
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
                        {/* JAY-32 — unpaid break already deducted from total_minutes server-side. */}
                        {e.break_minutes > 0 && <span style={{ color: '#f59e0b' }}> · −{e.break_minutes}m break</span>}
                      </div>
                      {/* JAY-33 — shift note left at clock-out, e.g. a handoff note or incident. */}
                      {e.notes && (
                        <div style={{ fontSize: '12px', color: '#93c5fd', marginTop: '3px' }}>
                          📝 {e.notes}
                        </div>
                      )}
                      {/* JAY-18 — geofence distance is advisory-only; shown, never used to
                          flag/block anything automatically. Photo is a manual visual check. */}
                      {(geofence && e.clock_in_lat != null && e.clock_in_lng != null) && (
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                          📍 {distanceMiles(geofence.lat, geofence.lng, e.clock_in_lat, e.clock_in_lng).toFixed(2)} mi from business
                          {distanceMiles(geofence.lat, geofence.lng, e.clock_in_lat, e.clock_in_lng) * 1609.34 > geofence.radiusM && (
                            <span style={{ color: '#f59e0b' }}> (outside geofence)</span>
                          )}
                        </div>
                      )}
                      {e.clock_in_photo_url && (
                        <a href={e.clock_in_photo_url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#93c5fd', marginTop: '3px', display: 'inline-block' }}>
                          📷 View clock-in photo
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: e.clock_out ? '#94a3b8' : '#4ade80', minWidth: '40px', textAlign: 'right' }}>
                      {e.clock_out && e.total_minutes ? fmtMins(e.total_minutes) : elapsed(e.clock_in)}
                    </div>
                    {/* JAY-32 — edit modal trigger; only meaningful once the entry has closed. */}
                    {e.clock_out && (
                      <button
                        onClick={() => openEntryEdit(e)}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#94a3b8', fontSize: '11px', padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>

    {/* ── JAY-32: EDIT TIME ENTRY MODAL ── */}
    {editingEntry && (
      <div
        onClick={() => setEditingEntry(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
      >
        <div
          onClick={ev => ev.stopPropagation()}
          style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1.25rem', width: '320px', maxWidth: '90vw' }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9', marginBottom: '1rem' }}>Edit time entry</div>

          <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Clock in</label>
          <input
            type="datetime-local"
            value={editClockIn}
            onChange={e => setEditClockIn(e.target.value)}
            style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', padding: '8px 10px', fontSize: '13px', marginBottom: '0.75rem' }}
          />

          <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Clock out</label>
          <input
            type="datetime-local"
            value={editClockOut}
            onChange={e => setEditClockOut(e.target.value)}
            style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', padding: '8px 10px', fontSize: '13px', marginBottom: '0.75rem' }}
          />

          <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Break (unpaid), minutes</label>
          <input
            type="number"
            min={0}
            value={editBreakMinutes}
            onChange={e => setEditBreakMinutes(e.target.value)}
            style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', padding: '8px 10px', fontSize: '13px', marginBottom: '1rem' }}
          />

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setEditingEntry(null)}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#94a3b8', fontSize: '13px', padding: '8px 14px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={saveEntryEdit}
              disabled={savingEntry}
              style={{ background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 14px', cursor: savingEntry ? 'default' : 'pointer', opacity: savingEntry ? 0.6 : 1 }}
            >
              {savingEntry ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── SHIFT DRAWER BACKDROP ── */}
    {showShiftForm && (
      <div
        onClick={closeDrawer}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40, backdropFilter: 'blur(2px)' }}
      />
    )}

    {/* ── SHIFT DRAWER ── */}
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: '300px', maxWidth: '100vw',
      background: '#1e293b', borderLeft: '1px solid rgba(255,255,255,0.08)',
      zIndex: 50, display: 'flex', flexDirection: 'column', overflowX: 'hidden',
      transform: showShiftForm ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      boxShadow: showShiftForm ? '-12px 0 40px rgba(0,0,0,0.5)' : 'none',
    }}>

      {/* Drawer header */}
      <div style={{ padding: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {shiftIsOpen ? (
              <>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>Open shift</div>
                  <div style={{ fontSize: '11px', color: '#4ade80' }}>Anyone can claim</div>
                </div>
              </>
            ) : drawerSelectedEmp ? (
              <>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: getRoleColor(drawerSelectedEmp.role).bg, border: `1px solid ${getRoleColor(drawerSelectedEmp.role).border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: getRoleColor(drawerSelectedEmp.role).text, flexShrink: 0 }}>
                  {drawerSelectedEmp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>{drawerSelectedEmp.name}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{drawerSelectedEmp.role}</div>
                </div>
              </>
            ) : (
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>New shift</div>
            )}
          </div>
          <button onClick={closeDrawer} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '4px' }}>✕</button>
        </div>
        {shiftDate && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#93c5fd', background: 'rgba(29,78,216,0.12)', border: '1px solid rgba(29,78,216,0.22)', borderRadius: '6px', padding: '3px 9px' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {new Date(shiftDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>

      {/* Drawer body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Employee selector (if not pre-filled and not open shift) */}
        {!shiftIsOpen && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Employee</div>
            <select
              value={shiftEmpId}
              onChange={e => setShiftEmpId(Number(e.target.value))}
              style={{ width: '100%', fontSize: '13px', padding: '9px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: shiftEmpId ? '#e2e8f0' : '#475569', cursor: 'pointer' }}
            >
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}

        {/* Date */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Date</div>
          <input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)}
            style={{ width: '100%', fontSize: '13px', padding: '9px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }}
          />
        </div>

        {/* Time blocks */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Shift time</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px', cursor: 'pointer' }}>
              <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px' }}>Start</div>
              <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)}
                style={{ width: '100%', minWidth: 0, maxWidth: '100%', fontSize: '16px', fontWeight: 600, background: 'none', border: 'none', color: '#f1f5f9', padding: 0, colorScheme: 'dark', outline: 'none' }}
              />
            </div>
            <div style={{ textAlign: 'center', color: '#334155', fontSize: '13px' }}>↓</div>
            <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px', cursor: 'pointer' }}>
              <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px' }}>End</div>
              <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)}
                style={{ width: '100%', minWidth: 0, maxWidth: '100%', fontSize: '16px', fontWeight: 600, background: 'none', border: 'none', color: '#f1f5f9', padding: 0, colorScheme: 'dark', outline: 'none' }}
              />
            </div>
          </div>
          {drawerHours != null && (
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: '#4ade80', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '20px', padding: '3px 9px' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {drawerHours % 1 === 0 ? drawerHours : drawerHours.toFixed(1)}h
              </span>
              <span style={{ fontSize: '11px', color: '#334155' }}>duration</span>
            </div>
          )}
          {needsBreakWarning && (
            <div style={{ marginTop: '8px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>⚠</span> No break scheduled for a {drawerHours! % 1 === 0 ? drawerHours : drawerHours!.toFixed(1)}-hr shift
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                CA-style policy requires a 30-min break for shifts over 5 hours.
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  onClick={() => setShiftNotes(v => v.trim() ? `${v.trim()} · 30-min break` : '30-min break')}
                  style={{ fontSize: '11px', fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', padding: '4px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Add 30-min break
                </button>
                <button
                  onClick={() => setBreakWarningDismissed(true)}
                  style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick presets */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Quick presets</div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {[
              { label: 'Morning', start: '09:00', end: '17:00' },
              { label: 'Afternoon', start: '14:00', end: '22:00' },
              { label: 'Evening', start: '17:00', end: '23:00' },
            ].map(p => {
              const active = shiftStart === p.start && shiftEnd === p.end
              return (
                <button key={p.label} onClick={() => { setShiftStart(p.start); setShiftEnd(p.end) }}
                  style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${active ? 'rgba(29,78,216,0.5)' : 'rgba(255,255,255,0.08)'}`, background: active ? 'rgba(29,78,216,0.2)' : 'rgba(255,255,255,0.03)', color: active ? '#93c5fd' : '#64748b', transition: 'all 0.1s' }}
                >{p.label}</button>
              )
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Notes</div>
          <textarea
            value={shiftNotes} onChange={e => setShiftNotes(e.target.value)}
            placeholder="Opening shift, training, etc."
            rows={2}
            style={{ width: '100%', fontSize: '12px', padding: '9px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', resize: 'none', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
          />
        </div>

        {/* Open shift toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>Post as open shift</div>
            <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>Employees can claim this</div>
          </div>
          <button
            onClick={() => { setShiftIsOpen(v => !v); if (!shiftIsOpen) setShiftEmpId('') }}
            style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: shiftIsOpen ? '#22c55e' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
          >
            <div style={{ position: 'absolute', top: 3, left: shiftIsOpen ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </button>
        </div>

        {/* Repeat */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" id="repeat-chk" checked={repeatEnabled} onChange={e => { setRepeatEnabled(e.target.checked); if (!e.target.checked) setRepeatWeeks(1) }}
            style={{ width: 14, height: 14, accentColor: '#3b82f6', cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="repeat-chk" style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>Repeat weekly for</label>
          {repeatEnabled && (
            <select value={repeatWeeks} onChange={e => setRepeatWeeks(Number(e.target.value))}
              style={{ fontSize: '12px', padding: '3px 7px', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', cursor: 'pointer' }}
            >
              {[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>{n} weeks</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Drawer footer */}
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button
          onClick={handleAddShift} disabled={savingShift}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#1d4ed8', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: savingShift ? 'not-allowed' : 'pointer', opacity: savingShift ? 0.7 : 1, fontFamily: 'inherit' }}
        >{savingShift ? 'Saving…' : 'Save shift'}</button>
        <button
          onClick={closeDrawer}
          style={{ width: '100%', padding: '8px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
        >Cancel</button>
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
