'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import DocumentLibrary from '../components/DocumentLibrary'
import { Suspense } from 'react'
import { ReceiptIcon, CalendarIcon, BookOpenIcon } from '../components/Icons'
import { useToast } from '../components/Toast'

type Tab = 'account' | 'hours' | 'onboarding' | 'notifications' | 'billing' | 'team' | 'departments' | 'integrations' | 'danger'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type DayHours = { open: string; close: string; closed: boolean }
type BusinessHours = Record<DayKey, DayHours>
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS: Record<DayKey, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }
const DEFAULT_HOURS: BusinessHours = {
  sun: { open: '10:00', close: '18:00', closed: true },
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: '10:00', close: '18:00', closed: false },
}

type Field = { id: string; label: string; placeholder: string }
const DEFAULT_FIELDS: Field[] = [
  { id: 'startTime', label: 'Start time', placeholder: 'e.g. 9:00 AM' },
  { id: 'reportTo', label: 'Reports to', placeholder: 'e.g. Store manager' },
  { id: 'payRate', label: 'Pay rate', placeholder: 'e.g. $15/hr' },
  { id: 'dresscode', label: 'Dress code', placeholder: 'e.g. Black shirt, jeans' },
]

type TeamEmployee = {
  id: number
  name: string
  email: string
  role: string
  access_role: string
  status: string
  permissions: Record<string, boolean> | null
}

type Department = { id: number; name: string; color: string }

// Okabe-Ito palette — a widely-used, research-vetted colorblind-safe categorical
// palette (distinguishable under protanopia/deuteranopia/tritanopia). Offered as
// quick-pick suggestions alongside the free color picker below, not a replacement.
const COLORBLIND_SAFE_PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7']

const PERM_KEYS = ['schedule_edit','schedule_pool','schedule_swaps','employees_view','employees_edit','employees_manage','pto_approve','payroll_view','payroll_log','hiring_view'] as const
type PermKey = typeof PERM_KEYS[number]

const ROLE_PRESETS: Record<string, Record<PermKey, boolean>> = {
  employee: { schedule_edit: false, schedule_pool: false, schedule_swaps: false, employees_view: false, employees_edit: false, employees_manage: false, pto_approve: false, payroll_view: false, payroll_log: false, hiring_view: false },
  manager:  { schedule_edit: true,  schedule_pool: true,  schedule_swaps: true,  employees_view: true,  employees_edit: false, employees_manage: false, pto_approve: true,  payroll_view: false, payroll_log: false, hiring_view: false },
  admin:    { schedule_edit: true,  schedule_pool: true,  schedule_swaps: true,  employees_view: true,  employees_edit: true,  employees_manage: true,  pto_approve: true,  payroll_view: true,  payroll_log: true,  hiring_view: true  },
}

const PERM_META: Record<PermKey, { label: string; sub: string; section: string }> = {
  schedule_edit:     { label: 'Edit shifts',               sub: 'Add, change, and delete shifts',          section: 'Scheduling' },
  schedule_pool:     { label: 'Manage open pool',          sub: 'Post and assign uncovered shifts',         section: 'Scheduling' },
  schedule_swaps:    { label: 'Approve swaps',             sub: 'Approve or deny shift swap requests',      section: 'Scheduling' },
  employees_view:    { label: 'View profiles',             sub: 'See employee info and documents',          section: 'Employees'  },
  employees_edit:    { label: 'Edit profiles',             sub: 'Update employee records',                  section: 'Employees'  },
  employees_manage:  { label: 'Add and remove employees',  sub: 'Hire and offboard team members',           section: 'Employees'  },
  pto_approve:       { label: 'Approve time-off requests', sub: 'Review and action PTO requests',           section: 'Time off'   },
  payroll_view:      { label: 'View pay rates',            sub: "See other employees' pay",                 section: 'Payroll'    },
  payroll_log:       { label: 'Log payroll entries',       sub: 'Record pay runs',                          section: 'Payroll'    },
  hiring_view:       { label: 'View and manage applicants',sub: 'Access the hiring pipeline',               section: 'Hiring'     },
}

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London',
  'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
]

function toggle(val: boolean, setter: (v: boolean) => void, label: string, saving: boolean, onSave: () => void) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ fontSize: '14px', color: '#333' }}>{label}</span>
      <button
        onClick={() => { setter(!val); setTimeout(onSave, 100) }}
        disabled={saving}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: val ? '#185fa5' : '#d0d5dd', position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: val ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', display: 'block',
        }} />
      </button>
    </div>
  )
}

function SettingsContent() {
  const { showToast } = useToast()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) ?? 'account'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [userId, setUserId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userEmail, setUserEmail] = useState('')

  // Business hours
  const [bizHours, setBizHours] = useState<BusinessHours>(DEFAULT_HOURS)
  const [hoursSaving, setHoursSaving] = useState(false)

  // Account
  const [bizName, setBizName] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [contactEmail, setContactEmail] = useState('')
  const [accountantEmail, setAccountantEmail] = useState('')
  const [acctSaving, setAcctSaving] = useState(false)

  // Onboarding template
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS)
  const [welcomePack, setWelcomePack] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [tmplSaving, setTmplSaving] = useState(false)

  // Notifications
  const [notifTimeOff, setNotifTimeOff] = useState(true)
  const [notifFormSubmit, setNotifFormSubmit] = useState(true)
  const [notifWelcomeSigned, setNotifWelcomeSigned] = useState(true)
  const [notifNewEmployee, setNotifNewEmployee] = useState(true)
  const [notifSaving, setNotifSaving] = useState(false)

  // Team
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([])
  const [pendingInviteIds, setPendingInviteIds] = useState<Set<number>>(new Set())
  const [resendingId, setResendingId] = useState<number | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const joinLink = typeof window !== 'undefined' && userId ? `${window.location.origin}/join/${userId}` : ''
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'employee'>('employee')
  const [inviting, setInviting] = useState(false)
  const [roleUpdating, setRoleUpdating] = useState<number | null>(null)

  // Departments
  const [departments, setDepartments] = useState<Department[]>([])
  const [newDeptName, setNewDeptName] = useState('')
  const [newDeptColor, setNewDeptColor] = useState('#185fa5')
  const [editingDept, setEditingDept] = useState<number | null>(null)
  const [editDeptName, setEditDeptName] = useState('')
  const [deptSaving, setDeptSaving] = useState(false)
  const [showTerminated, setShowTerminated] = useState(false)

  // Granular permissions panel (inside Team tab)
  const [permEmployee, setPermEmployee] = useState<TeamEmployee | null>(null)
  const [permValues, setPermValues] = useState<Record<PermKey, boolean>>(ROLE_PRESETS.employee)
  const [permSaving, setPermSaving] = useState(false)
  const [permSaved, setPermSaved] = useState(false)

  // Billing
  type BillingStatus = {
    status: string; plan: string; planName: string; planPrice: number
    employeeLimit: number | null; employeeCount: number
    trialDaysLeft: number; trialEndsAt: string; currentPeriodEnd: string | null
    hasSubscription: boolean
  }
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  // Danger
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.href = '/login'; return }
    setUserId(session.user.id)
    setAccessToken(session.access_token)
    setUserEmail(session.user.email ?? '')

    const [bizRes, tmplRes, notifRes, empRes, deptRes] = await Promise.all([
      fetch('/api/settings/business', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      supabase.from('onboarding_templates').select('fields, welcome_pack').eq('user_id', session.user.id).single(),
      fetch('/api/settings/notifications', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      supabase.from('employees').select('id, name, email, role, access_role, status, permissions').eq('user_id', session.user.id).order('name'),
      supabase.from('departments').select('id, name, color').eq('user_id', session.user.id).order('name'),
    ])

    const bizData = await bizRes.json()
    if (bizData.profile) {
      setBizName(bizData.profile.business_name ?? '')
      setAddress(bizData.profile.address ?? '')
      setTimezone(bizData.profile.timezone ?? 'America/New_York')
      setContactEmail(bizData.profile.contact_email ?? '')
      setAccountantEmail(bizData.profile.accountant_email ?? '')
      if (bizData.profile.business_hours) setBizHours(bizData.profile.business_hours)
    }

    if (tmplRes.data?.fields?.length) setFields(tmplRes.data.fields)
    if (tmplRes.data?.welcome_pack) setWelcomePack(tmplRes.data.welcome_pack)

    const notifData = await notifRes.json()
    if (notifData.prefs) {
      setNotifTimeOff(notifData.prefs.time_off_request ?? true)
      setNotifFormSubmit(notifData.prefs.form_submission ?? true)
      setNotifWelcomeSigned(notifData.prefs.welcome_signed ?? true)
      setNotifNewEmployee(notifData.prefs.new_employee ?? true)
    }

    if (empRes.data) setTeamEmployees(empRes.data)
    if (deptRes.data) setDepartments(deptRes.data)

    // Who's still pending setup (never signed in) — powers the "Resend invite"
    // button (JAY-28). Separate fetch, not folded into the employees query above,
    // since it needs a Supabase Auth admin lookup the client can't do directly.
    fetch('/api/team/invite/pending', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.pendingIds) setPendingInviteIds(new Set(d.pendingIds)) })
      .catch(() => {})

    // Load billing status
    setBillingLoading(true)
    fetch('/api/billing/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json()).then(d => { if (!d.error) setBilling(d) }).catch(() => {})
      .finally(() => setBillingLoading(false))
  }

  async function saveAccount() {
    setAcctSaving(true)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail, accountant_email: accountantEmail }),
    })
    showToast(res.ok ? 'Saved.' : 'Error saving.', res.ok ? 'success' : 'error')
    setAcctSaving(false)
  }

  async function saveHours() {
    setHoursSaving(true)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail, business_hours: bizHours }),
    })
    showToast(res.ok ? 'Saved.' : 'Error saving.', res.ok ? 'success' : 'error')
    setHoursSaving(false)
  }

  async function saveTemplate() {
    setTmplSaving(true)
    const { error } = await supabase.from('onboarding_templates').upsert(
      { user_id: userId, fields, welcome_pack: welcomePack, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    showToast(error ? 'Error saving.' : 'Template saved.', error ? 'error' : 'success')
    setTmplSaving(false)
  }

  async function saveNotifs() {
    setNotifSaving(true)
    await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ prefs: { time_off_request: notifTimeOff, form_submission: notifFormSubmit, welcome_signed: notifWelcomeSigned, new_employee: notifNewEmployee } }),
    })
    setNotifSaving(false)
  }

  async function updateEmployeeRole(empId: number, newRole: string) {
    setRoleUpdating(empId)
    await supabase.from('employees').update({ access_role: newRole }).eq('id', empId)
    setTeamEmployees(prev => prev.map(e => e.id === empId ? { ...e, access_role: newRole } : e))
    setRoleUpdating(null)
  }

  async function resendInvite(empId: number) {
    setResendingId(empId)
    const res = await fetch('/api/team/invite/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ employeeId: empId }),
    })
    const data = await res.json().catch(() => ({}))
    showToast(res.ok ? 'Invite resent.' : (data.error || 'Could not resend invite.'), res.ok ? 'success' : 'error')
    setResendingId(null)
  }

  async function createDept() {
    if (!newDeptName.trim()) return
    setDeptSaving(true)
    const { data } = await supabase.from('departments').insert([{ user_id: userId, name: newDeptName.trim(), color: newDeptColor }]).select().single()
    if (data) setDepartments(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewDeptName('')
    setNewDeptColor('#185fa5')
    setDeptSaving(false)
  }

  async function saveDeptName(id: number) {
    if (!editDeptName.trim()) return
    await supabase.from('departments').update({ name: editDeptName.trim() }).eq('id', id)
    setDepartments(prev => prev.map(d => d.id === id ? { ...d, name: editDeptName.trim() } : d))
    setEditingDept(null)
  }

  async function deleteDept(id: number) {
    await supabase.from('departments').delete().eq('id', id)
    setDepartments(prev => prev.filter(d => d.id !== id))
    if (permEmployee) setPermEmployee(null)
  }

  function openPermPanel(emp: TeamEmployee) {
    if (permEmployee?.id === emp.id) { setPermEmployee(null); return }
    const base = ROLE_PRESETS[emp.access_role] ?? ROLE_PRESETS.employee
    const merged = { ...base, ...(emp.permissions ?? {}) } as Record<PermKey, boolean>
    setPermValues(merged)
    setPermEmployee(emp)
    setPermSaved(false)
  }

  function applyRolePreset(role: string) {
    setPermValues({ ...ROLE_PRESETS[role] ?? ROLE_PRESETS.employee })
  }

  async function savePermissions() {
    if (!permEmployee) return
    setPermSaving(true)
    await supabase.from('employees').update({ permissions: permValues }).eq('id', permEmployee.id)
    setTeamEmployees(prev => prev.map(e => e.id === permEmployee.id ? { ...e, permissions: permValues } : e))
    setPermSaving(false)
    setPermSaved(true)
    setTimeout(() => setPermSaved(false), 2000)
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)

    // Check if employee with this email already exists
    const { data: existing } = await supabase
      .from('employees')
      .select('id, access_role')
      .eq('user_id', userId)
      .eq('email', inviteEmail.trim().toLowerCase())
      .single()

    if (existing) {
      // Just update their role
      await supabase.from('employees').update({ access_role: inviteRole }).eq('id', existing.id)
      showToast(`Role updated for ${inviteEmail}.`, 'success')
      const { data } = await supabase.from('employees').select('id, name, email, role, access_role, status, permissions').eq('user_id', userId).order('name')
      if (data) setTeamEmployees(data)
    } else {
      // Send portal invite via API — creates account link
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'Error sending invite.', 'error')
      } else {
        showToast(`Invite sent to ${inviteEmail}.`, 'success')
        const { data: emps } = await supabase.from('employees').select('id, name, email, role, access_role, status, permissions').eq('user_id', userId).order('name')
        if (emps) setTeamEmployees(emps)
      }
    }

    setInviteEmail('')
    setInviting(false)
  }

  async function exportData() {
    setExporting(true)
    const res = await fetch('/api/settings/export', { headers: { Authorization: `Bearer ${accessToken}` } })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `helpdesk-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  async function deleteAccount() {
    if (deleteConfirm !== userEmail) return
    setDeleting(true)
    await fetch('/api/settings/delete-account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'account', label: 'Account' },
    { key: 'hours', label: 'Hours' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'billing', label: 'Billing' },
    { key: 'team', label: 'Team' },
    { key: 'departments', label: 'Departments' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'danger', label: 'Danger zone' },
  ]

  return (
    <div className="dash-wrap">
      <Nav active="settings" />
      <div className="dash-content">
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1.5px solid #eee', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? '#185fa5' : '#666',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t.key ? '2px solid #185fa5' : '2px solid transparent',
              marginBottom: '-1.5px', transition: 'all 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ maxWidth: '540px' }}>

          {/* ACCOUNT */}
          {tab === 'account' && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '1rem' }}>Business information</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Business name</label>
                  <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Acme Coffee Co." />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Address</label>
                  <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, City, State" />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Contact email</label>
                  <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder={userEmail} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Accountant email</label>
                  <input type="email" value={accountantEmail} onChange={e => setAccountantEmail(e.target.value)} placeholder="accountant@example.com" />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Timezone</label>
                  <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ width: '100%' }}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn auth-btn-primary" onClick={saveAccount} disabled={acctSaving} style={{ marginTop: '1.25rem', width: 'auto' }}>
                {acctSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}

          {/* HOURS */}
          {tab === 'hours' && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.25rem' }}>Business hours</div>
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                Set when you're open. These times pre-fill the shift form and bound auto-generated schedules.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {DAY_KEYS.map((day, i) => {
                  const h = bizHours[day]
                  return (
                    <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: i < 6 ? '1px solid #f0f0f0' : 'none' }}>
                      <div style={{ width: '96px', fontSize: '13px', fontWeight: 500, color: h.closed ? '#bbb' : '#1a1a1a', flexShrink: 0 }}>{DAY_LABELS[day]}</div>
                      {h.closed ? (
                        <div style={{ flex: 1, fontSize: '13px', color: '#bbb' }}>Closed</div>
                      ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="time" value={h.open} onChange={e => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))}
                            style={{ width: '120px', fontSize: '13px', padding: '5px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
                          <span style={{ fontSize: '12px', color: '#aaa' }}>to</span>
                          <input type="time" value={h.close} onChange={e => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))}
                            style={{ width: '120px', fontSize: '13px', padding: '5px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
                        </div>
                      )}
                      <button
                        onClick={() => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }))}
                        style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${h.closed ? '#dde1ea' : '#fcd4d4'}`, background: h.closed ? '#f5f5f5' : '#fff5f5', color: h.closed ? '#888' : '#c0392b', cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}
                      >
                        {h.closed ? 'Open' : 'Close'}
                      </button>
                    </div>
                  )
                })}
              </div>
              <button className="btn auth-btn-primary" onClick={saveHours} disabled={hoursSaving} style={{ marginTop: '1.25rem', width: 'auto' }}>
                {hoursSaving ? 'Saving...' : 'Save hours'}
              </button>
            </div>
          )}

          {/* ONBOARDING */}
          {tab === 'onboarding' && (
            <>
              <div className="card">
                <div className="section-label">Onboarding fields</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Customize the fields you fill in when adding a new hire.
                </div>
                <div className="template-fields">
                  {fields.map(field => (
                    <div key={field.id} className="template-field-row">
                      <input value={field.label} onChange={e => setFields(prev => prev.map(f => f.id === field.id ? { ...f, label: e.target.value } : f))} style={{ flex: 1 }} />
                      <button className="delete-btn" style={{ opacity: 1 }} onClick={() => setFields(prev => prev.filter(f => f.id !== field.id))}>×</button>
                    </div>
                  ))}
                </div>
                <div className="template-add-row">
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Food handler's permit" onKeyDown={e => e.key === 'Enter' && (() => { if (!newLabel.trim()) return; setFields(prev => [...prev, { id: newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_'), label: newLabel, placeholder: '' }]); setNewLabel('') })()} />
                  <button className="btn" onClick={() => { if (!newLabel.trim()) return; setFields(prev => [...prev, { id: newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_'), label: newLabel, placeholder: '' }]); setNewLabel('') }}>+ Add</button>
                </div>
                <button className="btn auth-btn-primary" onClick={saveTemplate} disabled={tmplSaving} style={{ marginTop: '1.25rem', width: 'auto' }}>
                  {tmplSaving ? 'Saving...' : 'Save template'}
                </button>
              </div>

              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="section-label">Welcome pack template</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Click a tag below to insert it — it will be replaced with the employee's actual info when you send the welcome pack.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {[{ label: 'Name' }, { label: 'Role' }, { label: 'Start date' }, { label: 'Phone' }, ...fields.map(f => ({ label: f.label }))].map(({ label }) => (
                    <button key={label} onClick={() => setWelcomePack(prev => prev + `[${label}]`)}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1.5px solid #d0d5e8', background: '#f4f6fc', color: '#185fa5', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <textarea value={welcomePack} onChange={e => setWelcomePack(e.target.value)} placeholder={`Hi [Name],\n\nWelcome to the team!...`} style={{ minHeight: '200px', fontFamily: 'inherit', fontSize: '14px' }} />
                <button className="btn auth-btn-primary" onClick={saveTemplate} disabled={tmplSaving} style={{ marginTop: '0.75rem', width: 'auto' }}>
                  {tmplSaving ? 'Saving...' : 'Save template'}
                </button>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <DocumentLibrary userId={userId} />
              </div>
            </>
          )}

          {/* NOTIFICATIONS */}
          {tab === 'notifications' && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: '0.5rem' }}>Email notifications</div>
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '0.25rem' }}>Choose which events send you an email.</div>
              {toggle(notifTimeOff, setNotifTimeOff, 'Employee requests time off', notifSaving, saveNotifs)}
              {toggle(notifFormSubmit, setNotifFormSubmit, 'Employee submits W-4, I-9, or direct deposit form', notifSaving, saveNotifs)}
              {toggle(notifWelcomeSigned, setNotifWelcomeSigned, 'Employee signs their welcome pack', notifSaving, saveNotifs)}
              {toggle(notifNewEmployee, setNotifNewEmployee, 'New employee is added', notifSaving, saveNotifs)}
              {notifSaving && <div style={{ fontSize: '12px', color: '#999', marginTop: '0.75rem' }}>Saving...</div>}
            </div>
          )}

          {/* BILLING */}
          {tab === 'billing' && (
            <div>
              {billingLoading || !billing ? (
                <div className="card" style={{ color: '#bbb', fontSize: '14px' }}>Loading billing info…</div>
              ) : (
                <>
                  {/* Current plan card */}
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <div className="section-label" style={{ marginBottom: '1rem' }}>Current plan</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', background: '#f7f9fc', borderRadius: '10px', marginBottom: '1.25rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '16px', color: '#185fa5' }}>{billing.planName}</div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>
                          ${billing.planPrice}/mo · {billing.employeeLimit ? `up to ${billing.employeeLimit} employees` : 'unlimited employees'}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', textTransform: 'capitalize',
                        background: billing.status === 'active' ? '#e6f9f0' : billing.status === 'trialing' ? '#fff8e6' : billing.status === 'past_due' ? '#fef2f2' : '#f5f5f5',
                        color: billing.status === 'active' ? '#15803d' : billing.status === 'trialing' ? '#b45309' : billing.status === 'past_due' ? '#b91c1c' : '#666',
                      }}>
                        {billing.status === 'trialing' ? `Trial · ${billing.trialDaysLeft} days left` : billing.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '24px', marginBottom: '1.25rem' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active employees</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>
                          {billing.employeeCount}
                          {billing.employeeLimit && <span style={{ fontSize: '13px', color: '#bbb', fontWeight: 400 }}> / {billing.employeeLimit}</span>}
                        </div>
                      </div>
                      {billing.currentPeriodEnd && (
                        <div>
                          <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next billing date</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
                            {new Date(billing.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      )}
                      {billing.status === 'trialing' && !billing.hasSubscription && (
                        <div>
                          <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trial ends</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: '#b45309' }}>
                            {new Date(billing.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      )}
                    </div>

                    {billing.hasSubscription && (
                      <button
                        className="btn"
                        style={{ fontSize: '13px', padding: '8px 18px', background: '#f5f6fa', color: '#333', border: '1px solid #e5e7eb' }}
                        disabled={portalLoading}
                        onClick={async () => {
                          setPortalLoading(true)
                          const res = await fetch('/api/billing/portal', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${accessToken}` },
                          })
                          const data = await res.json()
                          if (data.url) window.location.href = data.url
                          setPortalLoading(false)
                        }}
                      >
                        {portalLoading ? 'Redirecting…' : 'Manage billing & invoices →'}
                      </button>
                    )}
                  </div>

                  {/* Plan picker (shown on trial or if not on pro) */}
                  {(billing.status === 'trialing' || billing.plan !== 'pro') && (
                    <div className="card">
                      <div className="section-label" style={{ marginBottom: '1rem' }}>
                        {billing.status === 'trialing' ? 'Choose a plan to continue after your trial' : 'Upgrade your plan'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                        {([
                          { key: 'starter', name: 'Starter', price: 29, limit: '10 employees', features: ['Scheduling & time tracking', 'Employee portal', 'Hiring pipeline', 'Team messaging'] },
                          { key: 'growth',  name: 'Growth',  price: 69, limit: '30 employees', features: ['Everything in Starter', 'PTO management', 'Payroll tracking', 'Advanced reports'] },
                          { key: 'pro',     name: 'Pro',     price: 129, limit: 'Unlimited employees', features: ['Everything in Growth', 'AI assistant', 'Priority support', 'Custom onboarding'] },
                        ] as const).map(p => {
                          const isCurrent = billing.plan === p.key && billing.status !== 'trialing'
                          const isPopular = p.key === 'growth'
                          return (
                            <div key={p.key} style={{
                              border: `1.5px solid ${isPopular ? '#185fa5' : '#e5e7eb'}`,
                              borderRadius: '12px', padding: '20px', position: 'relative',
                              background: isPopular ? '#f0f6ff' : '#fff',
                            }}>
                              {isPopular && (
                                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#185fa5', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 10px', borderRadius: '99px', whiteSpace: 'nowrap' }}>
                                  MOST POPULAR
                                </div>
                              )}
                              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{p.name}</div>
                              <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginBottom: '2px' }}>${p.price}<span style={{ fontSize: '13px', fontWeight: 400, color: '#888' }}>/mo</span></div>
                              <div style={{ fontSize: '11px', color: '#888', marginBottom: '14px' }}>{p.limit}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                                {p.features.map(f => (
                                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#444' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    {f}
                                  </div>
                                ))}
                              </div>
                              <button
                                className="btn auth-btn-primary"
                                style={{ width: '100%', fontSize: '13px', padding: '9px', background: isPopular ? '#185fa5' : '#1a1a1a', opacity: isCurrent ? 0.5 : 1 }}
                                disabled={isCurrent || checkoutLoading === p.key}
                                onClick={async () => {
                                  setCheckoutLoading(p.key)
                                  const res = await fetch('/api/billing/create-checkout', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                                    body: JSON.stringify({ plan: p.key }),
                                  })
                                  const data = await res.json()
                                  if (data.url) window.location.href = data.url
                                  setCheckoutLoading(null)
                                }}
                              >
                                {isCurrent ? 'Current plan' : checkoutLoading === p.key ? 'Loading…' : billing.status === 'trialing' ? `Start with ${p.name}` : `Switch to ${p.name}`}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ fontSize: '12px', color: '#aaa', marginTop: '12px', textAlign: 'center' }}>
                        14-day free trial included · Cancel anytime · No setup fees
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TEAM */}
          {tab === 'team' && (
            <div>
              {/* Role legend */}
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>Access levels</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[
                    { label: 'Owner', color: '#185fa5', bg: '#e8f0fb', desc: 'Full access including billing and account settings. Only one per business.' },
                    { label: 'Admin', color: '#7c3aed', bg: '#f3f0ff', desc: 'Full dashboard access — employees, shifts, payroll, hiring. Cannot delete the account or change billing.' },
                    { label: 'Manager', color: '#d97706', bg: '#fffbeb', desc: 'Can view employees, manage shifts, approve time off and swap requests. No payroll rates or settings.' },
                    { label: 'Employee', color: '#555', bg: '#f5f5f5', desc: 'Portal only — their own schedule, clock in/out, PTO requests, shift swaps.' },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: r.bg, color: r.color, flexShrink: 0, minWidth: '60px', textAlign: 'center' }}>{r.label}</span>
                      <span style={{ fontSize: '12px', color: '#666' }}>{r.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Employee list with inline role change */}
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div className="section-label" style={{ marginBottom: 0 }}>
                    Team ({teamEmployees.filter(e => showTerminated || e.status !== 'terminated').length})
                  </div>
                  {teamEmployees.some(e => e.status === 'terminated') && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#888', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={showTerminated}
                        onChange={e => setShowTerminated(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      Show terminated
                    </label>
                  )}
                </div>
                {teamEmployees.filter(e => showTerminated || e.status !== 'terminated').length === 0 && (
                  <div style={{ fontSize: '13px', color: '#bbb', padding: '8px 0' }}>No employees yet.</div>
                )}
                {teamEmployees.filter(e => showTerminated || e.status !== 'terminated').map(emp => {
                  const roleColors: Record<string, { bg: string; color: string }> = {
                    admin: { bg: '#f3f0ff', color: '#7c3aed' },
                    manager: { bg: '#fffbeb', color: '#d97706' },
                    employee: { bg: '#f5f5f5', color: '#555' },
                  }
                  const rc = roleColors[emp.access_role] ?? roleColors.employee
                  const isOpen = permEmployee?.id === emp.id
                  const hasCustom = emp.permissions !== null
                  const isPending = pendingInviteIds.has(emp.id)
                  return (
                    <div key={emp.id}>
                      <div
                        onClick={() => openPermPanel(emp)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: isOpen ? 'none' : '1px solid #f5f5f5', cursor: 'pointer' }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e8edf8', color: '#185fa5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
                          {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
                          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.email || emp.role}</div>
                        </div>
                        {isPending && (
                          <>
                            <span style={{ fontSize: '10px', color: '#d97706', background: '#fffbeb', padding: '2px 7px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>Not yet accepted</span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); resendInvite(emp.id) }}
                              disabled={resendingId === emp.id}
                              style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #dde1ea', background: '#fff', cursor: 'pointer', color: '#185fa5', fontWeight: 500, flexShrink: 0 }}
                            >
                              {resendingId === emp.id ? 'Sending…' : 'Resend invite'}
                            </button>
                          </>
                        )}
                        {hasCustom && <span style={{ fontSize: '10px', color: '#185fa5', background: '#e8f0fb', padding: '2px 7px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>Custom</span>}
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: rc.bg, color: rc.color, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {emp.access_role}
                        </span>
                        <select
                          value={emp.access_role}
                          disabled={roleUpdating === emp.id}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); updateEmployeeRole(emp.id, e.target.value) }}
                          style={{ fontSize: '12px', padding: '4px 7px', border: '1px solid #dde1ea', borderRadius: '6px', cursor: 'pointer', color: '#555', flexShrink: 0, width: 'auto' }}
                        >
                          <option value="employee">Employee</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <span style={{ fontSize: '14px', color: '#bbb', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                      </div>

                      {/* Inline permission panel */}
                      {isOpen && (
                        <div onClick={e => e.stopPropagation()} style={{ background: '#f9fafc', border: '1px solid #e8eaf0', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                            <span style={{ fontSize: '12px', color: '#888' }}>Apply preset:</span>
                            {(['employee','manager','admin'] as const).map(r => (
                              <button type="button" key={r} onClick={() => applyRolePreset(r)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 10, border: '1px solid #dde1ea', background: '#fff', cursor: 'pointer', color: '#555', fontWeight: 500, textTransform: 'capitalize' }}>{r}</button>
                            ))}
                          </div>
                          {(['Scheduling','Employees','Time off','Payroll','Hiring'] as const).map(section => (
                            <div key={section}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 0 4px', borderBottom: '1px solid #eee', marginBottom: 2 }}>{section}</div>
                              {PERM_KEYS.filter(k => PERM_META[k].section === section).map(key => (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f3f4f6', gap: 8 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#333' }}>{PERM_META[key].label}</div>
                                    <div style={{ fontSize: '11px', color: '#aaa' }}>{PERM_META[key].sub}</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPermValues(prev => ({ ...prev, [key]: !prev[key] }))}
                                    style={{ width: 38, height: 21, borderRadius: 11, border: 'none', cursor: 'pointer', background: permValues[key] ? '#185fa5' : '#d0d5dd', position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}
                                  >
                                    <span style={{ position: 'absolute', top: 3, left: permValues[key] ? 19 : 3, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', display: 'block' }} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ))}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
                            <button className="btn auth-btn-primary" onClick={savePermissions} disabled={permSaving} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                              {permSaving ? 'Saving...' : 'Save permissions'}
                            </button>
                            {permSaved && <span style={{ fontSize: '12px', color: '#27ae60' }}>Saved.</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Invite new person */}
              <div className="card">
                <div className="section-label" style={{ marginBottom: '0.5rem' }}>Invite someone new</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  If the email matches an existing employee, their access level is updated. Otherwise an invite is sent and a record is created.
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com" style={{ flex: 1, minWidth: '180px' }} onKeyDown={e => e.key === 'Enter' && sendInvite()} />
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'manager' | 'employee')} style={{ width: 'auto' }}>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button className="btn auth-btn-primary" onClick={sendInvite} disabled={inviting || !inviteEmail.trim()} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                  {inviting ? 'Sending...' : 'Send invite'}
                </button>
              </div>

              {/* Join link (JAY-29) */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.5rem' }}>Share a join link</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Don't have their email handy? Share this link and let them fill in their own name, email, and phone. They'll show up here as pending — assign their role afterward.
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input readOnly value={joinLink} onClick={e => (e.target as HTMLInputElement).select()} style={{ flex: 1, minWidth: '200px', fontSize: '13px', color: '#666' }} />
                  <button
                    className="btn"
                    style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(joinLink)
                      showToast('Join link copied.', 'success')
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DEPARTMENTS */}
          {tab === 'departments' && (
            <div>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>Departments</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Group your team by department. Assign employees in their profile.
                </div>
                {departments.length === 0 && (
                  <div style={{ fontSize: '13px', color: '#bbb', padding: '8px 0', marginBottom: '0.75rem' }}>No departments yet.</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {departments.map((dept, i) => (
                    <div key={dept.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: i < departments.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: dept.color, flexShrink: 0 }} />
                      {editingDept === dept.id ? (
                        <>
                          <input value={editDeptName} onChange={e => setEditDeptName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveDeptName(dept.id); if (e.key === 'Escape') setEditingDept(null) }} style={{ flex: 1, fontSize: '13px', padding: '4px 8px' }} autoFocus />
                          <button className="btn auth-btn-primary" style={{ fontSize: '12px', padding: '4px 10px', width: 'auto' }} onClick={() => saveDeptName(dept.id)}>Save</button>
                          <button className="btn" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => setEditingDept(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>{dept.name}</span>
                          <button onClick={() => { setEditingDept(dept.id); setEditDeptName(dept.name) }} style={{ fontSize: '12px', color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Rename</button>
                          <button onClick={() => deleteDept(dept.id)} style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Delete</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="section-label" style={{ marginBottom: '0.75rem' }}>Add department</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="e.g. Kitchen" onKeyDown={e => e.key === 'Enter' && createDept()} style={{ flex: 1, minWidth: '140px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: '#888' }}>Color</label>
                    <input type="color" value={newDeptColor} onChange={e => setNewDeptColor(e.target.value)} style={{ width: 32, height: 32, padding: 2, border: '1px solid #dde1ea', borderRadius: 6, cursor: 'pointer' }} />
                  </div>
                  <button className="btn auth-btn-primary" onClick={createDept} disabled={deptSaving || !newDeptName.trim()} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                    {deptSaving ? 'Adding...' : '+ Add'}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: '#aaa' }}>Colorblind-safe picks:</span>
                  {COLORBLIND_SAFE_PALETTE.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewDeptColor(c)}
                      title={c}
                      aria-label={`Use color ${c}`}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                        border: newDeptColor === c ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.15)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* INTEGRATIONS */}
          {tab === 'integrations' && (
            <IntegrationsTab />
          )}

          {/* DANGER ZONE */}
          {tab === 'danger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '0.5rem' }}>Export your data</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Download all your employees, payroll entries, and shifts as a JSON file.
                </div>
                <button className="btn" onClick={exportData} disabled={exporting} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                  {exporting ? 'Preparing...' : 'Export data'}
                </button>
              </div>

              <div className="card" style={{ border: '1.5px solid #fde8e8' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#c0392b', marginBottom: '0.5rem' }}>Delete account</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  This permanently deletes your account and all data. Type your email address to confirm.
                </div>
                <input
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder={userEmail}
                  style={{ marginBottom: '0.75rem', borderColor: deleteConfirm && deleteConfirm !== userEmail ? '#c0392b' : undefined }}
                />
                <button
                  onClick={deleteAccount}
                  disabled={deleteConfirm !== userEmail || deleting}
                  style={{
                    width: 'auto', fontSize: '13px', padding: '7px 16px',
                    background: deleteConfirm === userEmail ? '#c0392b' : '#f5f5f5',
                    color: deleteConfirm === userEmail ? '#fff' : '#aaa',
                    border: 'none', borderRadius: '8px', cursor: deleteConfirm === userEmail ? 'pointer' : 'default',
                    fontWeight: 600,
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete my account'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function IntegrationsTab() {
  const { showToast } = useToast()
  const [gusto, setGusto] = useState<{ company_uuid: string | null; connected_at: string } | null>(null)
  const [google, setGoogle] = useState<{ connected_at: string } | null>(null)
  const [qb, setQb] = useState<{ realm_id: string; connected_at: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setAccessToken(session.access_token)
      const uid = session.user.id
      const [g, gc, qbr] = await Promise.all([
        supabase.from('gusto_connections').select('company_uuid, connected_at').eq('user_id', uid).single(),
        supabase.from('google_connections').select('connected_at').eq('user_id', uid).single(),
        supabase.from('quickbooks_connections').select('realm_id, connected_at').eq('user_id', uid).single(),
      ])
      if (g.data) setGusto(g.data)
      if (gc.data) setGoogle(gc.data)
      if (qbr.data) setQb(qbr.data)
      setLoading(false)
    })
  }, [])

  async function handleConnect(service: 'gusto' | 'google' | 'quickbooks') {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    window.location.href = `/api/${service}/connect?token=${session.access_token}`
  }

  async function handleDisconnect(service: 'gusto' | 'google' | 'quickbooks') {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const table = service === 'gusto' ? 'gusto_connections' : service === 'google' ? 'google_connections' : 'quickbooks_connections'
    await supabase.from(table).delete().eq('user_id', session.user.id)
    if (service === 'gusto') setGusto(null)
    if (service === 'google') setGoogle(null)
    if (service === 'quickbooks') setQb(null)
  }

  async function sync(action: string, endpoint: string, body: object) {
    setSyncing(action)
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) })
    const data = await res.json()
    showToast(res.ok ? (data.message ?? '✓ Done.') : `Error: ${data.error}`, res.ok ? 'success' : 'error')
    setSyncing(null)
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const connectedBadge = <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: '#e8f8ef', color: '#27ae60' }}>● Connected</span>
  const notConnectedBadge = <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: '#f5f6fa', color: '#9a9a9a' }}>○ Not connected</span>

  return (
    <div>
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '1.25rem' }}>Connect your tools to keep data in sync.</div>
      <div style={{ display: 'grid', gap: '1rem', maxWidth: '560px' }}>

        {/* Gusto */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: '#f5ece8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ReceiptIcon size={18} color="#c0692b" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px' }}>Gusto</div><div style={{ fontSize: '12px', color: '#888' }}>Payroll &amp; HR</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{gusto ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: '#999' }}>Loading...</div> : gusto ? (
            <>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '0.75rem' }}>Connected {fmtDate(gusto.connected_at)}</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_employees', '/api/gusto/sync', { action: 'push_employees' })} disabled={!!syncing}>{syncing === 'push_employees' ? 'Syncing…' : '↑ Push employees'}</button>
                <button className="btn" style={{ fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('pull_payrolls', '/api/gusto/sync', { action: 'pull_payrolls' })} disabled={!!syncing}>{syncing === 'pull_payrolls' ? 'Importing…' : '↓ Pull payrolls'}</button>
              </div>
              <button style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('gusto')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('gusto')}>Connect Gusto</button>}
        </div>

        {/* Google Calendar */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CalendarIcon size={18} color="#1a73e8" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px' }}>Google Calendar</div><div style={{ fontSize: '12px', color: '#888' }}>Schedule sync</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{google ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: '#999' }}>Loading...</div> : google ? (
            <>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '0.75rem' }}>Connected {fmtDate(google.connected_at)}</div>
              <div style={{ marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_shifts', '/api/google/sync', {})} disabled={!!syncing}>{syncing === 'push_shifts' ? 'Syncing…' : '↑ Push this week\'s shifts'}</button>
              </div>
              <button style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('google')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('google')}>Connect Google Calendar</button>}
        </div>

        {/* QuickBooks */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><BookOpenIcon size={18} color="#2e7d32" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px' }}>QuickBooks</div><div style={{ fontSize: '12px', color: '#888' }}>Accounting sync</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{qb ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: '#999' }}>Loading...</div> : qb ? (
            <>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '0.75rem' }}>Connected {fmtDate(qb.connected_at)}</div>
              <div style={{ marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_payroll', '/api/quickbooks/sync', {})} disabled={!!syncing}>{syncing === 'push_payroll' ? 'Syncing…' : '↑ Push this month\'s payroll'}</button>
              </div>
              <button style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('quickbooks')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('quickbooks')}>Connect QuickBooks</button>}
        </div>

        {/* Indeed */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.75rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1.5" fill="#e65100" stroke="none"/><line x1="12" y1="9" x2="12" y2="20"/><path d="M8 20h8"/></svg>
            </div>
            <div><div style={{ fontWeight: 700, fontSize: '14px' }}>Indeed</div><div style={{ fontSize: '12px', color: '#888' }}>Job board publishing</div></div>
            <div style={{ marginLeft: 'auto' }}><span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: '#fff8f0', color: '#e65100' }}>Via Hiring page</span></div>
          </div>
          <div style={{ fontSize: '13px', color: '#555', marginBottom: '0.75rem', lineHeight: '1.5' }}>Post jobs to Indeed directly from the Hiring page.</div>
          <a href="/hiring" className="btn" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px', display: 'inline-block', textDecoration: 'none' }}>Go to Hiring →</a>
        </div>

      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
