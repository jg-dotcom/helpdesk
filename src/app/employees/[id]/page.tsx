'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import ComplianceChecklist from '../../components/ComplianceChecklist'
import PayrollTab from '../../components/PayrollTab'
import { useToast } from '../../components/Toast'
import Nav from '../../components/Nav'

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
  direct_deposit_status: string
  pay_type: string
  pay_rate: number | null
  pay_period: string
  // JAY-13
  work_auth_expires_on: string | null
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

type CheckinNote = {
  id: number
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

const DEFAULT_OFFBOARDING_ITEMS = [
  'Keys / access cards returned',
  'Equipment returned (uniform, devices, tools)',
  'System access revoked (email, POS, software)',
  'Final paycheck processed',
  'Unused PTO paid out (if applicable)',
  'Exit interview completed',
]

// JAY-47 — parses a saved offboarding `documents.content` blob (written by
// buildOffboardingContent below) back into structured state, so an
// in-progress checklist survives reopening this page instead of resetting
// to the org template every time.
function parseOffboardingDoc(content: string, templateItems: string[]) {
  let lastDay = ''
  let reason = 'Resignation'
  let notes = ''
  let checklistLine = ''
  for (const line of content.split('\n')) {
    if (line.startsWith('Last day: ')) lastDay = line.slice('Last day: '.length).trim()
    else if (line.startsWith('Reason: ')) reason = line.slice('Reason: '.length).trim()
    else if (line.startsWith('Checklist: ')) checklistLine = line.slice('Checklist: '.length).trim()
    else if (line.startsWith('Notes: ')) notes = line.slice('Notes: '.length).trim()
  }
  if (lastDay === 'Not set') lastDay = ''

  let items = templateItems
  let checked = templateItems.map(() => false)
  if (checklistLine) {
    const parts = checklistLine.split(', ')
      .map(p => {
        const idx = p.lastIndexOf(': ')
        return idx === -1 ? null : { label: p.slice(0, idx), done: p.slice(idx + 2).trim() === '✓' }
      })
      .filter((p): p is { label: string; done: boolean } => p !== null && p.label.length > 0)
    if (parts.length) {
      items = parts.map(p => p.label)
      checked = parts.map(p => p.done)
    }
  }
  return { lastDay, reason, notes, items, checked }
}

function buildOffboardingContent(lastDay: string, reason: string, checklistItems: string[], checked: boolean[], notes: string) {
  return `Last day: ${lastDay || 'Not set'}\nReason: ${reason}\nChecklist: ${checklistItems.map((label, i) => `${label}: ${checked[i] ? '✓' : '✗'}`).join(', ')}\nNotes: ${notes}`
}

export default function EmployeeProfile() {
  const { showToast } = useToast()
  const { id } = useParams()
  const router = useRouter()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'info' | 'documents' | 'activity' | 'payroll' | 'notes' | 'onboarding' | 'offboarding'>('info')
  const [welcomePackSent, setWelcomePackSent] = useState(false)
  const [documentsSigned, setDocumentsSigned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Employee | null>(null)

  // Notes tab state
  const [checkinNotes, setCheckinNotes] = useState<CheckinNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  // Onboarding tab state
  const [empEmail, setEmpEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [resendingInvite, setResendingInvite] = useState(false)

  // Offboarding tab state
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('Resignation')
  const [offboardingNotes, setOffboardingNotes] = useState('')
  const [checklistItems, setChecklistItems] = useState<string[]>(DEFAULT_OFFBOARDING_ITEMS)
  const [checked, setChecked] = useState<boolean[]>([])
  const [offboardingSaving, setOffboardingSaving] = useState(false)
  const [offboardingDone, setOffboardingDone] = useState(false)
  const [offboardingDocId, setOffboardingDocId] = useState<number | null>(null)
  // JAY-148 — future shifts still assigned to this employee, surfaced before
  // termination so the owner doesn't discover an unstaffed shift later.
  const [upcomingShifts, setUpcomingShifts] = useState<{ id: number; shift_date: string }[]>([])
  const [unassignShiftsOnTerminate, setUnassignShiftsOnTerminate] = useState(false)

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
    setEmpEmail(emp.email || '')

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

    loadNotes(emp.name)
    loadOffboardingTemplate(emp, session.user.id)
    loadUpcomingShifts(emp.id)

    setLoading(false)
  }

  async function loadNotes(employeeName: string) {
    setNotesLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('id, content, created_at')
      .eq('employee_name', employeeName)
      .eq('type', 'checkin')
      .order('created_at', { ascending: false })
    if (data) setCheckinNotes(data)
    setNotesLoading(false)
  }

  async function addNote() {
    if (!noteText.trim() || !employee) return
    setNoteSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('documents').insert([{
      type: 'checkin',
      employee_name: employee.name,
      content: noteText.trim(),
      user_id: session?.user.id,
    }])
    if (error) {
      showToast("Couldn't save this note. Check your connection and try again.", 'error')
    } else {
      setNoteText('')
      loadNotes(employee.name)
    }
    setNoteSaving(false)
  }

  // JAY-47 — restores an in-progress offboarding checklist (from a prior
  // "Terminate now" or "Complete & terminate") instead of resetting to the
  // org template every time this page loads.
  async function loadOffboardingTemplate(emp: Employee, userId: string) {
    const { data } = await supabase
      .from('onboarding_templates')
      .select('offboarding_template, offboarding_checklist')
      .eq('user_id', userId)
      .single()
    const templateItems = data?.offboarding_checklist?.length ? data.offboarding_checklist : DEFAULT_OFFBOARDING_ITEMS

    const { data: existingDocs } = await supabase
      .from('documents')
      .select('id, content')
      .eq('type', 'offboarding')
      .eq('employee_name', emp.name)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingDocs?.[0]) {
      const parsed = parseOffboardingDoc(existingDocs[0].content, templateItems)
      setOffboardingDocId(existingDocs[0].id)
      setLastDay(parsed.lastDay)
      setReason(parsed.reason)
      setOffboardingNotes(parsed.notes)
      setChecklistItems(parsed.items)
      setChecked(parsed.checked)
      return
    }

    setOffboardingDocId(null)
    if (data?.offboarding_template) setOffboardingNotes(data.offboarding_template)
    setChecklistItems(templateItems)
    setChecked(new Array(templateItems.length).fill(false))
  }

  // JAY-148 — assigned (non-open) shifts this employee is on for today or
  // later, so the offboarding tab can warn before those shifts go unstaffed.
  async function loadUpcomingShifts(employeeId: number) {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('shifts')
      .select('id, shift_date')
      .eq('employee_id', employeeId)
      .eq('is_open_shift', false)
      .gte('shift_date', today)
      .order('shift_date', { ascending: true })
    setUpcomingShifts(data ?? [])
  }

  function set(field: keyof Employee, value: string) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  async function save() {
    if (!form) return
    setSaving(true)
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
      // JAY-13 — kept in sync here too since ComplianceChecklist's own save
      // writes directly to the DB; this just keeps the whitelist consistent
      // if the value is ever edited through this page's form instead.
      work_auth_expires_on: form.work_auth_expires_on || null,
    }).eq('id', form.id)

    if (error) {
      showToast("Couldn't save changes. Check your connection and try again.", 'error')
    } else {
      setEmployee(form)
      showToast('Saved.', 'success')
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

  async function sendWelcomePack() {
    if (!employee) return
    setSending(true)
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) { showToast('Not signed in.', 'error'); setSending(false); return }
    const res = await fetch('/api/onboarding-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ employeeId: employee.id, employeeName: employee.name, employeeEmail: empEmail.trim() || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      showToast(data.error || 'Could not create link.', 'error')
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

  async function resendPortalInvite() {
    if (!employee) return
    if (!employee.email) { showToast('Employee has no email on file.', 'error'); return }
    setResendingInvite(true)
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) { showToast('Not signed in.', 'error'); setResendingInvite(false); return }
    const res = await fetch('/api/employee/portal-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ employeeId: employee.id }),
    })
    const data = await res.json()
    if (!res.ok) {
      showToast(data.error || 'Could not send invite.', 'error')
    } else {
      showToast('Portal invite sent.', 'success')
    }
    setResendingInvite(false)
  }

  function applyPlaceholders(text: string, day: string, rsn: string) {
    if (!employee) return text
    return text
      .replace(/\{\{employee_name\}\}/g, employee.name)
      .replace(/\{\{lastDay\}\}/g, day || '[last day]')
      .replace(/\{\{reason\}\}/g, rsn)
      .replace(/\{\{role\}\}/g, employee.role || '')
  }

  function handleLastDayChange(val: string) {
    setLastDay(val)
    setOffboardingNotes(prev => applyPlaceholders(prev, val, reason))
  }

  function handleReasonChange(val: string) {
    setReason(val)
    setOffboardingNotes(prev => applyPlaceholders(prev, lastDay, val))
  }

  // JAY-47 — shared save: insert the offboarding `documents` row the first
  // time, update the same row on every subsequent save (from "Terminate now"
  // continuing the checklist later, or "Mark done" on a single item) instead
  // of inserting a new write-once row each time.
  async function saveOffboardingDoc(checklistState: boolean[], notesText: string) {
    if (!employee) return
    const { data: sessionData } = await supabase.auth.getSession()
    const content = buildOffboardingContent(lastDay, reason, checklistItems, checklistState, notesText)
    if (offboardingDocId) {
      await supabase.from('documents').update({ content }).eq('id', offboardingDocId)
    } else {
      const { data } = await supabase.from('documents').insert([{
        type: 'offboarding',
        employee_name: employee.name,
        content,
        user_id: sessionData.session?.user.id,
      }]).select('id').single()
      if (data?.id) setOffboardingDocId(data.id)
    }
  }

  // JAY-148 — opens up this employee's remaining upcoming shifts for someone
  // else to claim, instead of leaving them assigned to a terminated employee.
  async function unassignUpcomingShifts() {
    if (upcomingShifts.length === 0) return
    await supabase.from('shifts').update({ employee_id: null, is_open_shift: true }).in('id', upcomingShifts.map(s => s.id))
    setUpcomingShifts([])
  }

  async function completeOffboarding() {
    if (!employee || !form) return
    setOffboardingSaving(true)
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    if (unassignShiftsOnTerminate) await unassignUpcomingShifts()
    await saveOffboardingDoc(checked, offboardingNotes)
    setEmployee({ ...employee, status: 'terminated' })
    setForm({ ...form, status: 'terminated' })
    setOffboardingSaving(false)
    setOffboardingDone(true)
  }

  // JAY-47 — terminate immediately without claiming the checklist is done.
  // Access revocation (status flip) shouldn't wait on equipment/badge returns
  // that can take days; the checklist stays open and editable afterward.
  async function terminateNow() {
    if (!employee || !form) return
    setOffboardingSaving(true)
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    if (unassignShiftsOnTerminate) await unassignUpcomingShifts()
    await saveOffboardingDoc(checked, offboardingNotes)
    setEmployee({ ...employee, status: 'terminated' })
    setForm({ ...form, status: 'terminated' })
    setOffboardingSaving(false)
  }

  async function markOffboardingItemDone(i: number) {
    const next = [...checked]
    next[i] = true
    setChecked(next)
    await saveOffboardingDoc(next, offboardingNotes)
  }

  if (loading) return (
    <div className="dash-wrap">
      <Nav active="dashboard" />
      <div className="dash-content"><div className="loading-state">Loading...</div></div>
    </div>
  )

  if (!employee || !form) return null

  return (
    <div className="dash-wrap">
      <Nav active="dashboard" />

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
          {(['info', 'notes', 'documents', 'activity', 'payroll', 'onboarding', 'offboarding'] as const).map(t => (
            <button
              key={t}
              className={`profile-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'info' ? 'Info'
                : t === 'notes' ? `Notes (${checkinNotes.length})`
                : t === 'documents' ? `Documents (${docs.length})`
                : t === 'activity' ? `Activity (${activity.length})`
                : t === 'payroll' ? 'Payroll'
                : t === 'onboarding' ? 'Onboarding'
                : 'Offboarding'}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="profile-card">
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
              directDepositStatus={form.direct_deposit_status || 'pending'}
              welcomePackSent={welcomePackSent}
              documentsSigned={documentsSigned}
              onUpdate={(field, value) => set(field as keyof Employee, value)}
              workAuthExpiresOn={form.work_auth_expires_on}
              onUpdateExpiration={value => set('work_auth_expires_on', value ?? '')}
            />

            <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="profile-card">
            {docs.length === 0 ? (
              <div className="empty-state">No documents uploaded yet — upload files from the Documents tab or ask them to sign via their onboarding link.</div>
            ) : (
              <div className="upload-list">
                {docs.map(doc => (
                  <div key={doc.id} className="upload-item">
                    <div className="upload-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></div>
                    <div style={{ flex: 1 }}>
                      <div className="upload-name">{doc.file_name}</div>
                      <div className="upload-meta">{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</div>
                    </div>
                    <button className="doc-btn" onClick={() => handleDownload(doc)}>Download</button>
                    <button className="doc-btn" style={{ color: 'var(--error)' }} onClick={() => handleDeleteDoc(doc)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div className="profile-card">
            {activity.length === 0 ? (
              <div className="empty-state">No documents generated yet. Onboarding, check-in, and offboarding documents will appear here once created.</div>
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

        {tab === 'notes' && (
          <div className="profile-card">
            <div className="emp-panel-section">Add a note</div>
            <div className="field">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Write a quick note about this employee..." />
            </div>
            <button className="btn auth-btn-primary" onClick={addNote} disabled={!noteText.trim() || noteSaving} style={{ width: 'auto', marginBottom: '1.5rem' }}>
              {noteSaving ? 'Saving...' : 'Save note'}
            </button>

            <div className="emp-panel-section">Notes</div>
            {notesLoading ? (
              <div className="empty-state">Loading...</div>
            ) : checkinNotes.length === 0 ? (
              <div className="empty-state">No notes yet. Add one above.</div>
            ) : (
              <div>
                {checkinNotes.map(note => (
                  <div key={note.id} className="history-item" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="hist-meta">
                        {formatDate(note.created_at)} · {new Date(note.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: '0.35rem' }}>{note.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'onboarding' && (
          <div className="profile-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div className="emp-panel-section" style={{ margin: 0 }}>Onboarding checklist</div>
              <span className={`badge ${documentsSigned ? 'badge-green' : welcomePackSent ? 'badge-yellow' : 'badge-red'}`}>
                {documentsSigned ? '2/2 done' : welcomePackSent ? '1/2 done' : '0/2 done'}
              </span>
            </div>
            <div className="compliance-list" style={{ marginBottom: '1.25rem' }}>
              {[
                { label: 'Setup link sent to employee', done: welcomePackSent },
                { label: 'Onboarding documents signed', done: documentsSigned },
              ].map(item => (
                <div key={item.label} className="compliance-item">
                  <div className={`compliance-check${item.done ? ' checked' : ''}`}>
                    {item.done && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                    )}
                  </div>
                  <div className="compliance-label">{item.label}</div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
              Send {employee.name} a setup link — they&apos;ll create their account and be prompted to complete onboarding from the portal.
            </p>
            {!linkUrl ? (
              <>
                <div className="field">
                  <label>Employee email (optional — leave blank to just get a link)</label>
                  <input type="email" value={empEmail} onChange={e => setEmpEmail(e.target.value)} placeholder="jane@example.com" />
                </div>
                <button className="btn auth-btn-primary" style={{ width: 'auto' }} onClick={sendWelcomePack} disabled={sending}>
                  {sending ? 'Sending...' : 'Initiate employee'}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600, marginBottom: '0.75rem' }}>✓ Setup link sent{empEmail ? ` to ${empEmail}` : ''}.</div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>Onboarding link (fallback — share if email didn&apos;t arrive):</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input readOnly value={linkUrl} onFocus={e => e.target.select()} style={{ flex: 1 }} />
                  <button className="btn" style={{ width: 'auto' }} onClick={copyLink}>{linkCopied ? '✓ Copied' : 'Copy link'}</button>
                </div>
              </>
            )}

            <div className="emp-panel-section">Portal invite</div>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>
              Sends a fresh sign-in link to {employee.email || 'their email'}.
            </p>
            <button className="btn" style={{ width: 'auto' }} onClick={resendPortalInvite} disabled={resendingInvite || !employee.email}>
              {resendingInvite ? 'Sending...' : 'Resend portal invite'}
            </button>
          </div>
        )}

        {tab === 'offboarding' && (() => {
          // JAY-47 — data-driven so this survives reopening the page later, not
          // just the immediate post-click session state.
          const isTerminated = employee.status === 'terminated'
          const allChecklistDone = checklistItems.length > 0 && checked.length === checklistItems.length && checked.every(Boolean)
          const showComplete = offboardingDone || (isTerminated && allChecklistDone)
          const showInProgress = isTerminated && !showComplete
          const remainingItems = checklistItems.map((label, i) => ({ label, i })).filter(item => !checked[item.i])

          return (
            <div className="profile-card">
              {showComplete ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '0.5rem' }}>✓</div>
                  <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '0.4rem' }}>Offboarding complete</div>
                  <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{employee.name} has been marked as terminated.</p>
                </div>
              ) : showInProgress ? (
                <div>
                  <div style={{ textAlign: 'center', padding: '1rem 0 1.25rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '0.3rem', color: 'var(--amber)' }}>Offboarding in progress — access revoked</div>
                    <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{employee.name} was terminated. {remainingItems.length} item{remainingItems.length !== 1 ? 's' : ''} still open.</p>
                  </div>
                  <div className="compliance-list">
                    {remainingItems.map(({ label, i }) => (
                      <div key={i} className="compliance-item" style={{ justifyContent: 'space-between' }}>
                        <div className="compliance-label">{label}</div>
                        <button
                          className="doc-btn"
                          style={{ color: 'var(--success)', flexShrink: 0 }}
                          onClick={() => markOffboardingItemDone(i)}
                        >
                          Mark done
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="row2">
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

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div className="emp-panel-section" style={{ margin: 0 }}>Checklist</div>
                    <span className={`badge ${checked.filter(Boolean).length === checklistItems.length ? 'badge-green' : checked.some(Boolean) ? 'badge-yellow' : 'badge-red'}`}>
                      {checked.filter(Boolean).length}/{checklistItems.length} done
                    </span>
                  </div>
                  <div className="compliance-list" style={{ marginBottom: '1.25rem' }}>
                    {checklistItems.map((label, i) => (
                      <div
                        key={i}
                        className="compliance-item clickable"
                        onClick={() => setChecked(prev => { const next = [...prev]; next[i] = !next[i]; return next })}
                      >
                        <div className={`compliance-check${checked[i] ? ' checked' : ''}`}>
                          {checked[i] && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20,6 9,17 4,12" />
                            </svg>
                          )}
                        </div>
                        <div className="compliance-label" style={{ textDecoration: checked[i] ? 'line-through' : 'none' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="field">
                    <label>Notes</label>
                    <textarea value={offboardingNotes} onChange={e => setOffboardingNotes(e.target.value)} placeholder="Any additional notes..." />
                  </div>

                  {upcomingShifts.length > 0 && (
                    <div style={{ marginBottom: '1rem', padding: '10px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--amber)', marginBottom: '4px' }}>
                        {upcomingShifts.length} upcoming shift{upcomingShifts.length !== 1 ? 's' : ''} still assigned to {employee.name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                        {upcomingShifts.slice(0, 3).map(s => formatDate(s.shift_date)).join(', ')}{upcomingShifts.length > 3 ? `, +${upcomingShifts.length - 3} more` : ''}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginBottom: '4px' }}>
                        <input type="checkbox" checked={unassignShiftsOnTerminate} onChange={e => setUnassignShiftsOnTerminate(e.target.checked)} style={{ width: 'auto' }} />
                        Unassign these shifts now (opens them for someone else to pick up)
                      </label>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="doc-btn"
                      style={{ color: 'var(--error)', flex: 1, textAlign: 'center' }}
                      onClick={terminateNow}
                      disabled={offboardingSaving}
                      title="Terminate immediately and keep tracking the rest of the checklist afterward"
                    >
                      {offboardingSaving ? 'Saving...' : 'Terminate now'}
                    </button>
                    <button
                      className="btn"
                      style={{ flex: 1, background: 'var(--error)', color: 'var(--accent-text)', border: 'none' }}
                      onClick={completeOffboarding}
                      disabled={offboardingSaving}
                    >
                      {offboardingSaving ? 'Saving...' : 'Complete & terminate'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
