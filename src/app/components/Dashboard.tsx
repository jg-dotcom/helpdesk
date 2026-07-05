'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'
import EmployeePanel from './EmployeePanel'
import Nav from './Nav'
import { MegaphoneIcon } from './Icons'
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
  return name.split(' ').map(w => w[0]).join('').slice(0, 2)
}

function tenure(start: string) {
  const months = Math.floor((Date.now() - new Date(start).getTime()) / 2629800000)
  if (months < 1) return 'New'
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}yr ${months % 12}mo`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
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

function AnnouncementForm() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  async function send() {
    if (!title.trim() || !message.trim()) return
    setSending(true)
    setResult('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ title, message }),
    })
    const data = await res.json()
    if (res.ok) {
      setResult(`Sent to ${data.sent} employee${data.sent !== 1 ? 's' : ''}.`)
      setTitle('')
      setMessage('')
    } else {
      setResult(data.error || 'Something went wrong.')
    }
    setSending(false)
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: '0.6rem' }}>
        <label>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Schedule change this Friday" />
      </div>
      <div className="field" style={{ marginBottom: '0.75rem' }}>
        <label>Message</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Write your message here..." style={{ minHeight: '80px' }} />
      </div>
      <button className="btn" onClick={send} disabled={sending || !title.trim() || !message.trim()}>
        {sending ? 'Sending...' : <><MegaphoneIcon size={14} />&nbsp;Send to all employees</>}
      </button>
      {result && <div className="done-msg" style={{ marginTop: '0.5rem' }}>{result}</div>}
    </div>
  )
}


export default function Dashboard({
  employees, selectedEmp, docsGenerated, loading, viewerRole, viewerPerms,
  onSelectEmp, onAddEmployee, onUpdateEmployee, onDeleteEmployee, onStartAction
}: Props) {
  const [firstName, setFirstName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [complianceIssues, setComplianceIssues] = useState<{ name: string; missing: string[] }[]>([])
  const [filterPaperwork, setFilterPaperwork] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newType, setNewType] = useState('Full-time')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newEmergencyContact, setNewEmergencyContact] = useState('')
  const [newSsnLast4, setNewSsnLast4] = useState('')
  const [newDob, setNewDob] = useState('')
  const [newStatus, setNewStatus] = useState('active')
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [saving, setSaving] = useState(false)
  const [showTerminated, setShowTerminated] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openTab, setOpenTab] = useState<'info' | 'onboarding' | 'offboarding'>('info')
  const [clockedInEntries, setClockedInEntries] = useState<{ employee_id: number; clock_in: string }[]>([])
  const [weeklyMins, setWeeklyMins] = useState<Record<number, number>>({})
  const [lastWeekTotalMins, setLastWeekTotalMins] = useState(0)
  const [upcomingTimeOff, setUpcomingTimeOff] = useState<TimeOffRequest[]>([])
  const [todayShifts, setTodayShifts] = useState<{ id: number; employee_id: number; start_time: string; end_time: string; status?: string }[]>([])
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
  const [departments, setDepartments] = useState<{ id: number; name: string; color: string }[]>([])
  const [deptMembers, setDeptMembers] = useState<Record<number, number[]>>({}) // employee_id → dept_ids
  const [filterDept, setFilterDept] = useState<number | null>(null)

  type CalloutTarget = { shiftId: number; shiftDate: string; startTime: string; endTime: string; employee: { id: number; name: string } }
  const [calloutTarget, setCalloutTarget] = useState<CalloutTarget | null>(null)

  function selectEmpOnTab(emp: Employee, tab: 'info' | 'onboarding' | 'offboarding') {
    setOpenTab(tab)
    onSelectEmp(emp)
  }
  const [onboardingProgress, setOnboardingProgress] = useState<{
    empId: number; name: string; role: string; sentAt: string;
    w4: boolean; i9: boolean; deposit: boolean; availability: boolean; agreed: boolean;
  }[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const token = session.access_token

      // getUser() hits the server and returns fresh metadata (not stale JWT)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const fullName: string = user.user_metadata?.full_name ?? ''
        // Fall back to email prefix for accounts that predate the name field
        const first = fullName.trim().split(' ')[0]
        if (first) setFirstName(first)
      }

      // Business name: use the server-side API route (bypasses RLS)
      const res = await fetch('/api/settings/business', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const d = await res.json()
        // profile.business_name may exist but be null/empty for old accounts
        const bizName: string = d?.profile?.business_name ?? ''
        if (bizName) setBusinessName(bizName)
      }
    })
  }, [])

  useEffect(() => {
    loadComplianceIssues()
    loadOnboardingProgress()
    loadTimeOffRequests()
    loadOperationalData()
    loadDepartments()
  }, [docsGenerated, employees])

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

  async function loadComplianceIssues() {
    const active = employees.filter(e => !e.status || e.status === 'active')
    if (!active.length) { setComplianceIssues([]); return }

    const issues = active.map(emp => {
      const missing: string[] = []
      if (!emp.w4_status || emp.w4_status === 'pending') missing.push('W-4')
      if (!emp.i9_status || emp.i9_status === 'pending') missing.push('I-9')
      if (!emp.direct_deposit_status || emp.direct_deposit_status === 'pending') missing.push('Direct deposit')
      return { name: emp.name, missing }
    }).filter(e => e.missing.length > 0)

    setComplianceIssues(issues)
  }

  async function loadOnboardingProgress() {
    const active = employees.filter(e => !e.status || e.status === 'active')
    if (!active.length) { setOnboardingProgress([]); return }

    const empIds = active.map(e => e.id)
    const [{ data: links }, { data: avail }] = await Promise.all([
      supabase.from('onboarding_links').select('employee_id, created_at, acknowledged_at').in('employee_id', empIds).order('created_at', { ascending: false }),
      supabase.from('employee_availability').select('employee_id').in('employee_id', empIds),
    ])
    if (!links) return

    const latestByEmp: Record<number, { created_at: string; acknowledged_at: string | null }> = {}
    links.forEach(l => { if (!latestByEmp[l.employee_id]) latestByEmp[l.employee_id] = l })
    const availSet = new Set((avail ?? []).map(a => a.employee_id))

    const inProgress = active
      .filter(emp => latestByEmp[emp.id])
      .map(emp => ({
        empId: emp.id,
        name: emp.name,
        role: emp.role,
        sentAt: latestByEmp[emp.id].created_at,
        w4: emp.w4_status === 'complete',
        i9: emp.i9_status === 'complete',
        deposit: emp.direct_deposit_status === 'complete',
        availability: availSet.has(emp.id),
        agreed: !!latestByEmp[emp.id].acknowledged_at,
      }))
      .filter(e => !e.w4 || !e.i9 || !e.deposit || !e.availability || !e.agreed)
    setOnboardingProgress(inProgress)
  }


  async function loadTimeOffRequests() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data } = await supabase
      .from('time_off_requests')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (data) setTimeOffRequests(data)
  }

  async function loadOperationalData() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const today = new Date().toISOString().slice(0, 10)
    const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [{ data: clockedIn }, { data: weekly }, { data: lastWeekly }, { data: upcoming }, { data: todayScheduled }] = await Promise.all([
      supabase.from('time_entries').select('employee_id, clock_in').eq('user_id', session.user.id).is('clock_out', null),
      supabase.from('time_entries').select('employee_id, total_minutes, clock_in, clock_out').eq('user_id', session.user.id).gte('clock_in', weekStartISO(0)),
      supabase.from('time_entries').select('total_minutes').eq('user_id', session.user.id).gte('clock_in', weekStartISO(1)).lt('clock_in', weekStartISO(0)).not('total_minutes', 'is', null),
      supabase.from('time_off_requests').select('*').eq('user_id', session.user.id).eq('status', 'approved').gte('end_date', today).lte('start_date', twoWeeks).order('start_date'),
      supabase.from('shifts').select('id, employee_id, start_time, end_time, status').eq('user_id', session.user.id).eq('shift_date', today).order('start_time'),
    ])

    setClockedInEntries(clockedIn ?? [])
    setLastWeekTotalMins((lastWeekly ?? []).reduce((s, e) => s + (e.total_minutes ?? 0), 0))

    const mins: Record<number, number> = {}
    for (const e of (weekly ?? [])) {
      const elapsed = e.clock_out
        ? (e.total_minutes ?? 0)
        : Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 60000)
      mins[e.employee_id] = (mins[e.employee_id] ?? 0) + elapsed
    }
    setWeeklyMins(mins)

    setUpcomingTimeOff(upcoming ?? [])
    setTodayShifts(todayScheduled ?? [])
  }

  async function handleTimeOff(id: number, status: 'approved' | 'denied') {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch(`/api/time-off/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ status }),
    })
    setTimeOffRequests(prev => prev.filter(r => r.id !== id))
  }

  async function handleAdd() {
    if (!newName || !newRole) return
    setSaving(true)
    await onAddEmployee({
      name: newName,
      role: newRole,
      start: newStart || new Date().toISOString().slice(0, 10),
      type: newType,
      phone: newPhone,
      email: newEmail,
      address: newAddress,
      emergency_contact: newEmergencyContact,
      ssn_last4: newSsnLast4,
      date_of_birth: newDob,
      status: newStatus,
      i9_status: 'pending',
      w4_status: 'pending',
      direct_deposit_status: 'pending',
      pay_type: 'hourly',
      pay_rate: null,
      pay_period: 'biweekly',
      access_role: 'employee',
    })
    setNewName(''); setNewRole(''); setNewStart(''); setNewType('Full-time')
    setNewPhone(''); setNewEmail(''); setNewAddress(''); setNewEmergencyContact('')
    setNewSsnLast4(''); setNewDob(''); setNewStatus('active')
    setShowAddForm(false)
    setSaving(false)
  }

  return (
    <>
    <div className="dash-wrap">
      <Nav active="dashboard" viewerRole={viewerRole} viewerPerms={viewerPerms} />

      <div className="dash-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <div>
            <div className="dash-greeting">
              {greeting()}{firstName ? `, ${firstName}` : ''}!
            </div>
            {businessName && (
              <div style={{ fontSize: '14px', color: '#6b6b6b', marginTop: '2px' }}>
                Here&apos;s how <strong>{businessName}</strong> is doing today.
              </div>
            )}
          </div>
          <button
            className="btn-ghost"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexShrink: 0 }}
            onClick={() => setShowAnnouncementModal(true)}
          >
            <MegaphoneIcon size={14} /> Send announcement
          </button>
        </div>

        {(() => {
          // Running labor cost: sum of (elapsed hours × hourly pay_rate) for all currently clocked-in employees
          const runningCost = clockedInEntries.reduce((sum, entry) => {
            const emp = employees.find(e => e.id === entry.employee_id)
            if (!emp || emp.pay_type !== 'hourly' || !emp.pay_rate) return sum
            const elapsedHrs = (Date.now() - new Date(entry.clock_in).getTime()) / 3600000
            return sum + elapsedHrs * emp.pay_rate
          }, 0)

          const thisWeekTotalMins = Object.values(weeklyMins).reduce((s, m) => s + m, 0)
          const thisWeekHrs = Math.round(thisWeekTotalMins / 60)
          const lastWeekHrs = Math.round(lastWeekTotalMins / 60)
          const weekDiff = thisWeekHrs - lastWeekHrs

          const pendingCount = timeOffRequests.length + complianceIssues.length
          const pendingColor = pendingCount > 0 ? '#c0392b' : '#27ae60'

          return (
            <div className="dash-stats">
              {/* Active employees */}
              <div className="stat stat-clickable" onClick={() => document.getElementById('team-section')?.scrollIntoView({ behavior: 'smooth' })}>
                <div className="stat-n">{loading ? '–' : employees.filter(e => !e.status || e.status === 'active').length}</div>
                <div className="stat-l">Active employees</div>
                <div className="stat-link">View team →</div>
              </div>

              {/* Pending actions (paperwork + time-off requests) */}
              <div
                className="stat stat-clickable"
                onClick={() => {
                  if (complianceIssues.length > 0) { setFilterPaperwork(v => !v); setTimeout(() => document.getElementById('team-section')?.scrollIntoView({ behavior: 'smooth' }), 50) }
                  else window.location.href = '/time'
                }}
              >
                <div className="stat-n" style={{ color: pendingColor }}>{loading ? '–' : pendingCount}</div>
                <div className="stat-l">Pending actions</div>
                <div className="stat-link" style={{ color: pendingCount > 0 ? pendingColor : '#9a9a9a' }}>
                  {pendingCount > 0
                    ? [timeOffRequests.length > 0 && `${timeOffRequests.length} time-off`, complianceIssues.length > 0 && `${complianceIssues.length} paperwork`].filter(Boolean).join(', ')
                    : 'All clear →'}
                </div>
              </div>

              {/* Clocked in now */}
              <div className="stat stat-clickable" onClick={() => window.location.href = '/time'}>
                <div className="stat-n">{clockedInEntries.length}</div>
                <div className="stat-l">Clocked in now</div>
                <div className="stat-link">
                  {clockedInEntries.length > 0
                    ? (() => {
                        const names = employees.filter(e => clockedInEntries.some(c => c.employee_id === e.id)).map(e => e.name.split(' ')[0])
                        return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') + ' →'
                      })()
                    : 'View timesheets →'}
                </div>
              </div>

              {/* This week hours vs last week */}
              <div className="stat stat-clickable" onClick={() => window.location.href = '/time'}>
                <div className="stat-n" style={{ fontSize: '20px' }}>{thisWeekHrs}h</div>
                <div className="stat-l">Hours this week</div>
                <div className="stat-link" style={{ color: weekDiff >= 0 ? '#27ae60' : '#c0392b' }}>
                  {lastWeekHrs > 0
                    ? `${weekDiff >= 0 ? '+' : ''}${weekDiff}h vs last week`
                    : 'View time →'}
                </div>
              </div>

              {/* Running labor cost today */}
              {runningCost > 0 && (
                <div className="stat">
                  <div className="stat-n" style={{ fontSize: '20px' }}>${runningCost.toFixed(0)}</div>
                  <div className="stat-l">Running cost today</div>
                  <div className="stat-link" style={{ color: '#9a9a9a' }}>hourly wages clocked in</div>
                </div>
              )}
            </div>
          )
        })()}

        <div className="dash-grid">
          <div className="card" id="team-section">
            <div className="card-header">
              <div className="section-label">Your team</div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {employees.length > 5 && (
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search name or role..."
                    style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #dde1ea', borderRadius: '6px', width: '160px', outline: 'none' }}
                  />
                )}
                {employees.some(e => e.status === 'terminated') && (
                  <button className="btn-ghost" style={{ fontSize: '12px', color: showTerminated ? '#185fa5' : '#9a9a9a' }} onClick={() => setShowTerminated(v => !v)}>
                    {showTerminated ? 'Hide terminated' : 'Show terminated'}
                  </button>
                )}
                <button className="btn-ghost" onClick={() => setShowAddForm(v => !v)}>+ Add employee</button>
              </div>
            </div>

            {showAddForm && (
              <div className="add-form">
                <div className="row2">
                  <div className="field">
                    <label>Name</label>
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div className="field">
                    <label>Role</label>
                    <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="Cashier" />
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label>Start date</label>
                    <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Type</label>
                    <select value={newType} onChange={e => setNewType(e.target.value)}>
                      <option>Full-time</option>
                      <option>Part-time</option>
                      <option>Seasonal</option>
                    </select>
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label>Phone number</label>
                    <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="(555) 123-4567" />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@example.com" />
                  </div>
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={newAddress} onChange={e => setNewAddress(e.target.value)} placeholder="123 Main St, City, State" />
                </div>
                <div className="field">
                  <label>Emergency contact</label>
                  <input value={newEmergencyContact} onChange={e => setNewEmergencyContact(e.target.value)} placeholder="Jane Doe — (555) 987-6543" />
                </div>
                <div className="row2">
                  <div className="field">
                    <label>SSN (last 4)</label>
                    <input value={newSsnLast4} onChange={e => setNewSsnLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" maxLength={4} />
                  </div>
                  <div className="field">
                    <label>Date of birth</label>
                    <input type="date" value={newDob} onChange={e => setNewDob(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
                <button className="btn" onClick={handleAdd} disabled={saving}>
                  {saving ? 'Saving...' : 'Save employee'}
                </button>
              </div>
            )}

            {/* Department filter */}
            {departments.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button
                  onClick={() => setFilterDept(null)}
                  style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 10, border: `1.5px solid ${filterDept === null ? '#185fa5' : '#dde1ea'}`, background: filterDept === null ? '#185fa5' : '#fff', color: filterDept === null ? '#fff' : '#555', fontWeight: 600, cursor: 'pointer' }}
                >All</button>
                {departments.map(dept => (
                  <button
                    key={dept.id}
                    onClick={() => setFilterDept(filterDept === dept.id ? null : dept.id)}
                    style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 10, border: `1.5px solid ${filterDept === dept.id ? dept.color : '#dde1ea'}`, background: filterDept === dept.id ? dept.color : '#fff', color: filterDept === dept.id ? '#fff' : '#555', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: filterDept === dept.id ? 'rgba(255,255,255,0.8)' : dept.color, display: 'inline-block' }} />
                    {dept.name}
                  </button>
                ))}
              </div>
            )}

            {filterPaperwork && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: '#fff5f5', border: '1px solid #fcd4d4', marginBottom: '0.75rem', fontSize: '13px', color: '#c0392b' }}>
                <span>Showing {complianceIssues.length} employee{complianceIssues.length !== 1 ? 's' : ''} with incomplete paperwork</span>
                <button onClick={() => setFilterPaperwork(false)} style={{ marginLeft: 'auto', fontSize: '12px', color: '#185fa5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}>
                  Clear filter
                </button>
              </div>
            )}

            {loading ? (
              <div className="loading-state">Loading your team...</div>
            ) : employees.length === 0 ? (
              <div className="empty-state">No employees yet — add your first one above.</div>
            ) : (
              <div className="emp-grid">
                {employees.filter(emp => {
                  if (!showTerminated && emp.status === 'terminated') return false
                  if (filterPaperwork && !complianceIssues.find(c => c.name === emp.name)) return false
                  if (filterDept !== null && !deptMembers[emp.id]?.includes(filterDept)) return false
                  if (searchQuery) {
                    const q = searchQuery.toLowerCase()
                    return emp.name.toLowerCase().includes(q) || emp.role?.toLowerCase().includes(q)
                  }
                  return true
                }).map(emp => {
                  const empDeptIds = deptMembers[emp.id] ?? []
                  const empDepts = departments.filter(d => empDeptIds.includes(d.id))
                  return (
                    <div
                      key={emp.id}
                      className={`emp-card${selectedEmp?.id === emp.id ? ' selected' : ''}`}
                      onClick={() => onSelectEmp(selectedEmp?.id === emp.id ? null as any : emp)}
                    >
                      <div className="emp-card-top">
                        <div className="avatar">{initials(emp.name)}</div>
                      </div>
                      <div className="emp-name">{emp.name}</div>
                      <div className="emp-role">{emp.role}</div>
                      <div className="emp-tenure">{emp.type} · {tenure(emp.start)}</div>
                      {empDepts.length > 0 && (
                        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                          {empDepts.map(d => (
                            <span key={d.id} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 8, background: d.color + '22', color: d.color, fontWeight: 600, border: `1px solid ${d.color}44` }}>{d.name}</span>
                          ))}
                        </div>
                      )}
                      {emp.status && emp.status !== 'active' && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <span className={`badge ${emp.status === 'terminated' ? 'badge-red' : 'badge-yellow'}`}>
                            {emp.status === 'on_leave' ? 'On leave' : 'Terminated'}
                          </span>
                        </div>
                      )}
                      {(() => {
                        const issue = complianceIssues.find(c => c.name === emp.name)
                        return issue ? (
                          <div style={{ marginTop: '0.35rem', fontSize: '11px', color: '#9a9a9a' }}>
                            {issue.missing.join(', ')} pending
                          </div>
                        ) : null
                      })()}
                    </div>
                  )
                })}
              </div>
            )}



            {selectedEmp && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '1rem' }}>
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

          {onboardingProgress.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>Onboarding in progress</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {onboardingProgress.map(emp => {
                  const steps = [
                    { label: 'W-4', done: emp.w4 },
                    { label: 'I-9', done: emp.i9 },
                    { label: 'Deposit', done: emp.deposit },
                    { label: 'Availability', done: emp.availability },
                    { label: 'Signed', done: emp.agreed },
                  ]
                  const doneCount = steps.filter(s => s.done).length
                  const fullEmp = employees.find(e => e.id === emp.empId)
                  return (
                    <div
                      key={emp.empId}
                      onClick={() => {
                        if (!fullEmp) return
                        selectEmpOnTab(fullEmp, 'onboarding')
                        setTimeout(() => document.getElementById('team-section')?.scrollIntoView({ behavior: 'smooth' }), 50)
                      }}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                        padding: '0.75rem', borderRadius: '8px',
                        background: '#fafafa', border: '1px solid #eee',
                        cursor: fullEmp ? 'pointer' : 'default',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => { if (fullEmp) { (e.currentTarget as HTMLElement).style.borderColor = '#185fa5'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(24,95,165,0.1)' } }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#eee'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                    >
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e8edf8', color: '#185fa5', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                        {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a', marginBottom: '6px' }}>
                          {emp.name}
                          <span style={{ fontSize: '11px', fontWeight: 400, color: '#9a9a9a', marginLeft: '6px' }}>{doneCount}/{steps.length} steps</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {steps.map(s => (
                            <span key={s.label} style={{
                              fontSize: '11px', padding: '2px 7px', borderRadius: '20px',
                              background: s.done ? '#e8f8ef' : '#f0f0f0',
                              color: s.done ? '#27ae60' : '#9a9a9a',
                              fontWeight: s.done ? 600 : 400,
                              border: `1px solid ${s.done ? '#c3e6cb' : '#e8e8e8'}`,
                            }}>
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {timeOffRequests.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>
                Time-off requests
                <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, background: '#185fa5', color: '#fff', borderRadius: '10px', padding: '1px 7px' }}>
                  {timeOffRequests.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {timeOffRequests.map(req => {
                  const emp = employees.find(e => e.id === req.employee_id)
                  return (
                    <div key={req.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.65rem 0.75rem', borderRadius: '8px',
                      background: '#fafafa', border: '1px solid #eee',
                    }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e8edf8', color: '#185fa5', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {emp ? initials(emp.name) : '??'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>
                          {emp?.name || 'Employee'} — <span style={{ fontWeight: 400, color: '#555' }}>{req.type}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#9a9a9a', marginTop: '2px' }}>
                          {req.start_date} – {req.end_date}
                          {req.reason ? ` · ${req.reason}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          onClick={() => handleTimeOff(req.id, 'approved')}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #27ae60', background: '#f0faf4', color: '#27ae60', cursor: 'pointer', fontWeight: 500 }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleTimeOff(req.id, 'denied')}
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e0e0e0', background: '#fafafa', color: '#c0392b', cursor: 'pointer', fontWeight: 500 }}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Overtime alerts — only shown when someone hits 32h+ */}
          {(() => {
            const alerts = employees
              .filter(emp => (weeklyMins[emp.id] ?? 0) >= 32 * 60)
              .map(emp => ({ emp, mins: weeklyMins[emp.id] ?? 0, isOver: (weeklyMins[emp.id] ?? 0) >= 40 * 60 }))
            if (alerts.length === 0) return null
            return (
              <div className="card">
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>
                  Overtime alerts
                  <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, background: '#c0392b', color: '#fff', borderRadius: '10px', padding: '1px 7px' }}>{alerts.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {alerts.map(({ emp, mins, isOver }) => {
                    const hrs = Math.floor(mins / 60)
                    const m = mins % 60
                    const pct = Math.min((mins / (40 * 60)) * 100, 100)
                    return (
                      <div key={emp.id} style={{ padding: '0.65rem 0.75rem', borderRadius: '8px', background: isOver ? '#fff5f5' : '#fffbf0', border: `1px solid ${isOver ? '#fcd4d4' : '#fde8b4'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{emp.name}</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: isOver ? '#c0392b' : '#e67e22' }}>
                            {hrs}h{m > 0 ? ` ${m}m` : ''} {isOver ? '· over 40h' : '· approaching'}
                          </span>
                        </div>
                        <div style={{ height: 5, background: '#f0f0f0', borderRadius: 3 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: isOver ? '#c0392b' : '#e67e22', borderRadius: 3 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Today's coverage */}
          {todayShifts.length > 0 && (() => {
            const clockedInIds = new Set(clockedInEntries.map(c => c.employee_id))
            const covered = todayShifts.filter(s => clockedInIds.has(s.employee_id))
            const gaps = todayShifts.filter(s => !clockedInIds.has(s.employee_id))
            const allGood = gaps.length === 0
            return (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="section-label" style={{ marginBottom: 0 }}>Today&apos;s coverage</div>
                  <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: allGood ? '#e8f8ef' : '#fff5f5', color: allGood ? '#27ae60' : '#c0392b', border: `1px solid ${allGood ? '#c3e6cb' : '#fcd4d4'}` }}>
                    {covered.length}/{todayShifts.length} clocked in
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {todayShifts.map((s, i) => {
                    const emp = employees.find(e => e.id === s.employee_id)
                    const isClockedIn = clockedInIds.has(s.employee_id)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.75rem', borderRadius: '8px', background: isClockedIn ? '#f4fbf7' : '#fff9f9', border: `1px solid ${isClockedIn ? '#d4edda' : '#fcd4d4'}` }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: isClockedIn ? '#d4edda' : '#fcd4d4', color: isClockedIn ? '#27ae60' : '#c0392b', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {emp ? initials(emp.name) : '??'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500 }}>{emp?.name ?? 'Unknown'}</div>
                          <div style={{ fontSize: '11px', color: '#9a9a9a', marginTop: '1px' }}>
                            {formatTime(s.start_time)} – {formatTime(s.end_time)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: isClockedIn ? '#27ae60' : '#c0392b' }}>
                            {isClockedIn ? '● In' : '○ Gap'}
                          </span>
                          {!isClockedIn && emp && (
                            <button
                              onClick={() => setCalloutTarget({ shiftId: s.id, shiftDate: new Date().toISOString().slice(0, 10), startTime: s.start_time, endTime: s.end_time, employee: { id: emp.id, name: emp.name } })}
                              style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fcd4d4', background: '#fff5f5', color: '#c0392b', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
                            >
                              Find cover
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {!allGood && (
                  <div style={{ marginTop: '0.65rem', fontSize: '12px', color: '#c0392b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ⚠ {gaps.length} scheduled employee{gaps.length !== 1 ? 's' : ''} not yet clocked in
                  </div>
                )}
              </div>
            )
          })()}

          {/* Upcoming time off */}
          {upcomingTimeOff.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>Upcoming time off</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {upcomingTimeOff.map(req => {
                  const emp = employees.find(e => e.id === req.employee_id)
                  const start = fmtShortDate(req.start_date)
                  const end = fmtShortDate(req.end_date)
                  const range = start === end ? start : `${start} – ${end}`
                  return (
                    <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: '#fafafa', border: '1px solid #eee' }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e8edf8', color: '#185fa5', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {emp ? initials(emp.name) : '??'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{emp?.name || 'Employee'}</div>
                        <div style={{ fontSize: '12px', color: '#9a9a9a', marginTop: '2px' }}>{req.type} · {range}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
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
        onCalloutMarked={(id) => {
          setTodayShifts(prev => prev.map(s => s.id === id ? { ...s, status: 'called_out' } : s))
          setCalloutTarget(null)
        }}
      />
    )}

    {showAnnouncementModal && (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setShowAnnouncementModal(false)}
      >
        <div
          style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', width: '460px', maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>Send announcement</div>
            <button onClick={() => setShowAnnouncementModal(false)} style={{ fontSize: '22px', lineHeight: 1, color: '#9a9a9a', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
          <AnnouncementForm />
        </div>
      </div>
    )}
    </>
  )
}
