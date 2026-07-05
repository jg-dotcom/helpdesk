'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'
import EmployeePanel from './EmployeePanel'
import Nav from './Nav'
import { MegaphoneIcon } from './Icons'

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
  employees, selectedEmp, docsGenerated, loading,
  onSelectEmp, onAddEmployee, onUpdateEmployee, onDeleteEmployee, onStartAction
}: Props) {
  const [firstName, setFirstName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [complianceIssues, setComplianceIssues] = useState<{ name: string; missing: string[] }[]>([])
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
  }, [docsGenerated, employees])

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
    })
    setNewName(''); setNewRole(''); setNewStart(''); setNewType('Full-time')
    setNewPhone(''); setNewEmail(''); setNewAddress(''); setNewEmergencyContact('')
    setNewSsnLast4(''); setNewDob(''); setNewStatus('active')
    setShowAddForm(false)
    setSaving(false)
  }

  return (
    <div className="dash-wrap">
      <Nav active="dashboard" />

      <div className="dash-content">
        <div className="dash-greeting">
          {greeting()}{firstName ? `, ${firstName}` : ''}!
        </div>
        {businessName && (
          <div style={{ fontSize: '14px', color: '#6b6b6b', marginTop: '2px', marginBottom: '0.25rem' }}>
            Here&apos;s how <strong>{businessName}</strong> is doing today.
          </div>
        )}

        <div className="dash-stats">
          <div className="stat">
            <div className="stat-n">{loading ? '–' : employees.filter(e => !e.status || e.status === 'active').length}</div>
            <div className="stat-l">Active employees</div>
          </div>
          <div className="stat">
            <div className="stat-n" style={{ color: complianceIssues.length > 0 ? '#c0392b' : '#27ae60' }}>
              {loading ? '–' : complianceIssues.length}
            </div>
            <div className="stat-l">Incomplete paperwork</div>
            {complianceIssues.length > 0 && (
              <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {complianceIssues.map(issue => {
                  const fullEmp = employees.find(e => e.name === issue.name)
                  return (
                    <div
                      key={issue.name}
                      onClick={() => fullEmp && (selectedEmp?.id === fullEmp.id ? onSelectEmp(null as any) : onSelectEmp(fullEmp))}
                      style={{ fontSize: '11px', color: '#c0392b', cursor: 'pointer' }}
                    >
                      {issue.name} — {issue.missing.join(', ')}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="stat">
            <div className="stat-n">{loading ? '–' : docsGenerated}</div>
            <div className="stat-l">Docs generated</div>
          </div>
        </div>

        <div className="dash-grid">
          <div className="card">
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

            {loading ? (
              <div className="loading-state">Loading your team...</div>
            ) : employees.length === 0 ? (
              <div className="empty-state">No employees yet — add your first one above.</div>
            ) : (
              <div className="emp-grid">
                {employees.filter(emp => {
                  if (!showTerminated && emp.status === 'terminated') return false
                  if (searchQuery) {
                    const q = searchQuery.toLowerCase()
                    return emp.name.toLowerCase().includes(q) || emp.role?.toLowerCase().includes(q)
                  }
                  return true
                }).map(emp => (
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
                ))}
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
                  return (
                    <div key={emp.empId} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                      padding: '0.75rem', borderRadius: '8px',
                      background: '#fafafa', border: '1px solid #eee',
                    }}>
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

          <div className="card">
            <div className="section-label">Announcements</div>
            <AnnouncementForm />
          </div>

        </div>

      </div>
    </div>
  )
}
