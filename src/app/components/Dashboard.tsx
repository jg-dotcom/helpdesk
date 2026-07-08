'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'
import EmployeePanel from './EmployeePanel'
import Nav from './Nav'
import CalloutModal from './CalloutModal'

type TimeOffRequest = {
  id: number
  employee_id: number
  start_date: string
  end_date: string
  type: string
  reason: string | null
  status: string
  created_at: string
}

type ShiftSwap = {
  id: number
  requester_id: number
  target_id: number
  requester_shift_id: number
  target_shift_id: number
  status: string
  created_at: string
  requester_name?: string
  target_name?: string
  shift_date?: string
  start_time?: string
  end_time?: string
}

type ActivityItem = {
  id: string
  type: 'clock_in' | 'callout' | 'pto_request' | 'swap_request' | 'pto_approved'
  text: string
  sub: string
  time: string
}

type Props = {
  employees: Employee[]
  selectedEmp: Employee | null
  docsGenerated: number
  loading: boolean
  viewerRole: 'owner' | 'admin' | 'manager' | 'employee'
  viewerPerms: Record<string, boolean> | null
  onSelectEmp: (emp: Employee) => void
  onAddEmployee: (emp: Omit<Employee, 'id'>) => void
  onUpdateEmployee: (emp: Employee) => void
  onDeleteEmployee: (id: number) => void
  onStartAction: (type: ActionType) => void
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function weekStartISO(offsetWeeks = 0) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() - offsetWeeks * 7)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function fmtShortDate(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(t: string) {
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Dashboard({
  employees, selectedEmp, docsGenerated, loading, viewerRole, viewerPerms,
  onSelectEmp, onAddEmployee, onUpdateEmployee, onDeleteEmployee, onStartAction
}: Props) {
  const [firstName, setFirstName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [token, setToken] = useState('')

  // Operational data
  const [clockedInEntries, setClockedInEntries] = useState<{ employee_id: number; clock_in: string }[]>([])
  const [todayShifts, setTodayShifts] = useState<{ id: number; employee_id: number; start_time: string; end_time: string; status?: string }[]>([])
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [pendingSwaps, setPendingSwaps] = useState<ShiftSwap[]>([])
  const [upcomingTimeOff, setUpcomingTimeOff] = useState<TimeOffRequest[]>([])
  const [weeklyMins, setWeeklyMins] = useState<Record<number, number>>({})
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([])
  const [recentAnnouncement, setRecentAnnouncement] = useState<{ title: string; sent_count: number; created_at: string } | null>(null)

  // UI state
  const [showAddForm, setShowAddForm] = useState(false)
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
  const [showTerminated, setShowTerminated] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openTab, setOpenTab] = useState<'info' | 'onboarding' | 'offboarding'>('info')
  const [departments, setDepartments] = useState<{ id: number; name: string; color: string }[]>([])
  const [deptMembers, setDeptMembers] = useState<Record<number, number[]>>({})
  const [filterDept, setFilterDept] = useState<number | null>(null)
  const [approving, setApproving] = useState<Record<string, boolean>>({})

  type CalloutTarget = { shiftId: number; shiftDate: string; startTime: string; endTime: string; employee: { id: number; name: string } }
  const [calloutTarget, setCalloutTarget] = useState<CalloutTarget | null>(null)

  // Add employee form
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newType, setNewType] = useState('Full-time')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)

  // Announcement form
  const [annTitle, setAnnTitle] = useState('')
  const [annMsg, setAnnMsg] = useState('')
  const [annSending, setAnnSending] = useState(false)
  const [annResult, setAnnResult] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setToken(session.access_token)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const first = (user.user_metadata?.full_name ?? '').trim().split(' ')[0]
        if (first) setFirstName(first)
      }
      const res = await fetch('/api/settings/business', { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) {
        const d = await res.json()
        if (d?.profile?.business_name) setBusinessName(d.profile.business_name)
      }
    })
  }, [])

  useEffect(() => {
    if (token) {
      loadOperationalData()
      loadDepartments()
    }
  }, [token, employees])

  async function loadOperationalData() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id
    const today = new Date().toISOString().slice(0, 10)
    const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [
      { data: clockedIn },
      { data: weekly },
      { data: todayScheduled },
      { data: ptoRequests },
      { data: swaps },
      { data: upcoming },
      { data: recentClockIns },
      { data: announcements },
    ] = await Promise.all([
      supabase.from('time_entries').select('employee_id, clock_in').eq('user_id', uid).is('clock_out', null),
      supabase.from('time_entries').select('employee_id, total_minutes, clock_in, clock_out').eq('user_id', uid).gte('clock_in', weekStartISO(0)),
      supabase.from('shifts').select('id, employee_id, start_time, end_time, status').eq('user_id', uid).eq('shift_date', today).order('start_time'),
      supabase.from('time_off_requests').select('*').eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('shift_swaps').select('*').eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('time_off_requests').select('*').eq('user_id', uid).eq('status', 'approved').gte('end_date', today).lte('start_date', twoWeeks).order('start_date'),
      supabase.from('time_entries').select('employee_id, clock_in').eq('user_id', uid).gte('clock_in', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).order('clock_in', { ascending: false }).limit(10),
      supabase.from('announcements').select('title, sent_count, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(1),
    ])

    setClockedInEntries(clockedIn ?? [])
    setTodayShifts(todayScheduled ?? [])
    setTimeOffRequests(ptoRequests ?? [])
    setUpcomingTimeOff(upcoming ?? [])
    if (announcements?.[0]) setRecentAnnouncement(announcements[0])

    // Enrich swaps with employee names
    const enrichedSwaps: ShiftSwap[] = (swaps ?? []).map((s: ShiftSwap) => ({
      ...s,
      requester_name: employees.find(e => e.id === s.requester_id)?.name ?? 'Employee',
      target_name: employees.find(e => e.id === s.target_id)?.name ?? 'Employee',
    }))
    setPendingSwaps(enrichedSwaps)

    // Weekly mins
    const mins: Record<number, number> = {}
    for (const e of (weekly ?? [])) {
      const elapsed = e.clock_out ? (e.total_minutes ?? 0) : Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 60000)
      mins[e.employee_id] = (mins[e.employee_id] ?? 0) + elapsed
    }
    setWeeklyMins(mins)

    // Build activity feed from recent clock-ins + PTO requests + swaps
    const feed: ActivityItem[] = []
    for (const c of (recentClockIns ?? []).slice(0, 5)) {
      const emp = employees.find(e => e.id === c.employee_id)
      if (emp) feed.push({ id: `ci_${c.employee_id}_${c.clock_in}`, type: 'clock_in', text: `${emp.name} clocked in`, sub: '', time: c.clock_in })
    }
    for (const r of (ptoRequests ?? []).slice(0, 3)) {
      const emp = employees.find(e => e.id === r.employee_id)
      if (emp) feed.push({ id: `pto_${r.id}`, type: 'pto_request', text: `${emp.name} requested time off`, sub: `${fmtShortDate(r.start_date)} – ${fmtShortDate(r.end_date)}`, time: r.created_at })
    }
    for (const s of (swaps ?? []).slice(0, 3)) {
      const req = employees.find(e => e.id === s.requester_id)
      const tgt = employees.find(e => e.id === s.target_id)
      if (req) feed.push({ id: `swap_${s.id}`, type: 'swap_request', text: `Shift swap requested`, sub: `${req.name} → ${tgt?.name ?? 'Employee'}`, time: s.created_at })
    }
    // Sort by time desc
    feed.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    setActivityFeed(feed.slice(0, 8))
  }

  async function loadDepartments() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const [{ data: depts }, { data: members }] = await Promise.all([
      supabase.from('departments').select('id, name, color').eq('user_id', session.user.id).order('name'),
      supabase.from('department_members').select('employee_id, department_id'),
    ])
    if (depts) setDepartments(depts)
    if (members) {
      const map: Record<number, number[]> = {}
      members.forEach((m: { employee_id: number; department_id: number }) => {
        if (!map[m.employee_id]) map[m.employee_id] = []
        map[m.employee_id].push(m.department_id)
      })
      setDeptMembers(map)
    }
  }

  async function handleTimeOff(id: number, status: 'approved' | 'denied') {
    setApproving(p => ({ ...p, [`pto_${id}`]: true }))
    await fetch(`/api/time-off/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    })
    setTimeOffRequests(prev => prev.filter(r => r.id !== id))
    setApproving(p => ({ ...p, [`pto_${id}`]: false }))
  }

  async function handleSwap(id: number, status: 'approved' | 'denied') {
    setApproving(p => ({ ...p, [`swap_${id}`]: true }))
    await fetch(`/api/shifts/swaps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    })
    setPendingSwaps(prev => prev.filter(s => s.id !== id))
    setApproving(p => ({ ...p, [`swap_${id}`]: false }))
  }

  async function sendAnnouncement() {
    if (!annTitle.trim() || !annMsg.trim()) return
    setAnnSending(true)
    setAnnResult('')
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: annTitle, message: annMsg }),
    })
    const data = await res.json()
    if (res.ok) {
      setAnnResult(`Sent to ${data.sent} employee${data.sent !== 1 ? 's' : ''}.`)
      setAnnTitle(''); setAnnMsg('')
      setRecentAnnouncement({ title: annTitle, sent_count: data.sent, created_at: new Date().toISOString() })
      setTimeout(() => { setShowAnnouncementModal(false); setAnnResult('') }, 1500)
    } else {
      setAnnResult(data.error || 'Something went wrong.')
    }
    setAnnSending(false)
  }

  async function handleAdd() {
    if (!newName || !newRole) return
    setSaving(true)
    await onAddEmployee({
      name: newName, role: newRole,
      start: newStart || new Date().toISOString().slice(0, 10),
      type: newType, phone: newPhone, email: newEmail,
      address: '', emergency_contact: '', ssn_last4: '', date_of_birth: '',
      status: 'active', i9_status: 'pending', w4_status: 'pending',
      direct_deposit_status: 'pending', pay_type: 'hourly', pay_rate: null,
      pay_period: 'biweekly', access_role: 'employee',
    })
    setNewName(''); setNewRole(''); setNewStart(''); setNewType('Full-time'); setNewPhone(''); setNewEmail('')
    setShowAddForm(false)
    setSaving(false)
  }

  // Derived values
  const clockedInIds = new Set(clockedInEntries.map(c => c.employee_id))
  const todayCallouts = todayShifts.filter(s => s.status === 'called_out')
  const pendingCount = timeOffRequests.length + pendingSwaps.length + todayCallouts.length
  const activeEmployees = employees.filter(e => !e.status || e.status === 'active')

  // Dark theme style helpers
  const s = {
    card: { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', overflow: 'hidden' as const },
    cardPad: { padding: '14px 16px' },
    sectionLabel: { fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' },
    row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' },
    avatar: (color = '#1e3a5f', text = '#93c5fd') => ({ width: 32, height: 32, borderRadius: '50%', background: color, color: text, fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
    pill: (bg: string, color: string) => ({ fontSize: '10px', fontWeight: 600, padding: '2px 9px', borderRadius: '99px', background: bg, color, flexShrink: 0 }),
    btnApprove: { fontSize: '12px', padding: '5px 14px', borderRadius: '7px', background: '#1d4ed8', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500, flexShrink: 0 },
    btnDeny: { fontSize: '12px', padding: '5px 12px', borderRadius: '7px', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', flexShrink: 0 },
    btnCallout: { fontSize: '12px', padding: '5px 14px', borderRadius: '7px', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500, flexShrink: 0 },
  }

  return (
    <>
    <div className="dash-wrap">
      <Nav active="dashboard" viewerRole={viewerRole} viewerPerms={viewerPerms} />

      <div style={{ padding: '0 1.5rem 2rem', maxWidth: '1280px', margin: '0 auto', minHeight: '100vh', background: '#0f172a' }}>

        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 0 1rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 500, color: '#f1f5f9' }}>
              {greeting()}{firstName ? `, ${firstName}` : ''}
            </div>
            {businessName && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{businessName}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setShowAnnouncementModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
              Post announcement
            </button>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
          {[
            { val: loading ? '–' : clockedInEntries.length, label: 'Clocked in now', color: '#f1f5f9' },
            { val: loading ? '–' : todayCallouts.length, label: 'Called out today', color: todayCallouts.length > 0 ? '#f87171' : '#f1f5f9' },
            { val: loading ? '–' : pendingCount, label: 'Pending approvals', color: pendingCount > 0 ? '#fbbf24' : '#f1f5f9' },
            { val: loading ? '–' : todayShifts.length, label: 'On shift today', color: '#f1f5f9' },
          ].map(stat => (
            <div key={stat.label} style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '26px', fontWeight: 600, color: stat.color }}>{stat.val}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ── Needs your attention ── */}
        {pendingCount > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <div style={s.sectionLabel}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ color: '#f87171' }}>Needs your attention</span>
            </div>
            <div style={{ ...s.card, border: '1px solid rgba(248,113,113,0.2)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'rgba(248,113,113,0.07)', borderBottom: '1px solid rgba(248,113,113,0.12)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#fca5a5' }}>{pendingCount} request{pendingCount !== 1 ? 's' : ''} waiting</span>
                <span style={{ background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '99px', marginLeft: '2px' }}>{pendingCount}</span>
              </div>

              {/* PTO requests */}
              {timeOffRequests.map(req => {
                const emp = employees.find(e => e.id === req.employee_id)
                const key = `pto_${req.id}`
                return (
                  <div key={req.id} style={s.row}>
                    <div style={s.avatar()}>{emp ? initials(emp.name) : '??'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{emp?.name ?? 'Employee'}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        PTO request · {fmtShortDate(req.start_date)} – {fmtShortDate(req.end_date)}
                        {req.reason ? ` · "${req.reason}"` : ''}
                      </div>
                    </div>
                    <span style={s.pill('rgba(59,130,246,0.15)', '#93c5fd')}>Time off</span>
                    <button onClick={() => handleTimeOff(req.id, 'approved')} disabled={!!approving[key]} style={s.btnApprove}>
                      {approving[key] ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => handleTimeOff(req.id, 'denied')} disabled={!!approving[key]} style={s.btnDeny}>Deny</button>
                  </div>
                )
              })}

              {/* Swap requests */}
              {pendingSwaps.map(swap => {
                const key = `swap_${swap.id}`
                return (
                  <div key={swap.id} style={s.row}>
                    <div style={s.avatar('rgba(34,197,94,0.15)', '#86efac')}>{swap.requester_name ? initials(swap.requester_name) : '??'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>
                        {swap.requester_name} → {swap.target_name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Shift swap request · {timeAgo(swap.created_at)}</div>
                    </div>
                    <span style={s.pill('rgba(34,197,94,0.15)', '#86efac')}>Swap</span>
                    <button onClick={() => handleSwap(swap.id, 'approved')} disabled={!!approving[key]} style={s.btnApprove}>
                      {approving[key] ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => handleSwap(swap.id, 'denied')} disabled={!!approving[key]} style={s.btnDeny}>Deny</button>
                  </div>
                )
              })}

              {/* Callout items */}
              {todayCallouts.map(shift => {
                const emp = employees.find(e => e.id === shift.employee_id)
                return (
                  <div key={shift.id} style={s.row}>
                    <div style={s.avatar('rgba(248,113,113,0.15)', '#fca5a5')}>{emp ? initials(emp.name) : '??'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{emp?.name ?? 'Employee'} called out</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Today {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                        {emp?.role ? ` · ${emp.role}` : ''}
                      </div>
                    </div>
                    <span style={s.pill('rgba(248,113,113,0.15)', '#fca5a5')}>Callout</span>
                    <button
                      onClick={() => emp && setCalloutTarget({ shiftId: shift.id, shiftDate: new Date().toISOString().slice(0, 10), startTime: shift.start_time, endTime: shift.end_time, employee: { id: emp.id, name: emp.name } })}
                      style={s.btnCallout}
                    >
                      Post open shift
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Two-column middle ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '18px' }}>

          {/* Team at a glance */}
          <div>
            <div style={s.sectionLabel}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Team at a glance
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {todayShifts.length} on shift
              </span>
            </div>
            <div style={s.card}>
              {/* Roster header */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0' }}>Today&apos;s roster</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{todayShifts.length} on shift</span>
              </div>
              {todayShifts.length === 0 ? (
                <div style={{ ...s.cardPad, fontSize: '13px', color: '#475569', textAlign: 'center', padding: '1.5rem' }}>No shifts scheduled today</div>
              ) : (
                todayShifts.slice(0, 8).map(shift => {
                  const emp = employees.find(e => e.id === shift.employee_id)
                  const isIn = clockedInIds.has(shift.employee_id)
                  const isCallout = shift.status === 'called_out'
                  const dotColor = isCallout ? '#f87171' : isIn ? '#4ade80' : '#475569'
                  const statusColor = isCallout ? '#f87171' : isIn ? '#4ade80' : '#64748b'
                  const statusLabel = isCallout ? 'Called out' : isIn ? 'Clocked in' : 'Not yet in'
                  const avatarBg = isCallout ? 'rgba(248,113,113,0.15)' : isIn ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.07)'
                  const avatarColor = isCallout ? '#fca5a5' : isIn ? '#86efac' : '#94a3b8'
                  return (
                    <div key={shift.id} style={{ ...s.row, cursor: 'pointer' }} onClick={() => emp && onSelectEmp(emp)}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <div style={s.avatar(avatarBg, avatarColor)}>{emp ? initials(emp.name) : '??'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp?.name ?? 'Unknown'}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{emp?.role} · {formatTime(shift.start_time)}–{formatTime(shift.end_time)}</div>
                      </div>
                      <div style={{ fontSize: '11px', fontWeight: 500, color: statusColor, flexShrink: 0 }}>{statusLabel}</div>
                    </div>
                  )
                })
              )}
              {/* Off today employees */}
              {activeEmployees.filter(e => !todayShifts.some(sh => sh.employee_id === e.id)).slice(0, 3).map(emp => (
                <div key={emp.id} style={{ ...s.row, opacity: 0.5, cursor: 'pointer' }} onClick={() => onSelectEmp(emp)}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#334155', flexShrink: 0 }} />
                  <div style={s.avatar('rgba(255,255,255,0.05)', '#64748b')}>{initials(emp.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#cbd5e1' }}>{emp.name}</div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>{emp.role}</div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>Off today</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column: announcements + activity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Recent announcement */}
            <div>
              <div style={s.sectionLabel}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
                Recent announcements
              </div>
              <div style={{ ...s.card, ...s.cardPad }}>
                {recentAnnouncement ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: 38, height: 38, borderRadius: '10px', background: 'rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recentAnnouncement.title}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Sent to all staff · {recentAnnouncement.sent_count} read · {timeAgo(recentAnnouncement.created_at)}
                      </div>
                    </div>
                    <button onClick={() => setShowAnnouncementModal(true)} style={{ fontSize: '11px', padding: '5px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', flexShrink: 0 }}>
                      New
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontSize: '13px', color: '#475569', flex: 1 }}>No announcements yet</div>
                    <button onClick={() => setShowAnnouncementModal(true)} style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '7px', background: '#1d4ed8', color: '#fff', border: 'none', cursor: 'pointer' }}>
                      Post one
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Activity feed */}
            <div style={{ flex: 1 }}>
              <div style={s.sectionLabel}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Activity feed
              </div>
              <div style={s.card}>
                {activityFeed.length === 0 ? (
                  <div style={{ ...s.cardPad, fontSize: '13px', color: '#475569', textAlign: 'center', padding: '1.5rem' }}>No recent activity</div>
                ) : activityFeed.map(item => {
                  const iconMap = {
                    clock_in:    { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, bg: 'rgba(74,222,128,0.12)', color: '#86efac' },
                    callout:     { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, bg: 'rgba(248,113,113,0.12)', color: '#fca5a5' },
                    pto_request: { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, bg: 'rgba(96,165,250,0.12)', color: '#93c5fd' },
                    swap_request:{ icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>, bg: 'rgba(74,222,128,0.12)', color: '#86efac' },
                    pto_approved:{ icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>, bg: 'rgba(74,222,128,0.12)', color: '#86efac' },
                  }
                  const icon = iconMap[item.type]
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '7px', background: icon.bg, color: icon.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                        {icon.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0' }}>{item.text}</div>
                        {item.sub && <div style={{ fontSize: '11px', color: '#64748b' }}>{item.sub}</div>}
                      </div>
                      <div style={{ fontSize: '11px', color: '#475569', flexShrink: 0 }}>{timeAgo(item.time)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Upcoming time off ── */}
        {upcomingTimeOff.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <div style={s.sectionLabel}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Upcoming time off
            </div>
            <div style={{ ...s.card, display: 'flex', flexWrap: 'wrap' as const }}>
              {upcomingTimeOff.map(req => {
                const emp = employees.find(e => e.id === req.employee_id)
                return (
                  <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', width: '50%', boxSizing: 'border-box' as const }}>
                    <div style={s.avatar()}>{emp ? initials(emp.name) : '??'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{emp?.name ?? 'Employee'}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{req.type} · {fmtShortDate(req.start_date)} – {fmtShortDate(req.end_date)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Team section ── */}
        <div style={{ ...s.card }} id="team-section">
          <div style={{ ...s.cardPad, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: '8px' }}>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#f1f5f9' }}>Your team</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
              {employees.length > 5 && (
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', borderRadius: '7px', width: '140px', outline: 'none' }} />
              )}
              {departments.length > 0 && departments.map(dept => (
                <button key={dept.id} onClick={() => setFilterDept(filterDept === dept.id ? null : dept.id)}
                  style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', border: `1.5px solid ${filterDept === dept.id ? dept.color : 'rgba(255,255,255,0.1)'}`, background: filterDept === dept.id ? dept.color : 'transparent', color: filterDept === dept.id ? '#fff' : '#94a3b8', cursor: 'pointer' }}>
                  {dept.name}
                </button>
              ))}
              {employees.some(e => e.status === 'terminated') && (
                <button onClick={() => setShowTerminated(v => !v)} style={{ fontSize: '12px', color: showTerminated ? '#60a5fa' : '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                  {showTerminated ? 'Hide terminated' : 'Show terminated'}
                </button>
              )}
              <button onClick={() => setShowAddForm(v => !v)} style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '7px', background: '#1d4ed8', color: '#fff', border: 'none', cursor: 'pointer' }}>+ Add employee</button>
            </div>
          </div>

          {showAddForm && (
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                {[['Name', newName, setNewName, 'Jane Smith'], ['Role', newRole, setNewRole, 'Cashier'], ['Email', newEmail, setNewEmail, 'jane@example.com'], ['Phone', newPhone, setNewPhone, '(555) 123-4567']].map(([label, val, setter, ph]) => (
                  <div key={label as string}>
                    <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>{label}</label>
                    <input value={val as string} onChange={e => (setter as (v: string) => void)(e.target.value)} placeholder={ph as string} style={{ width: '100%', padding: '7px 10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', borderRadius: '7px', fontSize: '13px', outline: 'none' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Start date</label>
                  <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} style={{ width: '100%', padding: '7px 10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', borderRadius: '7px', fontSize: '13px', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Type</label>
                  <select value={newType} onChange={e => setNewType(e.target.value)} style={{ width: '100%', padding: '7px 10px', border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b', color: '#f1f5f9', borderRadius: '7px', fontSize: '13px', outline: 'none' }}>
                    <option>Full-time</option><option>Part-time</option><option>Seasonal</option>
                  </select>
                </div>
              </div>
              <button onClick={handleAdd} disabled={saving || !newName || !newRole} style={{ padding: '7px 18px', borderRadius: '7px', background: '#1d4ed8', color: '#fff', border: 'none', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>
                {saving ? 'Saving…' : 'Save employee'}
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: '#475569' }}>Loading your team…</div>
          ) : employees.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: '#475569' }}>No employees yet — add your first one above.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
              {employees.filter(emp => {
                if (!showTerminated && emp.status === 'terminated') return false
                if (filterDept !== null && !deptMembers[emp.id]?.includes(filterDept)) return false
                if (searchQuery) { const q = searchQuery.toLowerCase(); return emp.name.toLowerCase().includes(q) || emp.role?.toLowerCase().includes(q) }
                return true
              }).map(emp => {
                const empDepts = departments.filter(d => (deptMembers[emp.id] ?? []).includes(d.id))
                const isIn = clockedInIds.has(emp.id)
                return (
                  <div key={emp.id} onClick={() => onSelectEmp(selectedEmp?.id === emp.id ? null as any : emp)}
                    style={{ background: selectedEmp?.id === emp.id ? 'rgba(29,78,216,0.2)' : '#1e293b', padding: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '6px', position: 'relative' }}>
                    {isIn && <div style={{ position: 'absolute', top: '10px', right: '10px', width: 7, height: 7, borderRadius: '50%', background: '#4ade80' }} />}
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: selectedEmp?.id === emp.id ? '#1d4ed8' : 'rgba(59,130,246,0.15)', color: selectedEmp?.id === emp.id ? '#fff' : '#93c5fd', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(emp.name)}</div>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{emp.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{emp.role}</div>
                    {empDepts.length > 0 && <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {empDepts.map(d => <span key={d.id} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '99px', background: d.color + '22', color: d.color, border: `0.5px solid ${d.color}55` }}>{d.name}</span>)}
                    </div>}
                    {emp.status && emp.status !== 'active' && <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '99px', background: emp.status === 'terminated' ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', color: emp.status === 'terminated' ? '#fca5a5' : '#fcd34d' }}>{emp.status === 'on_leave' ? 'On leave' : 'Terminated'}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {selectedEmp && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '1rem 1.25rem' }}>
              <EmployeePanel
                employee={selectedEmp}
                initialTab={openTab}
                onClose={() => { onSelectEmp(null as any); setOpenTab('info') }}
                onUpdated={onUpdateEmployee}
                onDelete={id => { onDeleteEmployee(id); onSelectEmp(null as any) }}
                onStartAction={onStartAction}
              />
            </div>
          )}
        </div>

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
        onCalloutMarked={(id) => { setTodayShifts(prev => prev.map(s => s.id === id ? { ...s, status: 'called_out' } : s)); setCalloutTarget(null) }}
      />
    )}

    {/* Announcement modal */}
    {showAnnouncementModal && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAnnouncementModal(false)}>
        <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '1.5rem', width: '460px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '15px', fontWeight: 500, color: '#f1f5f9' }}>Post announcement</div>
            <button onClick={() => setShowAnnouncementModal(false)} style={{ fontSize: '20px', lineHeight: 1, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Title</label>
            <input value={annTitle} onChange={e => setAnnTitle(e.target.value)} placeholder="e.g. Schedule change this Friday" style={{ width: '100%', padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', outline: 'none' }} />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Message</label>
            <textarea value={annMsg} onChange={e => setAnnMsg(e.target.value)} placeholder="Write your message here..." style={{ width: '100%', padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', outline: 'none', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <button onClick={sendAnnouncement} disabled={annSending || !annTitle.trim() || !annMsg.trim()}
            style={{ width: '100%', padding: '9px', borderRadius: '8px', background: annSending || !annTitle.trim() || !annMsg.trim() ? '#334155' : '#1d4ed8', color: annSending || !annTitle.trim() || !annMsg.trim() ? '#64748b' : '#fff', border: 'none', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
            {annSending ? 'Sending…' : 'Send to all employees'}
          </button>
          {annResult && <div style={{ marginTop: '8px', fontSize: '12px', color: annResult.includes('Sent') ? '#4ade80' : '#f87171', textAlign: 'center' }}>{annResult}</div>}
        </div>
      </div>
    )}
    </>
  )
}
