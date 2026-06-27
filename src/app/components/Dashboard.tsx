'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'

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
  onSelectEmp: (emp: Employee) => void
  onAddEmployee: (emp: Omit<Employee, 'id'>) => void
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
  employees, selectedEmp, docsGenerated, loading,
  onSelectEmp, onAddEmployee, onDeleteEmployee, onStartAction, onLogout
}: Props) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newType, setNewType] = useState('Full-time')
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadRecentDocs()
  }, [docsGenerated])

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
    })
    setNewName(''); setNewRole(''); setNewStart(''); setNewType('Full-time')
    setShowAddForm(false)
    setSaving(false)
  }

  function handleAction(type: ActionType) {
    if (!selectedEmp) {
      alert('Select an employee first by clicking their card.')
      return
    }
    onStartAction(type)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">help<span>desk</span></div>
        <button className="btn-ghost" onClick={onLogout}>Sign out</button>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-n">{loading ? '–' : employees.length}</div>
          <div className="stat-l">Employees</div>
        </div>
        <div className="stat">
          <div className="stat-n">{loading ? '–' : docsGenerated}</div>
          <div className="stat-l">Docs generated</div>
        </div>
        <div className="stat">
          <div className="stat-n">$39</div>
          <div className="stat-l">/ month</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="section-label">Your team</div>
          <button className="btn-ghost" onClick={() => setShowAddForm(v => !v)}>
            + Add employee
          </button>
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
            {employees.map(emp => (
              <div
                key={emp.id}
                className={`emp-card${selectedEmp?.id === emp.id ? ' selected' : ''}`}
                onClick={() => onSelectEmp(emp)}
              >
                <div className="emp-card-top">
                  <div className="avatar">{initials(emp.name)}</div>
                  <button
                    className="delete-btn"
                    onClick={e => { e.stopPropagation(); onDeleteEmployee(emp.id) }}
                    title="Remove employee"
                  >×</button>
                </div>
                <div className="emp-name">{emp.name}</div>
                <div className="emp-role">{emp.role}</div>
                <div className="emp-tenure">{emp.type} · {tenure(emp.start)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="section-label" style={{ marginTop: '1.25rem' }}>What do you need?</div>
        <div className="action-grid">
          <div className="action-card" onClick={() => handleAction('onboarding')}>
            <div className="action-icon">→</div>
            <span className="action-title">Welcome pack</span>
            <small>New hire docs</small>
          </div>
          <div className="action-card" onClick={() => handleAction('checkin')}>
            <div className="action-icon">✓</div>
            <span className="action-title">Check-in</span>
            <small>Performance note</small>
          </div>
          <div className="action-card" onClick={() => handleAction('offboarding')}>
            <div className="action-icon">←</div>
            <span className="action-title">Offboarding</span>
            <small>Exit paperwork</small>
          </div>
        </div>
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
  )
}
