'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import CalloutModal from '../components/CalloutModal'
import { useToast } from '../components/Toast'

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
  const [swapRequests, setSwapRequests] = useState<ShiftSwap[]>([])

  // Weekly view
  const [weekOffset, setWeekOffset] = useState(0)
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

  // Callout modal
  type CalloutTarget = { shiftId: number; shiftDate: string; startTime: string; endTime: string; employee: { id: number; name: string } }
  const [calloutTarget, setCalloutTarget] = useState<CalloutTarget | null>(null)

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
  }

  function closeDrawer() {
    setShowShiftForm(false)
    setShiftIsOpen(false)
    setRepeatEnabled(false)
    setRepeatWeeks(1)
    setShiftEmpId('')
  }

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

    const [{ data: emps }, { data: sh }, { data: reqs }, { data: ents }, { data: depts }, { data: memberships }] = await Promise.all([
      supabase.from('employees').select('id, name, role, pay_type, pay_rate').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('shifts').select('*').eq('user_id', session.user.id).order('shift_date'),
      supabase.from('time_off_requests').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('time_entries').select('*').eq('user_id', session.user.id).gte('clock_in', weekStartISO()).order('clock_in', { ascending: false }),
      supabase.from('departments').select('id, name, color').eq('user_id', session.user.id).order('name'),
      supabase.from('department_members').select('employee_id, department_id'),
    ])
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
    if (!shiftIsOpen && !shiftEmpId) { showToast('Select an employee or mark as open shift.', 'error'); return }
    if (!shiftDate) { showToast('Select a date.', 'error'); return }
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
    if (error) { showToast('Error saving.', 'error') }
    else {
      setShifts(prev => [...prev, ...(data ?? [])].sort((a, b) => a.shift_date.localeCompare(b.shift_date)))
      showToast(repeatWeeks > 1 ? `${repeatWeeks} shifts added.` : 'Shift added.', 'success')
      setShowShiftForm(false); setShiftEmpId(''); setShiftDate(''); setShiftNotes('')
      setRepeatEnabled(false); setRepeatWeeks(1); setShiftIsOpen(false)
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
              disabled={generating}
              title="Fill this week from employee availability"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: generating ? '#4ade80' : '#64748b', fontSize: '12px', fontWeight: 500, cursor: generating ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'color 0.15s' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              {generating ? 'Generating…' : 'Auto-generate'}
            </button>
            <button
              onClick={copyLastWeek}
              disabled={copyingWeek}
              title="Copy last week's shifts into this week"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: copyingWeek ? '#4ade80' : '#64748b', fontSize: '12px', fontWeight: 500, cursor: copyingWeek ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'color 0.15s' }}
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
                                </div>
                              ) : (
                                <div style={{ fontSize: '10px', color: isDragOver ? '#93c5fd' : '#334155', textAlign: 'center' }}>
                                  {isDragOver ? 'Drop here' : isUnavailable ? 'Unavailable' : '+ add'}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {/* Weekly hours total */}
                        {(() => {
                          const hrs = scheduledHoursByEmployee.get(emp.id) ?? 0
                          const isOT = hrs > 40
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
