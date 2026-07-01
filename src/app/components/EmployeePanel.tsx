'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee } from '../page'
import ComplianceChecklist from './ComplianceChecklist'

type Props = {
  employee: Employee
  initialTab?: 'info' | 'compliance' | 'onboarding' | 'offboarding'
  onClose: () => void
  onUpdated: (emp: Employee) => void
  onDelete: (id: number) => void
  onStartAction: (type: 'onboarding' | 'checkin' | 'offboarding') => void
}

const DEFAULT_OFFBOARDING_ITEMS = [
  'Keys / access cards returned',
  'Equipment returned (uniform, devices, tools)',
  'System access revoked (email, POS, software)',
  'Final paycheck processed',
  'Unused PTO paid out (if applicable)',
  'Exit interview completed',
]

type Tab = 'info' | 'compliance' | 'onboarding' | 'offboarding'

export default function EmployeePanel({ employee, initialTab = 'info', onClose, onUpdated, onDelete, onStartAction }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [form, setForm] = useState({ ...employee })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [welcomePackSent, setWelcomePackSent] = useState(false)
  const [documentsSigned, setDocumentsSigned] = useState(false)
  const [closing, setClosing] = useState(false)

  // Onboarding tab state
  const [empEmail, setEmpEmail] = useState(employee.email || '')
  const [sending, setSending] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [sendError, setSendError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  // Offboarding tab state
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('Resignation')
  const [notes, setNotes] = useState('')
  const [checklistItems, setChecklistItems] = useState<string[]>(DEFAULT_OFFBOARDING_ITEMS)
  const [checked, setChecked] = useState<boolean[]>([])
  const [offboardingSaving, setOffboardingSaving] = useState(false)
  const [offboardingDone, setOffboardingDone] = useState(false)

  function animateClose() {
    setClosing(true)
    setTimeout(() => onClose(), 400)
  }

  useEffect(() => {
    setForm({ ...employee })
    setEmpEmail(employee.email || '')
    setSaveMsg('')
    setTab(initialTab)
    setLinkUrl('')
    setSendError('')
    loadComplianceData()
    loadOffboardingTemplate()
  }, [employee.id])

  async function loadComplianceData() {
    const { data } = await supabase
      .from('onboarding_links')
      .select('acknowledged_at')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setWelcomePackSent(true)
      setDocumentsSigned(!!data[0].acknowledged_at)
    } else {
      setWelcomePackSent(false)
      setDocumentsSigned(false)
    }
  }

  async function loadOffboardingTemplate() {
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) return
    const { data } = await supabase
      .from('onboarding_templates')
      .select('offboarding_template, offboarding_checklist')
      .eq('user_id', sessionData.session.user.id)
      .single()
    if (data?.offboarding_template) setNotes(data.offboarding_template)
    const items = data?.offboarding_checklist?.length ? data.offboarding_checklist : DEFAULT_OFFBOARDING_ITEMS
    setChecklistItems(items)
    setChecked(new Array(items.length).fill(false))
  }

  function set(field: keyof Employee, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase
      .from('employees')
      .update({
        name: form.name, role: form.role, start: form.start, type: form.type,
        phone: form.phone, email: form.email, address: form.address,
        emergency_contact: form.emergency_contact, ssn_last4: form.ssn_last4,
        date_of_birth: form.date_of_birth, status: form.status,
        i9_status: form.i9_status, w4_status: form.w4_status,
        pay_type: form.pay_type, pay_rate: form.pay_rate, pay_period: form.pay_period,
      })
      .eq('id', employee.id)
    if (error) {
      setSaveMsg('Error saving. Try again.')
    } else {
      onUpdated(form)
      setTimeout(() => animateClose(), 600)
    }
    setSaving(false)
  }

  async function sendWelcomePack() {
    setSending(true)
    setSendError('')
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) { setSendError('Not signed in.'); setSending(false); return }
    const res = await fetch('/api/onboarding-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ employeeId: employee.id, employeeName: employee.name, employeeEmail: empEmail.trim() || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSendError(data.error || 'Could not create link.')
    } else {
      setLinkUrl(data.url)
      setWelcomePackSent(true)
    }
    setSending(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(linkUrl).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  function applyPlaceholders(text: string, day: string, rsn: string) {
    return text
      .replace(/\{\{employee_name\}\}/g, employee.name)
      .replace(/\{\{lastDay\}\}/g, day || '[last day]')
      .replace(/\{\{reason\}\}/g, rsn)
      .replace(/\{\{role\}\}/g, employee.role || '')
  }

  function handleLastDayChange(val: string) {
    setLastDay(val)
    setNotes(prev => applyPlaceholders(prev, val, reason))
  }

  function handleReasonChange(val: string) {
    setReason(val)
    setNotes(prev => applyPlaceholders(prev, lastDay, val))
  }

  async function completeOffboarding() {
    setOffboardingSaving(true)
    const { data: sessionData } = await supabase.auth.getSession()
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    await supabase.from('documents').insert([{
      type: 'offboarding',
      employee_name: employee.name,
      content: `Last day: ${lastDay || 'Not set'}\nReason: ${reason}\nChecklist: ${checklistItems.map((label, i) => `${label}: ${checked[i] ? '✓' : '✗'}`).join(', ')}\nNotes: ${notes}`,
      user_id: sessionData.session?.user.id,
    }])
    onUpdated({ ...form, status: 'terminated' })
    setOffboardingSaving(false)
    setOffboardingDone(true)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'offboarding', label: 'Offboarding' },
  ]

  return (
    <div className={`emp-panel${closing ? ' closing' : ''}`}>
      <div className="emp-panel-header">
        <div>
          <div className="emp-panel-name">{employee.name}</div>
          <div className="emp-panel-role">{employee.role}</div>
          <a href={`/employees/${employee.id}`} style={{ fontSize: '12px', color: '#185fa5', marginTop: '2px', display: 'inline-block' }}>View full profile →</a>
        </div>
        <button className="emp-panel-close" onClick={animateClose}>×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: '1.25rem', gap: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 14px', fontSize: '13px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: tab === t.key ? '#185fa5' : '#6b6b6b',
              borderBottom: tab === t.key ? '2px solid #185fa5' : '2px solid transparent',
              fontWeight: tab === t.key ? 600 : 400,
              marginBottom: '-1px', transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div>
          <div className="emp-panel-section">Profile</div>
          <div className="row2">
            <div className="field"><label>Name</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="field"><label>Role</label><input value={form.role} onChange={e => set('role', e.target.value)} /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Start date</label><input type="date" value={form.start} onChange={e => set('start', e.target.value)} /></div>
            <div className="field">
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option>Full-time</option><option>Part-time</option><option>Seasonal</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option><option value="on_leave">On leave</option><option value="terminated">Terminated</option>
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
                <option value="hourly">Hourly</option><option value="salary">Salary</option>
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
              <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
              <option value="semi-monthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="emp-panel-section">HR Info</div>
          <div className="row2">
            <div className="field"><label>SSN (last 4)</label><input value={form.ssn_last4 || ''} onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" maxLength={4} /></div>
            <div className="field"><label>Date of birth</label><input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} /></div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center' }}>
            <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ width: 'auto' }}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button className="delete-btn" style={{ fontSize: '13px', opacity: 1, color: '#c0392b' }} onClick={() => onDelete(employee.id)}>
              Remove employee
            </button>
            {saveMsg && <div className="done-msg">{saveMsg}</div>}
          </div>
        </div>
      )}

      {/* Compliance tab */}
      {tab === 'compliance' && (
        <ComplianceChecklist
          employeeId={employee.id}
          i9Status={form.i9_status || 'pending'}
          w4Status={form.w4_status || 'pending'}
          directDepositStatus={form.direct_deposit_status || 'pending'}
          welcomePackSent={welcomePackSent}
          documentsSigned={documentsSigned}
          onUpdate={(field, value) => {
            setForm(prev => ({ ...prev, [field]: value }))
            onUpdated({ ...form, [field]: value })
          }}
        />
      )}

      {/* Onboarding tab */}
      {tab === 'onboarding' && (
        <div>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '1rem' }}>
            Send {employee.name} a link to complete their onboarding paperwork — W-4, I-9, direct deposit, and availability.
          </p>
          {!linkUrl ? (
            <>
              <div className="field">
                <label>Employee email <span style={{ color: '#9a9a9a', fontWeight: 400 }}>(optional — leave blank to just get a link)</span></label>
                <input type="email" value={empEmail} onChange={e => setEmpEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <button className="btn auth-btn-primary" style={{ width: 'auto' }} onClick={sendWelcomePack} disabled={sending}>
                {sending ? 'Sending...' : '✉ Send welcome pack'}
              </button>
              {sendError && <div className="auth-error" style={{ marginTop: '0.5rem' }}>{sendError}</div>}
            </>
          ) : (
            <>
              <div className="done-msg" style={{ marginBottom: '0.75rem' }}>✓ Welcome pack sent{empEmail ? ` to ${empEmail}` : ''}.</div>
              <div className="share-link-row">
                <input className="share-link-input" readOnly value={linkUrl} onFocus={e => e.target.select()} />
                <button className="doc-btn" onClick={copyLink}>{linkCopied ? '✓ Copied' : 'Copy link'}</button>
              </div>
              <div style={{ fontSize: '12px', color: '#999', marginTop: '0.5rem' }}>
                Share this link with {employee.name} — no account needed.
              </div>
            </>
          )}
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
            <button className="action-card-sm" onClick={() => onStartAction('checkin')}>
              <span>✓</span> Write a check-in note
            </button>
          </div>
        </div>
      )}

      {/* Offboarding tab */}
      {tab === 'offboarding' && (
        <div>
          {offboardingDone ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '0.5rem' }}>✓</div>
              <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '0.4rem' }}>Offboarding complete</div>
              <p style={{ fontSize: '13px', color: '#666' }}>{employee.name} has been marked as terminated.</p>
            </div>
          ) : (
            <>
              <div className="row2" style={{ marginBottom: '1rem' }}>
                <div className="field">
                  <label>Last day</label>
                  <input type="date" value={lastDay} onChange={e => handleLastDayChange(e.target.value)} />
                </div>
                <div className="field">
                  <label>Reason</label>
                  <select value={reason} onChange={e => handleReasonChange(e.target.value)}>
                    <option>Resignation</option><option>Termination</option><option>Layoff</option>
                    <option>Seasonal end</option><option>Retirement</option><option>Personal reasons</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div className="emp-panel-section" style={{ margin: 0 }}>Checklist</div>
                <span className={`badge ${checked.filter(Boolean).length === checklistItems.length ? 'badge-green' : checked.some(Boolean) ? 'badge-yellow' : 'badge-red'}`}>
                  {checked.filter(Boolean).length}/{checklistItems.length} done
                </span>
              </div>

              <div className="compliance-list" style={{ marginBottom: '1rem' }}>
                {checklistItems.map((label, i) => (
                  <div
                    key={i}
                    className="compliance-item clickable"
                    onClick={() => setChecked(prev => { const next = [...prev]; next[i] = !next[i]; return next })}
                  >
                    <div className={`compliance-check${checked[i] ? ' checked' : ''}`}>
                      {checked[i] ? '✓' : ''}
                    </div>
                    <div className="compliance-label" style={{ textDecoration: checked[i] ? 'line-through' : 'none', color: checked[i] ? '#27ae60' : undefined }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="field" style={{ marginBottom: '1rem' }}>
                <label>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." style={{ minHeight: '60px' }} />
              </div>

              <button
                onClick={completeOffboarding}
                disabled={offboardingSaving}
                style={{ padding: '8px 16px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: 'auto' }}
              >
                {offboardingSaving ? 'Saving...' : 'Complete & terminate'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
