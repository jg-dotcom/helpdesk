'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import ComplianceChecklist from '../../components/ComplianceChecklist'
import PayrollTab from '../../components/PayrollTab'

type Employee = {
  id: number
  name: string
  role: string
  start: string
  type: string
  status: string
  phone: string
  email: string
  address: string
  emergency_contact: string
  ssn_last4: string
  date_of_birth: string
  i9_status: string
  w4_status: string
  pay_type: string
  pay_rate: number | null
  pay_period: string
}

type Doc = {
  id: number
  file_name: string
  file_size: number
  file_path: string
  created_at: string
}

type Activity = {
  id: number
  type: string
  content: string
  created_at: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function tenure(start: string) {
  const months = Math.floor((Date.now() - new Date(start).getTime()) / 2629800000)
  if (months < 1) return 'New hire'
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
  const yrs = Math.floor(months / 12)
  const mo = months % 12
  return `${yrs}yr ${mo}mo`
}

const docLabel: Record<string, string> = {
  onboarding: 'Welcome pack',
  checkin: 'Check-in note',
  offboarding: 'Offboarding plan',
}

const statusColors: Record<string, string> = {
  active: 'badge-green',
  on_leave: 'badge-yellow',
  terminated: 'badge-red',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  on_leave: 'On leave',
  terminated: 'Terminated',
}

export default function EmployeeProfile() {
  const { id } = useParams()
  const router = useRouter()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'info' | 'documents' | 'activity' | 'payroll'>('info')
  const [welcomePackSent, setWelcomePackSent] = useState(false)
  const [documentsSigned, setDocumentsSigned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState<Employee | null>(null)

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const { data: emp } = await supabase
      .from('employees')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single()

    if (!emp) { router.push('/'); return }
    setEmployee(emp)
    setForm(emp)

    const [{ data: docsData }, { data: activityData }, { data: linkData }] = await Promise.all([
      supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('documents').select('*').eq('employee_name', emp.name).order('created_at', { ascending: false }),
      supabase.from('onboarding_links').select('acknowledged_at').eq('employee_id', id).order('created_at', { ascending: false }).limit(1),
    ])

    if (linkData && linkData.length > 0) {
      setWelcomePackSent(true)
      setDocumentsSigned(!!linkData[0].acknowledged_at)
    }

    if (docsData) setDocs(docsData)
    if (activityData) setActivity(activityData)
    setLoading(false)
  }

  function set(field: keyof Employee, value: string) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  async function save() {
    if (!form) return
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase.from('employees').update({
      name: form.name,
      role: form.role,
      start: form.start,
      type: form.type,
      status: form.status,
      phone: form.phone,
      email: form.email,
      address: form.address,
      emergency_contact: form.emergency_contact,
      ssn_last4: form.ssn_last4,
      date_of_birth: form.date_of_birth,
      i9_status: form.i9_status,
      w4_status: form.w4_status,
      pay_type: form.pay_type,
      pay_rate: form.pay_rate,
      pay_period: form.pay_period,
    }).eq('id', form.id)

    if (error) {
      setSaveMsg('Error saving. Try again.')
    } else {
      setEmployee(form)
      setSaveMsg('Saved.')
      setTimeout(() => setSaveMsg(''), 2000)
    }
    setSaving(false)
  }

  async function handleDownload(doc: Doc) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleDeleteDoc(doc: Doc) {
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('employee_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  if (loading) return (
    <div className="dash-wrap">
      <div className="dash-nav"><div className="dash-nav-left"><div className="logo">help<span>desk</span></div></div></div>
      <div className="dash-content"><div className="loading-state">Loading...</div></div>
    </div>
  )

  if (!employee || !form) return null

  return (
    <div className="dash-wrap">
      <div className="dash-nav">
        <div className="dash-nav-left">
          <div className="logo">help<span>desk</span></div>
        </div>
      </div>

      <div className="dash-content">
        <button className="back-btn" onClick={() => router.push('/')}>← Back to dashboard</button>

        <div className="profile-header">
          <div className="profile-avatar">{employee.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
          <div className="profile-info">
            <div className="profile-name">{employee.name}</div>
            <div className="profile-role">{employee.role} · {employee.type}</div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center' }}>
              <span className={`badge ${statusColors[employee.status] || 'badge-green'}`}>
                {statusLabels[employee.status] || 'Active'}
              </span>
              <span className="hist-meta">Since {formatDate(employee.start)} · {tenure(employee.start)}</span>
            </div>
          </div>
        </div>

        <div className="profile-tabs">
          {(['info', 'documents', 'activity', 'payroll'] as const).map(t => (
            <button
              key={t}
              className={`profile-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'info' ? 'Info' : t === 'documents' ? `Documents (${docs.length})` : t === 'activity' ? `Activity (${activity.length})` : 'Payroll'}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="card">
            <div className="emp-panel-section">Profile</div>
            <div className="row2">
              <div className="field"><label>Name</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="field"><label>Role</label><input value={form.role} onChange={e => set('role', e.target.value)} /></div>
            </div>
            <div className="row2">
              <div className="field">
                <label>Start date</label>
                <input type="date" value={form.start} onChange={e => set('start', e.target.value)} />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={e => set('type', e.target.value)}>
                  <option>Full-time</option>
                  <option>Part-time</option>
                  <option>Seasonal</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="on_leave">On leave</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>

            <div className="emp-panel-section">Contact</div>
            <div className="row2">
              <div className="field"><label>Phone</label><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></div>
              <div className="field"><label>Email</label><input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" /></div>
            </div>
            <div className="field"><label>Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" /></div>
            <div className="field"><label>Emergency contact</label><input value={form.emergency_contact || ''} onChange={e => set('emergency_contact', e.target.value)} placeholder="Jane Doe — (555) 987-6543" /></div>

            <div className="emp-panel-section">Payroll</div>
            <div className="row2">
              <div className="field">
                <label>Pay type</label>
                <select value={form.pay_type || 'hourly'} onChange={e => set('pay_type', e.target.value)}>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                </select>
              </div>
              <div className="field">
                <label>{form.pay_type === 'salary' ? 'Annual salary ($)' : 'Hourly rate ($)'}</label>
                <input type="number" value={form.pay_rate ?? ''} onChange={e => set('pay_rate', e.target.value)} placeholder="0.00" step="0.01" />
              </div>
            </div>
            <div className="field">
              <label>Pay period</label>
              <select value={form.pay_period || 'biweekly'} onChange={e => set('pay_period', e.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semi-monthly">Semi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="emp-panel-section">HR Info</div>
            <div className="row2">
              <div className="field">
                <label>SSN (last 4)</label>
                <input value={form.ssn_last4 || ''} onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" maxLength={4} />
              </div>
              <div className="field">
                <label>Date of birth</label>
                <input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} />
              </div>
            </div>

            <ComplianceChecklist
              employeeId={form.id}
              i9Status={form.i9_status || 'pending'}
              w4Status={form.w4_status || 'pending'}
              welcomePackSent={welcomePackSent}
              documentsSigned={documentsSigned}
              onUpdate={(field, value) => set(field, value)}
            />

            <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              {saveMsg && <div className="done-msg">{saveMsg}</div>}
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="card">
            {docs.length === 0 ? (
              <div className="empty-state">No documents uploaded yet.</div>
            ) : (
              <div className="upload-list">
                {docs.map(doc => (
                  <div key={doc.id} className="upload-item">
                    <div className="upload-icon">📄</div>
                    <div style={{ flex: 1 }}>
                      <div className="upload-name">{doc.file_name}</div>
                      <div className="upload-meta">{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</div>
                    </div>
                    <button className="doc-btn" onClick={() => handleDownload(doc)}>Download</button>
                    <button className="doc-btn" style={{ color: '#c0392b' }} onClick={() => handleDeleteDoc(doc)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div className="card">
            {activity.length === 0 ? (
              <div className="empty-state">No documents generated yet.</div>
            ) : (
              activity.map(item => (
                <div key={item.id} className="history-item">
                  <div className="hist-icon">{item.type === 'onboarding' ? '→' : item.type === 'checkin' ? '✓' : '←'}</div>
                  <div style={{ flex: 1 }}>
                    <div className="hist-title">{docLabel[item.type] || item.type}</div>
                    <div className="hist-meta">{formatDate(item.created_at)}</div>
                  </div>
                  <span className="badge badge-green">Saved</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'payroll' && (
          <PayrollTab
            employeeId={employee.id}
            payType={employee.pay_type || 'hourly'}
            payRate={employee.pay_rate}
          />
        )}
      </div>
    </div>
  )
}
