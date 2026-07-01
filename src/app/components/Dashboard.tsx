'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'
import EmployeePanel from './EmployeePanel'

type RecentDoc = {
  id: number
  type: string
  employee_name: string
  created_at: string
}

type Props = {
  employees: Employee[]
  selectedEmp: Employee | null
  docsGenerated: number
  loading: boolean
  userEmail: string
  onSelectEmp: (emp: Employee) => void
  onAddEmployee: (emp: Omit<Employee, 'id'>) => void
  onUpdateEmployee: (emp: Employee) => void
  onDeleteEmployee: (id: number) => void
  onStartAction: (type: ActionType) => void
  onLogout: () => void
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

function userInitials(email: string) {
  return email.slice(0, 2).toUpperCase()
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
        {sending ? 'Sending...' : '📣 Send to all employees'}
      </button>
      {result && <div className="done-msg" style={{ marginTop: '0.5rem' }}>{result}</div>}
    </div>
  )
}

const docIcon: Record<string, string> = {
  onboarding: '→',
  checkin: '✓',
  offboarding: '←',
}

const docLabel: Record<string, string> = {
  onboarding: 'Welcome pack',
  checkin: 'Check-in note',
  offboarding: 'Offboarding plan',
}

export default function Dashboard({
  employees, selectedEmp, docsGenerated, loading, userEmail,
  onSelectEmp, onAddEmployee, onUpdateEmployee, onDeleteEmployee, onStartAction, onLogout
}: Props) {
  const [notifications, setNotifications] = useState<{ id: number; message: string; created_at: string; read: boolean }[]>([])
  const [showNotifs, setShowNotifs] = useState(false)
  const notifsRef = useRef<HTMLDivElement>(null)
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
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([])
  const [saving, setSaving] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showTerminated, setShowTerminated] = useState(false)
  const [openTab, setOpenTab] = useState<'info' | 'compliance' | 'onboarding' | 'offboarding'>('info')
  const menuRef = useRef<HTMLDivElement>(null)

  function selectEmpOnTab(emp: Employee, tab: 'info' | 'compliance' | 'onboarding' | 'offboarding') {
    setOpenTab(tab)
    onSelectEmp(emp)
  }
  const [onboardingProgress, setOnboardingProgress] = useState<{
    empId: number; name: string; role: string; sentAt: string;
    w4: boolean; i9: boolean; deposit: boolean; agreed: boolean;
  }[]>([])

  useEffect(() => {
    loadRecentDocs()
    loadNotifications()
    loadComplianceIssues()
    loadOnboardingProgress()
  }, [docsGenerated, employees])

  async function loadNotifications() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setNotifications(data)
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
    const { data: links } = await supabase
      .from('onboarding_links')
      .select('employee_id, created_at, acknowledged_at')
      .in('employee_id', active.map(e => e.id))
      .order('created_at', { ascending: false })
    if (!links) return
    // latest link per employee
    const latestByEmp: Record<number, { created_at: string; acknowledged_at: string | null }> = {}
    links.forEach(l => { if (!latestByEmp[l.employee_id]) latestByEmp[l.employee_id] = l })
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
        agreed: !!latestByEmp[emp.id].acknowledged_at,
      }))
      .filter(e => !e.w4 || !e.i9 || !e.deposit || !e.agreed)
    setOnboardingProgress(inProgress)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (!unreadIds.length) return
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadRecentDocs() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data } = await supabase
      .from('documents')
      .select('id, type, employee_name, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(5)
    if (data) setRecentDocs(data)
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
      <div className="dash-nav">
        <div className="dash-nav-left">
          <div className="logo">help<span>desk</span></div>
          <nav className="dash-nav-links">
            <div className="dash-nav-link active">Dashboard</div>
            <a href="/payroll" className="dash-nav-link">Payroll</a>
            <a href="/schedule" className="dash-nav-link">Schedule</a>
          </nav>
        </div>
        <div className="dash-nav-right" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="notif-wrap" ref={notifsRef}>
            <button
              className="notif-bell"
              onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markAllRead() }}
            >
              🔔
              {notifications.some(n => !n.read) && (
                <span className="notif-badge">{notifications.filter(n => !n.read).length}</span>
              )}
            </button>
            {showNotifs && (
              <div className="notif-dropdown">
                <div className="notif-header">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="notif-empty">No notifications yet.</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`}>
                      <div className="notif-msg">{n.message}</div>
                      <div className="notif-time">{timeAgo(n.created_at)}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div className="user-avatar" onClick={() => setShowMenu(v => !v)}>
            {userInitials(userEmail)}
          </div>
          {showMenu && (
            <div className="user-menu">
              <div className="user-menu-header">
                <div className="user-menu-email">{userEmail}</div>
              </div>
              <div className="user-menu-items">
                <a href="/settings" className="user-menu-item">⚙ Onboarding template</a>
                <a href="/offboarding-settings" className="user-menu-item">⚙ Offboarding template</a>
                <div className="user-menu-item">💳 Billing</div>
                <div className="user-menu-divider" />
                <div className="user-menu-item user-menu-signout" onClick={onLogout}>→ Sign out</div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="dash-content">
        <div className="dash-greeting">{greeting()}</div>

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
                      onClick={() => fullEmp && (selectedEmp?.id === fullEmp.id ? onSelectEmp(null as any) : selectEmpOnTab(fullEmp, 'compliance'))}
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
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
                {employees.filter(emp => showTerminated || emp.status !== 'terminated').map(emp => (
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
              <EmployeePanel
                employee={selectedEmp}
                initialTab={openTab}
                onClose={() => { onSelectEmp(null as any); setOpenTab('info') }}
                onUpdated={onUpdateEmployee}
                onDelete={id => { onDeleteEmployee(id); onSelectEmp(null as any) }}
                onStartAction={onStartAction}
              />
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
                    { label: 'Direct deposit', done: emp.deposit },
                    { label: 'Agreement', done: emp.agreed },
                  ]
                  const doneCount = steps.filter(s => s.done).length
                  const fullEmp = employees.find(e => e.id === emp.empId)
                  return (
                    <div
                      key={emp.empId}
                      onClick={() => fullEmp && (selectedEmp?.id === emp.empId ? onSelectEmp(null as any) : selectEmpOnTab(fullEmp, 'compliance'))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', borderRadius: '8px',
                        background: selectedEmp?.id === emp.empId ? '#f0f4fb' : '#fafafa',
                        border: `1px solid ${selectedEmp?.id === emp.empId ? '#c2d4f0' : '#eee'}`,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { if (selectedEmp?.id !== emp.empId) e.currentTarget.style.background = '#f4f4f2' }}
                      onMouseLeave={e => { if (selectedEmp?.id !== emp.empId) e.currentTarget.style.background = '#fafafa' }}
                    >
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e8edf8', color: '#185fa5', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>{emp.name}</div>
                        <div style={{ display: 'flex', gap: '5px', marginTop: '4px', alignItems: 'center' }}>
                          {steps.map(s => (
                            <div key={s.label} title={s.label} style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: s.done ? '#27ae60' : '#ddd',
                              flexShrink: 0,
                            }} />
                          ))}
                          <span style={{ fontSize: '11px', color: '#9a9a9a', marginLeft: '2px' }}>
                            {doneCount}/{steps.length} done
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', color: '#9a9a9a', flexShrink: 0 }}>→</span>
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

          <div className="card">
            <div className="section-label">Recent documents</div>
            {recentDocs.length === 0 ? (
              <div className="empty-state">No documents yet — generate your first one above.</div>
            ) : (
              recentDocs.map(doc => (
                <div key={doc.id} className="history-item">
                  <div className="hist-icon">{docIcon[doc.type] || '•'}</div>
                  <div style={{ flex: 1 }}>
                    <div className="hist-title">{docLabel[doc.type] || doc.type} — {doc.employee_name}</div>
                    <div className="hist-meta">{timeAgo(doc.created_at)}</div>
                  </div>
                  <span className="badge badge-green">Saved</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
