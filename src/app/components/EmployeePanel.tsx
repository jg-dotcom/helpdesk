'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee } from '../page'
import { PaperclipIcon, DollarIcon, MailIcon } from './Icons'
import { useToast } from './Toast'

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

// JAY-47 — parses a saved offboarding `documents.content` blob (written by
// buildOffboardingContent below) back into structured state. No schema
// change: the checklist has always round-tripped through this table as
// plain text ("Label: ✓" / "Label: ✗" pairs) — this just reads it back
// instead of treating the row as write-once. If the text doesn't parse
// (unexpected format, or a hand-edited row), falls back to the org's
// default template so the tab still renders something sane.
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

type Tab = 'info' | 'onboarding' | 'offboarding' | 'documents' | 'payroll' | 'notes'

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

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

type TimelineEvent = { id: string; label: string; sub?: string; date: string; color: string }

function complianceChip(label: string, status: string) {
  const isComplete = status === 'complete' || status === 'active'
  return { label, isComplete }
}

function tenure(start: string) {
  if (!start) return null
  const months = Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 2629800000))
  if (months < 1) return 'New'
  if (months < 12) return `${months} mo`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`
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

// ── Dark-theme style constants (self-contained; this panel doesn't live inside
// a `.dash-content` wrapper, so global input/select overrides don't reach it) ──
const cardBg = 'var(--bg-elevated)'
const border = 'rgba(255,255,255,0.08)'
const muted = 'var(--text-tertiary)'
const mutedDark = 'var(--text-tertiary)'
const text = 'var(--text)'
const heading = 'var(--text)'
const accent = 'var(--accent)'
const accentFill = 'var(--accent)'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '7px',
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${border}`, color: text,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: '11px', color: muted, display: 'block', marginBottom: '5px', fontWeight: 500 }
const fieldWrap: React.CSSProperties = { marginBottom: '0.85rem' }
const row2Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }
const sectionLabelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: mutedDark, margin: '1.25rem 0 0.7rem' }
const emptyStateStyle: React.CSSProperties = { fontSize: '13px', color: mutedDark, padding: '1rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: `1px dashed ${border}` }
const primaryBtn: React.CSSProperties = { fontSize: '13px', padding: '8px 16px', borderRadius: '8px', border: 'none', background: accentFill, color: 'var(--accent-text)', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
const ghostBtn: React.CSSProperties = { fontSize: '12px', padding: '6px 12px', borderRadius: '7px', border: `1px solid ${border}`, background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
const dangerBtn: React.CSSProperties = { fontSize: '13px', padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: 'var(--error)', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
const listItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}{hint && <span style={{ color: mutedDark, fontWeight: 400 }}> {hint}</span>}</label>
      {children}
    </div>
  )
}

export default function EmployeePanel({ employee, initialTab = 'info', onClose, onUpdated, onDelete, onStartAction }: Props) {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [form, setForm] = useState({ ...employee })
  const [saving, setSaving] = useState(false)
  const [welcomePackSent, setWelcomePackSent] = useState(false)
  const [documentsSigned, setDocumentsSigned] = useState(false)
  const [closing, setClosing] = useState(false)

  // JAY-125 — "Remove employee" used to be a one-click browser confirm()
  // sitting right next to Save. Now it opens a modal requiring the admin to
  // type the employee's name before the destructive button enables, same
  // type-to-confirm pattern as Settings' delete-account flow.
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [removeConfirmText, setRemoveConfirmText] = useState('')

  // Onboarding tab state
  const [empEmail, setEmpEmail] = useState(employee.email || '')
  const [sending, setSending] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [resendingInvite, setResendingInvite] = useState(false)

  // Notes tab state
  type CheckinNote = { id: number; content: string; created_at: string }
  const [checkinNotes, setCheckinNotes] = useState<CheckinNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)

  // Documents tab state
  const [employeeForms, setEmployeeForms] = useState<EmployeeForm[]>([])
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDoc[]>([])
  const [expandedForm, setExpandedForm] = useState<number | null>(null)
  const [docSignatures, setDocSignatures] = useState<DocSignature[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  // JAY-63/64 — revealed bank fields live only in this component's memory
  // for the current session, keyed by form id; never persisted client-side.
  const [revealedFields, setRevealedFields] = useState<Record<number, Record<string, string>>>({})
  const [revealingForm, setRevealingForm] = useState<number | null>(null)

  // Payroll tab state
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([])
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [payHours, setPayHours] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payPeriodStart, setPayPeriodStart] = useState('')
  const [payPeriodEnd, setPayPeriodEnd] = useState('')
  const [payShowForm, setPayShowForm] = useState(false)
  const [paySaving, setPaySaving] = useState(false)

  // Department assignment state
  type DeptOption = { id: number; name: string; color: string }
  const [allDepts, setAllDepts] = useState<DeptOption[]>([])
  const [memberDepts, setMemberDepts] = useState<Set<number>>(new Set())
  const [primaryDept, setPrimaryDept] = useState<number | null>(null)
  const [deptsSaving, setDeptsSaving] = useState(false)

  // Offboarding tab state
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('Resignation')
  const [notes, setNotes] = useState('')
  const [checklistItems, setChecklistItems] = useState<string[]>(DEFAULT_OFFBOARDING_ITEMS)
  const [checked, setChecked] = useState<boolean[]>([])
  const [offboardingSaving, setOffboardingSaving] = useState(false)
  const [offboardingDone, setOffboardingDone] = useState(false)
  // JAY-47 — id of this employee's existing offboarding `documents` row, if
  // any, so "Terminate now" and later "Mark done" clicks update the same row
  // instead of inserting a new one each time.
  const [offboardingDocId, setOffboardingDocId] = useState<number | null>(null)

  // Inline note box state
  const [showNoteBox, setShowNoteBox] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSummary, setNoteSummary] = useState<string[]>([])
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteGenerating, setNoteGenerating] = useState(false)

  // Per-employee activity timeline (payroll, notes, time off, callouts merged)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)

  async function saveNote() {
    if (!noteText.trim()) return
    setNoteSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('documents').insert([{
      type: 'checkin',
      employee_name: employee.name,
      content: noteText.trim(),
      user_id: session?.user.id,
    }])
    setNoteSaving(false)
    setNoteSaved(true)
    loadNotes()
    setTimeout(() => { setNoteSaved(false); setShowNoteBox(false); setNoteText(''); setNoteSummary([]) }, 1500)
  }

  async function generateNote() {
    setNoteGenerating(true)
    setNoteSummary([])
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'checkin', employee, notes: noteText }),
    })
    const data = await res.json()
    try {
      const parsed = JSON.parse(data.text)
      if (parsed.summary && parsed.note) {
        setNoteSummary(parsed.summary)
        setNoteText(parsed.note)
      } else { setNoteText(data.text) }
    } catch { setNoteText(data.text) }
    setNoteGenerating(false)
    setNoteSaved(false)
  }

  function animateClose() {
    setClosing(true)
    setTimeout(() => onClose(), 400)
  }

  useEffect(() => {
    setForm({ ...employee })
    setEmpEmail(employee.email || '')
    setTab(initialTab)
    setLinkUrl('')
    loadComplianceData()
    loadOffboardingTemplate()
    loadDocuments()
    loadPayroll()
    loadNotes()
    loadDepartments()
    loadTimeline()
    const today = new Date()
    const dayOfWeek = today.getDay()
    const start = new Date(today); start.setDate(today.getDate() - dayOfWeek)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    setPayPeriodStart(start.toISOString().slice(0, 10))
    setPayPeriodEnd(end.toISOString().slice(0, 10))
  }, [employee.id])

  async function loadNotes() {
    setNotesLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('id, content, created_at')
      .eq('employee_name', employee.name)
      .eq('type', 'checkin')
      .order('created_at', { ascending: false })
    if (data) setCheckinNotes(data)
    setNotesLoading(false)
  }

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

  // JAY-64 — fire-and-forget: log that this specific form was opened. Not
  // awaited by the UI (expanding the form shouldn't wait on a network
  // round-trip), and a failure here shouldn't block the owner from actually
  // viewing the form — it only degrades the audit trail, not the feature.
  function logFormView(formId: number) {
    supabase.auth.getSession().then(({ data: sessionData }) => {
      const token = sessionData.session?.access_token
      if (!token) return
      fetch(`/api/employee-forms/${formId}/view`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    })
  }

  // JAY-63 — explicit reveal action for encrypted bank fields. Decrypted
  // values are kept only in this component's state (revealedFields), never
  // written back to employeeForms/localStorage — they disappear on refresh.
  async function revealForm(formId: number) {
    setRevealingForm(formId)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) { setRevealingForm(null); return }
    const res = await fetch(`/api/employee-forms/${formId}/reveal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { revealed } = await res.json()
      setRevealedFields(prev => ({ ...prev, [formId]: revealed }))
    } else {
      showToast('Could not reveal this field.', 'error')
    }
    setRevealingForm(null)
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
    if (!employee.pay_rate) { showToast('Set a pay rate on the employee first.', 'error'); return }
    if (employee.pay_type !== 'salary' && !payHours) { showToast('Enter hours worked.', 'error'); return }
    if (!payPeriodStart || !payPeriodEnd) { showToast('Enter period start and end dates.', 'error'); return }
    setPaySaving(true)
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
      showToast('Error saving.', 'error')
    } else {
      showToast('Saved.', 'success')
      setPayShowForm(false)
      setPayHours('')
      setPayNotes('')
      loadPayroll()
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
    const templateItems = data?.offboarding_checklist?.length ? data.offboarding_checklist : DEFAULT_OFFBOARDING_ITEMS

    // JAY-47 — if this employee already has a saved offboarding record (from a
    // prior "Terminate now" or "Complete & terminate"), restore it instead of
    // resetting to the org template, so an in-progress checklist survives
    // reopening the panel. No schema change: still the same `documents` row
    // (type='offboarding'), just made re-readable/re-editable by parsing its
    // text content back out instead of treating it as write-once.
    const { data: existingDocs } = await supabase
      .from('documents')
      .select('id, content')
      .eq('type', 'offboarding')
      .eq('employee_name', employee.name)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingDocs?.[0]) {
      const parsed = parseOffboardingDoc(existingDocs[0].content, templateItems)
      setOffboardingDocId(existingDocs[0].id)
      setLastDay(parsed.lastDay)
      setReason(parsed.reason)
      setNotes(parsed.notes)
      setChecklistItems(parsed.items)
      setChecked(parsed.checked)
      return
    }

    setOffboardingDocId(null)
    if (data?.offboarding_template) setNotes(data.offboarding_template)
    const items = templateItems
    setChecklistItems(items)
    setChecked(new Array(items.length).fill(false))
  }

  async function loadDepartments() {
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) return
    const [{ data: depts }, { data: members }] = await Promise.all([
      supabase.from('departments').select('id, name, color').eq('user_id', sessionData.session.user.id).order('name'),
      supabase.from('department_members').select('department_id, is_primary').eq('employee_id', employee.id),
    ])
    if (depts) setAllDepts(depts)
    if (members) {
      setMemberDepts(new Set(members.map((m: { department_id: number }) => m.department_id)))
      const primary = members.find((m: { is_primary: boolean }) => m.is_primary)
      setPrimaryDept(primary?.department_id ?? null)
    }
  }

  // Per-employee timeline — merges payroll, notes, time off, and callouts scoped
  // to this one person, the way BambooHR/Rippling surface a per-employee history
  // instead of making you dig through separate module pages.
  async function loadTimeline() {
    setTimelineLoading(true)
    const { data: sessionData } = await supabase.auth.getSession()
    const uid = sessionData.session?.user.id
    if (!uid) { setTimelineLoading(false); return }

    const [{ data: pay }, { data: notesData }, { data: pto }, { data: callouts }] = await Promise.all([
      supabase.from('payroll_entries').select('id, gross_pay, period_start, period_end, paid_at').eq('employee_id', employee.id).order('paid_at', { ascending: false }).limit(5),
      supabase.from('documents').select('id, content, created_at').eq('employee_name', employee.name).eq('type', 'checkin').order('created_at', { ascending: false }).limit(5),
      supabase.from('time_off_requests').select('id, type, status, start_date, end_date, created_at').eq('employee_id', employee.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('shifts').select('id, shift_date, status').eq('employee_id', employee.id).eq('status', 'called_out').order('shift_date', { ascending: false }).limit(5),
    ])

    const events: TimelineEvent[] = []
    for (const p of pay ?? []) {
      events.push({ id: `pay_${p.id}`, label: `Paid ${formatMoney(p.gross_pay)}`, sub: `${formatDate(p.period_start)} – ${formatDate(p.period_end)}`, date: p.paid_at ?? p.period_end, color: accent })
    }
    for (const n of notesData ?? []) {
      events.push({ id: `note_${n.id}`, label: 'Check-in note added', sub: n.content.length > 60 ? n.content.slice(0, 60) + '…' : n.content, date: n.created_at, color: 'var(--accent)' })
    }
    for (const r of pto ?? []) {
      events.push({ id: `pto_${r.id}`, label: `${r.type} request ${r.status}`, sub: `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`, date: r.created_at, color: r.status === 'approved' ? 'var(--success)' : r.status === 'denied' ? 'var(--error)' : 'var(--amber)' })
    }
    for (const c of callouts ?? []) {
      events.push({ id: `callout_${c.id}`, label: 'Called out', sub: formatDate(c.shift_date), date: c.shift_date, color: 'var(--error)' })
    }

    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    setTimeline(events.slice(0, 6))
    setTimelineLoading(false)
  }

  async function saveDepartments() {
    setDeptsSaving(true)
    // Delete all existing memberships for this employee
    await supabase.from('department_members').delete().eq('employee_id', employee.id)
    // Re-insert current selections
    if (memberDepts.size > 0) {
      const rows = Array.from(memberDepts).map(deptId => ({
        employee_id: employee.id,
        department_id: deptId,
        is_primary: deptId === primaryDept,
      }))
      await supabase.from('department_members').insert(rows)
    }
    setDeptsSaving(false)
  }

  function set(field: keyof Employee, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    setSaving(true)
    // JAY-51 — capture whether pay rate/type is actually changing before the
    // update overwrites the old value, so payroll can later split a pay
    // period across the old and new rate instead of applying today's rate
    // to the whole period.
    const rateChanged = form.pay_rate != null && form.pay_rate !== employee.pay_rate
    const typeChanged = form.pay_type != null && form.pay_type !== employee.pay_type
    const { error } = await supabase
      .from('employees')
      .update({
        name: form.name, role: form.role, start: form.start, type: form.type,
        phone: form.phone, email: form.email, address: form.address,
        emergency_contact: form.emergency_contact, ssn_last4: form.ssn_last4,
        date_of_birth: form.date_of_birth, status: form.status,
        i9_status: form.i9_status, w4_status: form.w4_status,
        pay_type: form.pay_type, pay_rate: form.pay_rate, pay_period: form.pay_period,
        access_role: form.access_role ?? 'employee',
      })
      .eq('id', employee.id)
    if (error) {
      showToast('Error saving. Try again.', 'error')
    } else {
      if ((rateChanged || typeChanged) && form.pay_rate != null) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await supabase.from('pay_rate_history').insert({
            user_id: session.user.id,
            employee_id: employee.id,
            pay_rate: form.pay_rate,
            pay_type: form.pay_type ?? employee.pay_type,
            effective_from: new Date().toISOString().slice(0, 10),
          })
        }
      }
      onUpdated(form)
      setTimeout(() => animateClose(), 600)
    }
    setSaving(false)
  }


  async function sendWelcomePack() {
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

  // JAY-47 — shared save: insert the offboarding `documents` row the first
  // time, update the same row on every subsequent save (from "Terminate now"
  // continuing the checklist later, or "Mark done" on a single item) instead
  // of inserting a new write-once row each time.
  async function saveOffboardingDoc(checklistState: boolean[], notesText: string) {
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

  async function completeOffboarding() {
    setOffboardingSaving(true)
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    await saveOffboardingDoc(checked, notes)
    onUpdated({ ...form, status: 'terminated' })
    setOffboardingSaving(false)
    setOffboardingDone(true)
  }

  // JAY-47 — terminate immediately without claiming the checklist is done.
  // Access revocation (status flip) shouldn't wait on equipment/badge returns
  // that can take days; the checklist stays open and editable afterward via
  // the "in progress" view below instead of being forced to false-check boxes
  // or forced to delay termination.
  async function terminateNow() {
    setOffboardingSaving(true)
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    await saveOffboardingDoc(checked, notes)
    onUpdated({ ...form, status: 'terminated' })
    setOffboardingSaving(false)
    // Deliberately not setting offboardingDone — the checklist may still have
    // unchecked items; the data-driven isTerminated/allChecked check below
    // decides whether to show "complete" or "in progress" from here on.
  }

  async function markOffboardingItemDone(i: number) {
    const next = [...checked]
    next[i] = true
    setChecked(next)
    await saveOffboardingDoc(next, notes)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'notes', label: checkinNotes.length > 0 ? `Notes (${checkinNotes.length})` : 'Notes' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'documents', label: 'Documents' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'offboarding', label: 'Offboarding' },
  ]

  const primaryDeptInfo = allDepts.find(d => d.id === primaryDept)
  const statusInfo = employee.status === 'terminated'
    ? { label: 'Terminated', color: 'var(--error)', bg: 'rgba(239,68,68,0.15)' }
    : employee.status === 'on_leave'
    ? { label: 'On leave', color: 'var(--amber)', bg: 'rgba(245,158,11,0.15)' }
    : { label: 'Active', color: 'var(--success)', bg: 'rgba(34,197,94,0.15)' }

  return (
    <>
    <div className={`emp-panel-dark${closing ? ' closing' : ''}`} style={{
      background: cardBg, border: `1px solid ${border}`, borderRadius: '12px',
      padding: '1.5rem', transition: 'opacity 0.4s ease, transform 0.4s ease',
      opacity: closing ? 0 : 1, transform: closing ? 'translateY(-8px)' : 'translateY(0)',
    }}>
      {/* ── Header: avatar, name, status, at-a-glance facts ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(29,78,216,0.18)', color: accent, fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(employee.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: heading }}>{employee.name}</div>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: statusInfo.bg, color: statusInfo.color, letterSpacing: '0.03em' }}>{statusInfo.label.toUpperCase()}</span>
              {employee.access_role === 'manager' && (
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: 'rgba(192,132,252,0.15)', color: 'var(--accent)', letterSpacing: '0.04em' }}>MANAGER</span>
              )}
            </div>
            <div style={{ fontSize: '13px', color: muted, marginTop: '2px' }}>{employee.role}</div>

            {/* Quick facts row — tenure / department at a glance, no tab click needed.
                Pay dropped from here: it's one click away on the Payroll tab, and
                repeating it in the compact header just eats space we'd rather spend
                on exceptions. */}
            <div style={{ display: 'flex', gap: '14px', marginTop: '8px', flexWrap: 'wrap' }}>
              {employee.start && (
                <div style={{ fontSize: '12px', color: muted }}>
                  <span style={{ color: mutedDark }}>Tenure</span> <span style={{ color: text, fontWeight: 500 }}>{tenure(employee.start)}</span>
                </div>
              )}
              {primaryDeptInfo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: primaryDeptInfo.color }} />
                  <span style={{ fontSize: '12px', color: text, fontWeight: 500 }}>{primaryDeptInfo.name}</span>
                </div>
              )}
            </div>

            {/* Compliance status — exception-based: only take up header space when
                something actually needs attention. When everything's in order this
                collapses to a single quiet checkmark instead of three permanent
                "all good" chips, so the header stays useful for the exceptional case
                rather than confirming the common case every time. */}
            {(() => {
              const items = [
                complianceChip('I-9', employee.i9_status),
                complianceChip('W-4', employee.w4_status),
                complianceChip('Direct deposit', employee.direct_deposit_status),
              ]
              const missing = items.filter(c => !c.isComplete)
              const onboardingIncomplete = welcomePackSent && !documentsSigned
              // JAY-13 — the ticket's own mockup calls this out at the Employee
              // panel level, not just the full detail page; the editable date
              // input lives on the full profile (below), this is read-only.
              const workAuthDays = employee.work_auth_expires_on
                ? Math.ceil((new Date(employee.work_auth_expires_on + 'T00:00:00').getTime() - Date.now()) / 86400000)
                : null
              const workAuthExpiringSoon = workAuthDays !== null && workAuthDays <= 90
              if (missing.length === 0 && !onboardingIncomplete && !workAuthExpiringSoon) {
                return (
                  <div style={{ marginTop: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: 'rgba(34,197,94,0.1)', color: 'var(--success)' }}>
                      ✓ Compliant
                    </span>
                  </div>
                )
              }
              return (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {missing.map(c => (
                    <span key={c.label} style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: 'rgba(245,158,11,0.15)', color: 'var(--amber)' }}>
                      ⚠ {c.label} missing
                    </span>
                  ))}
                  {onboardingIncomplete && (
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: 'rgba(59,130,246,0.13)', color: accent }}>
                      • Onboarding docs unsigned
                    </span>
                  )}
                  {workAuthExpiringSoon && (
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: 'rgba(220,38,38,0.15)', color: 'var(--error)' }}>
                      ⚠ Work auth {workAuthDays! < 0 ? 'expired' : `expires in ${workAuthDays}d`}
                    </span>
                  )}
                </div>
              )
            })()}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
              <a href={`/employees/${employee.id}`} style={{ fontSize: '12px', color: accent, textDecoration: 'none' }}>View full profile →</a>
              <button
                onClick={() => { setShowNoteBox(v => !v); setNoteSaved(false) }}
                style={{ fontSize: '11px', color: showNoteBox ? accent : mutedDark, background: showNoteBox ? 'rgba(29,78,216,0.15)' : 'transparent', border: `1px solid ${showNoteBox ? 'rgba(29,78,216,0.3)' : border}`, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', fontWeight: 500 }}
              >
                ✎ Note
              </button>
            </div>
          </div>
        </div>
        <button onClick={animateClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: mutedDark, cursor: 'pointer', lineHeight: 1, padding: '0 0 0 8px', flexShrink: 0 }}>×</button>
      </div>

      {showNoteBox && (
        <div style={{ marginBottom: '1rem', padding: '0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: `1px solid ${border}` }}>
          {noteSummary.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {noteSummary.map(tag => (
                <span key={tag} style={{ fontSize: '11px', padding: '2px 9px', borderRadius: '20px', background: 'rgba(29,78,216,0.15)', color: accent, fontWeight: 500 }}>{tag}</span>
              ))}
            </div>
          )}
          <textarea
            value={noteText}
            onChange={e => { setNoteText(e.target.value); setNoteSaved(false) }}
            placeholder="Write a quick note about this employee, or add your observations and hit Generate..."
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={saveNote}
              disabled={!noteText.trim() || noteSaving || noteSaved}
              style={{ ...primaryBtn, fontSize: '12px', padding: '6px 12px', background: noteSaved ? 'var(--success)' : accentFill, opacity: (!noteText.trim() || noteSaving) ? 0.5 : 1 }}
            >
              {noteSaving ? 'Saving...' : noteSaved ? '✓ Saved' : 'Save note'}
            </button>
            <button
              onClick={generateNote}
              disabled={noteGenerating}
              style={{ ...ghostBtn, color: accent, borderColor: 'rgba(29,78,216,0.3)' }}
            >
              {noteGenerating ? 'Generating...' : '✦ Generate with AI'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, marginBottom: '1.25rem', gap: '2px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px', fontSize: '13px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: tab === t.key ? accent : muted,
              borderBottom: tab === t.key ? `2px solid ${accentFill}` : '2px solid transparent',
              fontWeight: tab === t.key ? 600 : 400,
              marginBottom: '-1px', transition: 'color 0.15s', fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div>
          {(timelineLoading || timeline.length > 0) && (
            <>
              <div style={{ ...sectionLabelStyle, marginTop: 0 }}>Recent activity</div>
              {timelineLoading ? (
                <div style={{ fontSize: '13px', color: mutedDark, marginBottom: '1rem' }}>Loading...</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '1.25rem' }}>
                  {timeline.map((ev, i) => (
                    <div key={ev.id} style={{ display: 'flex', gap: '10px', paddingBottom: i === timeline.length - 1 ? 0 : '10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: ev.color, marginTop: '4px' }} />
                        {i < timeline.length - 1 && <div style={{ width: 1, flex: 1, background: border, marginTop: '4px' }} />}
                      </div>
                      <div style={{ paddingBottom: '2px' }}>
                        <div style={{ fontSize: '12.5px', color: text, fontWeight: 500 }}>{ev.label}</div>
                        <div style={{ fontSize: '11px', color: mutedDark, marginTop: '1px' }}>
                          {ev.sub ? `${ev.sub} · ` : ''}{new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={sectionLabelStyle}>Profile</div>
          <div style={row2Style}>
            <Field label="Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Role"><input style={inputStyle} value={form.role} onChange={e => set('role', e.target.value)} /></Field>
          </div>
          <div style={row2Style}>
            <Field label="Start date"><input type="date" style={inputStyle} value={form.start} onChange={e => set('start', e.target.value)} /></Field>
            <Field label="Type">
              <select style={inputStyle} value={form.type} onChange={e => set('type', e.target.value)}>
                <option>Full-time</option><option>Part-time</option><option>Seasonal</option>
              </select>
            </Field>
          </div>
          <Field label="Status">
            <select style={inputStyle} value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option><option value="on_leave">On leave</option><option value="terminated">Terminated</option>
            </select>
          </Field>

          <div style={sectionLabelStyle}>Contact</div>
          <div style={row2Style}>
            <Field label="Phone"><input style={inputStyle} value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" /></Field>
            <Field label="Email"><input type="email" style={inputStyle} value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" /></Field>
          </div>
          <Field label="Address"><input style={inputStyle} value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" /></Field>
          <Field label="Emergency contact"><input style={inputStyle} value={form.emergency_contact || ''} onChange={e => set('emergency_contact', e.target.value)} placeholder="Jane Doe — (555) 987-6543" /></Field>

          <div style={sectionLabelStyle}>Payroll</div>
          <div style={row2Style}>
            <Field label="Pay type">
              <select style={inputStyle} value={form.pay_type || 'hourly'} onChange={e => set('pay_type', e.target.value)}>
                <option value="hourly">Hourly</option><option value="salary">Salary</option>
              </select>
            </Field>
            <Field label={form.pay_type === 'salary' ? 'Annual salary ($)' : 'Hourly rate ($)'}>
              <input type="number" style={inputStyle} value={form.pay_rate ?? ''} onChange={e => set('pay_rate', e.target.value)} placeholder="0.00" step="0.01" />
            </Field>
          </div>
          <Field label="Pay period">
            <select style={inputStyle} value={form.pay_period || 'biweekly'} onChange={e => set('pay_period', e.target.value)}>
              <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
              <option value="semi-monthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </Field>

          <div style={sectionLabelStyle}>HR Info</div>
          <div style={row2Style}>
            <Field label="SSN (last 4)"><input style={inputStyle} value={form.ssn_last4 || ''} onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" maxLength={4} /></Field>
            <Field label="Date of birth"><input type="date" style={inputStyle} value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} /></Field>
          </div>

          {allDepts.length > 0 && (
            <>
              <div style={sectionLabelStyle}>Departments</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.6rem' }}>
                {allDepts.map(dept => {
                  const isMember = memberDepts.has(dept.id)
                  return (
                    <label key={dept.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: 8, background: isMember ? 'rgba(29,78,216,0.1)' : 'transparent', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={isMember} onChange={() => {
                        setMemberDepts(prev => {
                          const next = new Set(prev)
                          if (next.has(dept.id)) { next.delete(dept.id); if (primaryDept === dept.id) setPrimaryDept(null) }
                          else next.add(dept.id)
                          return next
                        })
                      }} style={{ width: 14, height: 14, flexShrink: 0 }} />
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: dept.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', flex: 1, color: text }}>{dept.name}</span>
                      {isMember && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: muted, cursor: 'pointer' }}>
                          <input type="radio" name="primary_dept" checked={primaryDept === dept.id} onChange={() => setPrimaryDept(dept.id)} style={{ width: 12, height: 12 }} />
                          Primary
                        </label>
                      )}
                    </label>
                  )
                })}
              </div>
              <button onClick={saveDepartments} disabled={deptsSaving} style={{ ...ghostBtn, marginBottom: '0.6rem' }}>
                {deptsSaving ? 'Saving...' : 'Save departments'}
              </button>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center' }}>
            <button onClick={save} disabled={saving} style={primaryBtn}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button style={dangerBtn} onClick={() => { setRemoveConfirmText(''); setShowRemoveConfirm(true) }}>
              Remove employee
            </button>
          </div>

        </div>
      )}

      {/* Onboarding tab */}
      {tab === 'onboarding' && (
        <div>
          {/* Onboarding checklist — parity with the Offboarding tab's checklist,
              reflecting real signed-document state instead of a plain sentence */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ ...sectionLabelStyle, margin: 0 }}>Onboarding checklist</div>
            <span style={{
              fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '99px',
              background: documentsSigned ? 'rgba(34,197,94,0.15)' : welcomePackSent ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
              color: documentsSigned ? 'var(--success)' : welcomePackSent ? 'var(--amber)' : 'var(--error)',
            }}>
              {documentsSigned ? '2/2 done' : welcomePackSent ? '1/2 done' : '0/2 done'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '1.25rem' }}>
            {[
              { label: 'Setup link sent to employee', done: welcomePackSent },
              { label: 'Onboarding documents signed', done: documentsSigned },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '5px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px',
                  background: item.done ? 'rgba(34,197,94,0.2)' : 'transparent', border: `1.5px solid ${item.done ? 'var(--success)' : border}`, color: 'var(--success)',
                }}>
                  {item.done ? '✓' : ''}
                </div>
                <div style={{ fontSize: '13px', color: item.done ? 'var(--success)' : text }}>{item.label}</div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '13px', color: muted, marginBottom: '1rem' }}>
            Send {employee.name} a setup link — they&apos;ll create their account and be prompted to complete onboarding from the portal.
          </p>
          {!linkUrl ? (
            <>
              <Field label="Employee email" hint="(optional — leave blank to just get a link)">
                <input type="email" style={inputStyle} value={empEmail} onChange={e => setEmpEmail(e.target.value)} placeholder="jane@example.com" />
              </Field>
              <button style={primaryBtn} onClick={sendWelcomePack} disabled={sending}>
                {sending ? 'Sending...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><MailIcon size={14} /> Initiate employee</span>}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600, marginBottom: '0.75rem' }}>✓ Setup link sent{empEmail ? ` to ${empEmail}` : ''}.</div>
              <div style={{ fontSize: '12px', color: muted, marginBottom: '0.5rem' }}>Onboarding link (fallback — share if email didn&apos;t arrive):</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input readOnly value={linkUrl} onFocus={e => e.target.select()} style={{ ...inputStyle, flex: 1 }} />
                <button style={ghostBtn} onClick={copyLink}>{linkCopied ? '✓ Copied' : 'Copy link'}</button>
              </div>
            </>
          )}

          <div style={sectionLabelStyle}>Portal invite</div>
          <p style={{ fontSize: '13px', color: muted, marginBottom: '0.75rem' }}>
            Sends a fresh sign-in link to {employee.email || 'their email'}.
          </p>
          <button style={ghostBtn} onClick={resendPortalInvite} disabled={resendingInvite || !employee.email}>
            {resendingInvite ? 'Sending...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><MailIcon size={14} /> Resend portal invite</span>}
          </button>

        </div>
      )}

      {/* Documents tab */}
      {tab === 'documents' && (
        <div>
          {docsLoading ? (
            <div style={{ fontSize: '13px', color: mutedDark }}>Loading...</div>
          ) : (
            <>
              <div style={sectionLabelStyle}>Submitted forms</div>
              {employeeForms.length === 0 ? (
                <div style={{ ...emptyStateStyle, marginBottom: '1.25rem' }}>No forms submitted yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
                  {employeeForms.map(f => (
                    <div key={f.id}>
                      <div
                        onClick={() => {
                          const opening = expandedForm !== f.id
                          setExpandedForm(opening ? f.id : null)
                          if (opening) logFormView(f.id) // JAY-64
                        }}
                        style={{
                          ...listItemStyle, cursor: 'pointer',
                          background: expandedForm === f.id ? 'rgba(29,78,216,0.1)' : 'rgba(255,255,255,0.03)',
                          borderColor: expandedForm === f.id ? 'rgba(29,78,216,0.3)' : border,
                        }}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'rgba(29,78,216,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '12px', color: accent, fontWeight: 600 }}>
                            {formatFormType(f.form_type).slice(0, 2)}
                          </span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: text }}>{formatFormType(f.form_type)}</div>
                          <div style={{ fontSize: '11px', color: mutedDark }}>
                            Submitted {new Date(f.submitted_at || f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                        <span style={{ fontSize: '12px', color: accent }}>{expandedForm === f.id ? '▲ Hide' : '▼ View'}</span>
                      </div>
                      {expandedForm === f.id && (
                        <div style={{ background: 'rgba(29,78,216,0.05)', border: '1px solid rgba(29,78,216,0.2)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '10px 12px' }}>
                          {/* JAY-63 — routingNumber/accountNumber are stored as
                              `${field}_encrypted` + `${field}_last4` pairs, never
                              plaintext. Render those as a single masked row with
                              an explicit, logged Reveal action instead of two raw
                              key/value rows. Every other field (bankName, I-9/W-4
                              fields, etc.) renders exactly as before. */}
                          {(() => {
                            const entries = Object.entries(f.form_data)
                            const encryptedFieldNames = entries
                              .map(([k]) => k)
                              .filter(k => k.endsWith('_encrypted'))
                              .map(k => k.replace(/_encrypted$/, ''))
                            const rows: React.ReactNode[] = []
                            for (const [k, v] of entries) {
                              if (k.endsWith('_encrypted') || k.endsWith('_last4')) continue
                              if (!v) continue
                              rows.push(
                                <div key={k} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '4px 0', borderBottom: `1px solid ${border}` }}>
                                  <span style={{ color: mutedDark, minWidth: '120px', flexShrink: 0 }}>{formatKey(k)}</span>
                                  <span style={{ color: text, wordBreak: 'break-word' }}>{String(v)}</span>
                                </div>
                              )
                            }
                            for (const field of encryptedFieldNames) {
                              const revealedValue = revealedFields[f.id]?.[field]
                              const maskedLast4 = f.form_data[`${field}_last4`]
                              rows.push(
                                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px 0', borderBottom: `1px solid ${border}` }}>
                                  <span style={{ color: mutedDark, minWidth: '120px', flexShrink: 0 }}>{formatKey(field)}</span>
                                  <span style={{ color: text, wordBreak: 'break-word', fontFamily: 'monospace' }}>
                                    {revealedValue ?? `${'•'.repeat(Math.max(5, 9 - 4))}${maskedLast4 ?? ''}`}
                                  </span>
                                  {!revealedValue && (
                                    <button
                                      onClick={e => { e.stopPropagation(); revealForm(f.id) }}
                                      disabled={revealingForm === f.id}
                                      style={{ fontSize: '11px', color: accent, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}
                                    >
                                      {revealingForm === f.id ? 'Revealing…' : 'Reveal full number'}
                                    </button>
                                  )}
                                </div>
                              )
                            }
                            return rows
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {docSignatures.length > 0 && (
                <>
                  <div style={sectionLabelStyle}>Signed documents</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem' }}>
                    {docSignatures.map(sig => (
                      <div key={sig.id} style={{ ...listItemStyle, background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'rgba(34,197,94,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '13px', color: 'var(--success)', fontWeight: 700 }}>
                          ✓
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sig.file_name}</div>
                          <div style={{ fontSize: '11px', color: mutedDark }}>
                            Signed as <span style={{ fontStyle: 'italic', color: muted }}>{sig.signed_name}</span> · {new Date(sig.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--success)', flexShrink: 0 }}>Signed</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={sectionLabelStyle}>Uploaded files</div>
              {employeeDocs.length === 0 ? (
                <div style={emptyStateStyle}>No files uploaded yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {employeeDocs.map(doc => (
                    <div key={doc.id} style={listItemStyle}>
                      <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'rgba(34,197,94,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <PaperclipIcon size={14} color="var(--success)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                        <div style={{ fontSize: '11px', color: mutedDark }}>
                          {formatSize(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                      <button
                        onClick={() => downloadFile(doc.file_path, doc.file_name)}
                        style={{ ...ghostBtn, color: accent, borderColor: 'rgba(29,78,216,0.3)', flexShrink: 0 }}
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
          <div style={sectionLabelStyle}>Pay settings</div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '120px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: mutedDark, marginBottom: '2px' }}>Pay type</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: text }}>{employee.pay_type === 'salary' ? 'Salary' : 'Hourly'}</div>
            </div>
            <div style={{ flex: 1, minWidth: '120px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: mutedDark, marginBottom: '2px' }}>Rate</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: text }}>
                {employee.pay_rate ? formatMoney(employee.pay_rate) : '—'}{employee.pay_type === 'salary' ? '/yr' : '/hr'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: '120px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', color: mutedDark, marginBottom: '2px' }}>Period</div>
              <div style={{ fontSize: '14px', fontWeight: 600, textTransform: 'capitalize', color: text }}>{employee.pay_period || 'Biweekly'}</div>
            </div>
          </div>

          {/* History header + log button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ ...sectionLabelStyle, margin: 0 }}>Payment history</div>
            <button style={ghostBtn} onClick={() => setPayShowForm(v => !v)}>
              {payShowForm ? 'Cancel' : '+ Log payment'}
            </button>
          </div>

          {/* Log payment form */}
          {payShowForm && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
              <div style={row2Style}>
                <Field label="Period start"><input type="date" style={inputStyle} value={payPeriodStart} onChange={e => setPayPeriodStart(e.target.value)} /></Field>
                <Field label="Period end"><input type="date" style={inputStyle} value={payPeriodEnd} onChange={e => setPayPeriodEnd(e.target.value)} /></Field>
              </div>
              {employee.pay_type !== 'salary' && (
                <Field label="Hours worked"><input type="number" style={inputStyle} value={payHours} onChange={e => setPayHours(e.target.value)} placeholder="80" step="0.5" /></Field>
              )}
              {employee.pay_rate && (employee.pay_type === 'salary' || payHours) ? (
                <div style={{ fontSize: '13px', fontWeight: 600, color: accent, marginBottom: '0.85rem' }}>
                  Gross: {formatMoney(
                    employee.pay_type === 'salary'
                      ? (employee.pay_rate ?? 0) / 26
                      : parseFloat(payHours || '0') * (employee.pay_rate ?? 0)
                  )}
                </div>
              ) : null}
              <Field label="Notes (optional)"><input style={inputStyle} value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="e.g. included overtime" /></Field>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button style={primaryBtn} onClick={logPayment} disabled={paySaving}>
                  {paySaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* History list */}
          {payrollLoading ? (
            <div style={{ fontSize: '13px', color: mutedDark }}>Loading...</div>
          ) : payrollEntries.length === 0 ? (
            <div style={emptyStateStyle}>No payments logged yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {payrollEntries.map(entry => (
                <div key={entry.id} style={listItemStyle}>
                  <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'rgba(29,78,216,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '13px' }}>
                    <DollarIcon size={14} color={accent} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: text }}>
                      {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                    </div>
                    <div style={{ fontSize: '11px', color: mutedDark }}>
                      {entry.hours_worked != null ? `${entry.hours_worked} hrs · ` : ''}
                      Paid {formatDate(entry.paid_at)}
                      {entry.notes ? ` · ${entry.notes}` : ''}
                    </div>
                  </div>
                  <span style={{ fontWeight: 600, color: accent, fontSize: '13px', flexShrink: 0 }}>
                    {formatMoney(entry.gross_pay)}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: '12px', color: muted, padding: '6px 2px', fontWeight: 500 }}>
                Total paid: {formatMoney(payrollEntries.reduce((s, e) => s + e.gross_pay, 0))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notes tab */}
      {tab === 'notes' && (
        <div>
          {notesLoading ? (
            <div style={{ fontSize: '13px', color: mutedDark }}>Loading...</div>
          ) : checkinNotes.length === 0 ? (
            <div style={emptyStateStyle}>
              No notes yet. Use the ✎ Note button above to write one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {checkinNotes.map(note => (
                <div key={note.id} style={{ padding: '0.875rem 1rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }}>
                  <div style={{ fontSize: '11px', color: mutedDark, marginBottom: '0.5rem', fontWeight: 500 }}>
                    {new Date(note.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    <span style={{ marginLeft: '6px' }}>
                      · {new Date(note.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{note.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Offboarding tab */}
      {tab === 'offboarding' && (() => {
        // JAY-47 — data-driven so this survives reopening the panel later, not
        // just the immediate post-click session state.
        const isTerminated = employee.status === 'terminated'
        const allChecklistDone = checklistItems.length > 0 && checked.length === checklistItems.length && checked.every(Boolean)
        const showComplete = offboardingDone || (isTerminated && allChecklistDone)
        const showInProgress = isTerminated && !showComplete
        const remainingItems = checklistItems.map((label, i) => ({ label, i })).filter(item => !checked[item.i])

        return (
          <div>
            {showComplete ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ fontSize: '36px', marginBottom: '0.5rem' }}>✓</div>
                <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '0.4rem', color: heading }}>Offboarding complete</div>
                <p style={{ fontSize: '13px', color: muted }}>{employee.name} has been marked as terminated.</p>
              </div>
            ) : showInProgress ? (
              <div>
                <div style={{ textAlign: 'center', padding: '1rem 0 1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '0.3rem', color: 'var(--amber)' }}>Offboarding in progress — access revoked</div>
                  <p style={{ fontSize: '13px', color: muted }}>{employee.name} was terminated. {remainingItems.length} item{remainingItems.length !== 1 ? 's' : ''} still open.</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {remainingItems.map(({ label, i }) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }}>
                      <div style={{ fontSize: '13px', color: text }}>{label}</div>
                      <button
                        onClick={() => markOffboardingItemDone(i)}
                        style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${border}`, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                      >
                        Mark done
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div style={{ ...row2Style, marginBottom: '1rem' }}>
                  <Field label="Last day"><input type="date" style={inputStyle} value={lastDay} onChange={e => handleLastDayChange(e.target.value)} /></Field>
                  <Field label="Reason">
                    <select style={inputStyle} value={reason} onChange={e => handleReasonChange(e.target.value)}>
                      <option>Resignation</option><option>Termination</option><option>Layoff</option>
                      <option>Seasonal end</option><option>Retirement</option><option>Personal reasons</option>
                    </select>
                  </Field>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ ...sectionLabelStyle, margin: 0 }}>Checklist</div>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '99px',
                    background: checked.filter(Boolean).length === checklistItems.length ? 'rgba(34,197,94,0.15)' : checked.some(Boolean) ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                    color: checked.filter(Boolean).length === checklistItems.length ? 'var(--success)' : checked.some(Boolean) ? 'var(--amber)' : 'var(--error)',
                  }}>
                    {checked.filter(Boolean).length}/{checklistItems.length} done
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '1rem' }}>
                  {checklistItems.map((label, i) => (
                    <div
                      key={i}
                      onClick={() => setChecked(prev => { const next = [...prev]; next[i] = !next[i]; return next })}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: '5px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px',
                        background: checked[i] ? 'rgba(34,197,94,0.2)' : 'transparent', border: `1.5px solid ${checked[i] ? 'var(--success)' : border}`, color: 'var(--success)',
                      }}>
                        {checked[i] ? '✓' : ''}
                      </div>
                      <div style={{ fontSize: '13px', textDecoration: checked[i] ? 'line-through' : 'none', color: checked[i] ? 'var(--success)' : text }}>
                        {label}
                      </div>
                    </div>
                  ))}
                </div>

                <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." /></Field>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={terminateNow}
                    disabled={offboardingSaving}
                    title="Terminate immediately and keep tracking the rest of the checklist afterward"
                    style={{ ...dangerBtn, flex: 1, background: 'rgba(220,38,38,0.12)', color: 'var(--error)', border: '1px solid rgba(220,38,38,0.3)' }}
                  >
                    {offboardingSaving ? 'Saving...' : 'Terminate now'}
                  </button>
                  <button
                    onClick={completeOffboarding}
                    disabled={offboardingSaving}
                    style={{ ...dangerBtn, flex: 1, background: 'var(--error)', color: 'var(--accent-text)', border: 'none' }}
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

    {/* JAY-125 — type-to-confirm before the destructive delete fires. */}
    {showRemoveConfirm && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowRemoveConfirm(false)}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '1.5rem', width: '420px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginBottom: '0.6rem' }}>Remove {employee.name}?</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
            This can&apos;t be undone. Type <strong style={{ color: 'var(--text)' }}>{employee.name}</strong> to confirm.
          </div>
          <input
            autoFocus
            value={removeConfirmText}
            onChange={e => setRemoveConfirmText(e.target.value)}
            placeholder={employee.name}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: '1rem', borderColor: removeConfirmText && removeConfirmText !== employee.name ? 'var(--error)' : undefined }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowRemoveConfirm(false)} style={ghostBtn}>Cancel</button>
            <button
              onClick={() => { setShowRemoveConfirm(false); onDelete(employee.id) }}
              disabled={removeConfirmText !== employee.name}
              style={{
                ...dangerBtn,
                opacity: removeConfirmText === employee.name ? 1 : 0.5,
                cursor: removeConfirmText === employee.name ? 'pointer' : 'default',
              }}
            >
              Remove employee
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
