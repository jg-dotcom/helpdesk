'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee } from '../page'
import { PaperclipIcon, DollarIcon, MailIcon } from './Icons'

type Props = {
  employee: Employee
  initialTab?: Tab
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

type Tab = 'info' | 'onboarding' | 'offboarding' | 'documents' | 'payroll'

type PayrollEntry = {
  id: number
  period_start: string
  period_end: string
  hours_worked: number | null
  gross_pay: number
  notes: string | null
  paid_at: string
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type EmployeeForm = {
  id: number
  form_type: string
  form_data: Record<string, string>
  submitted_at: string
  created_at: string
}

type EmployeeDoc = {
  id: number
  file_name: string
  file_path: string
  file_size: number
  created_at: string
}

type DocSignature = {
  id: number
  file_name: string
  signed_name: string
  signed_at: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFormType(t: string) {
  if (t === 'w4') return 'W-4'
  if (t === 'i9') return 'I-9'
  if (t === 'direct_deposit') return 'Direct deposit'
  return t
}

function formatKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

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

  // Documents tab state
  const [employeeForms, setEmployeeForms] = useState<EmployeeForm[]>([])
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDoc[]>([])
  const [expandedForm, setExpandedForm] = useState<number | null>(null)
  const [docSignatures, setDocSignatures] = useState<DocSignature[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  // Payroll tab state
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([])
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [payHours, setPayHours] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payPeriodStart, setPayPeriodStart] = useState('')
  const [payPeriodEnd, setPayPeriodEnd] = useState('')
  const [payShowForm, setPayShowForm] = useState(false)
  const [paySaving, setPaySaving] = useState(false)
  const [payMsg, setPayMsg] = useState('')

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
    loadDocuments()
    loadPayroll()
    const today = new Date()
    const dayOfWeek = today.getDay()
    const start = new Date(today); start.setDate(today.getDate() - dayOfWeek)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    setPayPeriodStart(start.toISOString().slice(0, 10))
    setPayPeriodEnd(end.toISOString().slice(0, 10))
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

  async function loadDocuments() {
    setDocsLoading(true)
    const [{ data: forms }, { data: docs }, { data: sigs }] = await Promise.all([
      supabase.from('employee_forms').select('*').eq('employee_id', employee.id).order('created_at', { ascending: true }),
      supabase.from('employee_documents').select('*').eq('employee_id', employee.id).order('created_at', { ascending: false }),
      supabase.from('document_signatures').select('*').eq('employee_id', employee.id).order('signed_at', { ascending: false }),
    ])
    if (forms) setEmployeeForms(forms)
    if (docs) setEmployeeDocs(docs)
    if (sigs) setDocSignatures(sigs)
    setDocsLoading(false)
  }

  async function loadPayroll() {
    setPayrollLoading(true)
    const { data } = await supabase
      .from('payroll_entries')
      .select('*')
      .eq('employee_id', employee.id)
      .order('period_start', { ascending: false })
    if (data) setPayrollEntries(data)
    setPayrollLoading(false)
  }

  async function logPayment() {
    if (!employee.pay_rate) { setPayMsg('Set a pay rate on the employee first.'); return }
    if (employee.pay_type !== 'salary' && !payHours) { setPayMsg('Enter hours worked.'); return }
    if (!payPeriodStart || !payPeriodEnd) { setPayMsg('Enter period start and end dates.'); return }
    setPaySaving(true)
    setPayMsg('')
    const { data: sessionData } = await supabase.auth.getSession()
    const gross = employee.pay_type === 'salary'
      ? (employee.pay_rate ?? 0) / 26
      : parseFloat(payHours) * (employee.pay_rate ?? 0)
    const { error } = await supabase.from('payroll_entries').insert([{
      user_id: sessionData.session?.user.id,
      employee_id: employee.id,
      period_start: payPeriodStart,
      period_end: payPeriodEnd,
      hours_worked: employee.pay_type !== 'salary' ? parseFloat(payHours) : null,
      gross_pay: gross,
      notes: payNotes.trim() || null,
    }])
    if (error) {
      setPayMsg('Error saving.')
    } else {
      setPayMsg('Saved.')
      setPayShowForm(false)
      setPayHours('')
      setPayNotes('')
      loadPayroll()
      setTimeout(() => setPayMsg(''), 2000)
    }
    setPaySaving(false)
  }

  async function downloadFile(filePath: string, fileName: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(filePath, 3600)
    if (data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = fileName
      a.target = '_blank'
      a.click()
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
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'documents', label: 'Documents' },
    { key: 'payroll', label: 'Payroll' },
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
                {sending ? 'Sending...' : <><MailIcon size={14} /> Send welcome pack</>}
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

      {/* Documents tab */}
      {tab === 'documents' && (
        <div>
          {docsLoading ? (
            <div style={{ fontSize: '13px', color: '#999' }}>Loading...</div>
          ) : (
            <>
              <div className="emp-panel-section">Submitted forms</div>
              {employeeForms.length === 0 ? (
                <div className="empty-state" style={{ marginBottom: '1.25rem' }}>No forms submitted yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
                  {employeeForms.map(f => (
                    <div key={f.id}>
                      <div
                        onClick={() => setExpandedForm(expandedForm === f.id ? null : f.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '8px 10px', borderRadius: '8px',
                          background: expandedForm === f.id ? '#f0f4fb' : '#fafafa',
                          border: `1px solid ${expandedForm === f.id ? '#c2d4f0' : '#eee'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '6px', background: '#e6f1fb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '12px', color: '#185fa5', fontWeight: 600 }}>
                            {formatFormType(f.form_type).slice(0, 2)}
                          </span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500 }}>{formatFormType(f.form_type)}</div>
                          <div style={{ fontSize: '11px', color: '#9a9a9a' }}>
                            Submitted {new Date(f.submitted_at || f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                        <span style={{ fontSize: '12px', color: '#185fa5' }}>{expandedForm === f.id ? '▲ Hide' : '▼ View'}</span>
                      </div>
                      {expandedForm === f.id && (
                        <div style={{ background: '#f8fafd', border: '1px solid #c2d4f0', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '10px 12px' }}>
                          {Object.entries(f.form_data).map(([k, v]) => v ? (
                            <div key={k} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid #eef2f8' }}>
                              <span style={{ color: '#9a9a9a', minWidth: '120px', flexShrink: 0 }}>{formatKey(k)}</span>
                              <span style={{ color: '#1a1a1a', wordBreak: 'break-word' }}>{String(v)}</span>
                            </div>
                          ) : null)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {docSignatures.length > 0 && (
                <>
                  <div className="emp-panel-section">Signed documents</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
                    {docSignatures.map(sig => (
                      <div key={sig.id} style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 10px', borderRadius: '8px',
                        background: '#f0faf4', border: '1px solid #c3e6cb',
                      }}>
                        <div style={{ width: 28, height: 28, borderRadius: '6px', background: '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '13px', color: '#27ae60', fontWeight: 700 }}>
                          ✓
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sig.file_name}</div>
                          <div style={{ fontSize: '11px', color: '#9a9a9a' }}>
                            Signed as <span style={{ fontStyle: 'italic', color: '#555' }}>{sig.signed_name}</span> · {new Date(sig.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 500, color: '#27ae60', flexShrink: 0 }}>Signed</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="emp-panel-section">Uploaded files</div>
              {employeeDocs.length === 0 ? (
                <div className="empty-state">No files uploaded yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {employeeDocs.map(doc => (
                    <div key={doc.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 10px', borderRadius: '8px',
                      background: '#fafafa', border: '1px solid #eee',
                    }}>
                      <div style={{ width: 28, height: 28, borderRadius: '6px', background: '#f0faf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <PaperclipIcon size={14} color="#27ae60" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                        <div style={{ fontSize: '11px', color: '#9a9a9a' }}>
                          {formatSize(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                      <button
                        onClick={() => downloadFile(doc.file_path, doc.file_name)}
                        style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #185fa5', background: 'transparent', color: '#185fa5', cursor: 'pointer', flexShrink: 0 }}
                      >
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Payroll tab */}
      {tab === 'payroll' && (
        <div>
          {/* Pay summary */}
          <div className="emp-panel-section">Pay settings</div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '120px', background: '#f5f6fa', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '2px' }}>Pay type</div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{employee.pay_type === 'salary' ? 'Salary' : 'Hourly'}</div>
            </div>
            <div style={{ flex: 1, minWidth: '120px', background: '#f5f6fa', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '2px' }}>Rate</div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>
                {employee.pay_rate ? formatMoney(employee.pay_rate) : '—'}{employee.pay_type === 'salary' ? '/yr' : '/hr'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: '120px', background: '#f5f6fa', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '2px' }}>Period</div>
              <div style={{ fontSize: '14px', fontWeight: 600, textTransform: 'capitalize' }}>{employee.pay_period || 'Biweekly'}</div>
            </div>
          </div>

          {/* History header + log button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div className="emp-panel-section" style={{ margin: 0 }}>Payment history</div>
            <button
              className="btn"
              style={{ fontSize: '12px', padding: '4px 12px' }}
              onClick={() => { setPayShowForm(v => !v); setPayMsg('') }}
            >
              {payShowForm ? 'Cancel' : '+ Log payment'}
            </button>
          </div>

          {/* Log payment form */}
          {payShowForm && (
            <div style={{ background: '#f5f6fa', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
              <div className="row2" style={{ marginBottom: '0.75rem' }}>
                <div className="field">
                  <label>Period start</label>
                  <input type="date" value={payPeriodStart} onChange={e => setPayPeriodStart(e.target.value)} />
                </div>
                <div className="field">
                  <label>Period end</label>
                  <input type="date" value={payPeriodEnd} onChange={e => setPayPeriodEnd(e.target.value)} />
                </div>
              </div>
              {employee.pay_type !== 'salary' && (
                <div className="field" style={{ marginBottom: '0.75rem' }}>
                  <label>Hours worked</label>
                  <input type="number" value={payHours} onChange={e => setPayHours(e.target.value)} placeholder="80" step="0.5" />
                </div>
              )}
              {employee.pay_rate && (employee.pay_type === 'salary' || payHours) ? (
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#185fa5', marginBottom: '0.75rem' }}>
                  Gross: {formatMoney(
                    employee.pay_type === 'salary'
                      ? (employee.pay_rate ?? 0) / 26
                      : parseFloat(payHours || '0') * (employee.pay_rate ?? 0)
                  )}
                </div>
              ) : null}
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Notes (optional)</label>
                <input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="e.g. included overtime" />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px' }} onClick={logPayment} disabled={paySaving}>
                  {paySaving ? 'Saving...' : 'Save'}
                </button>
                {payMsg && <div className="done-msg">{payMsg}</div>}
              </div>
            </div>
          )}

          {/* History list */}
          {payrollLoading ? (
            <div style={{ fontSize: '13px', color: '#999' }}>Loading...</div>
          ) : payrollEntries.length === 0 ? (
            <div className="empty-state">No payments logged yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {payrollEntries.map(entry => (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 10px', borderRadius: '8px',
                  background: '#fafafa', border: '1px solid #eee',
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: '6px', background: '#e6f1fb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '13px' }}>
                    <DollarIcon size={14} color="#185fa5" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9a9a9a' }}>
                      {entry.hours_worked != null ? `${entry.hours_worked} hrs · ` : ''}
                      Paid {formatDate(entry.paid_at)}
                      {entry.notes ? ` · ${entry.notes}` : ''}
                    </div>
                  </div>
                  <span style={{ fontWeight: 600, color: '#185fa5', fontSize: '13px', flexShrink: 0 }}>
                    {formatMoney(entry.gross_pay)}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: '12px', color: '#666', padding: '6px 2px', fontWeight: 500 }}>
                Total paid: {formatMoney(payrollEntries.reduce((s, e) => s + e.gross_pay, 0))}
              </div>
            </div>
          )}
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
