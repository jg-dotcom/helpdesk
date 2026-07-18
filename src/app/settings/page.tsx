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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize: '14px', color: 'var(--text)' }}>{label}</span>
      <button
        onClick={() => { setter(!val); setTimeout(onSave, 100) }}
        disabled={saving}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: val ? 'var(--accent)' : 'rgba(255,255,255,0.12)', position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: val ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-text)',
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

  // JAY-54 (prerequisite step) — weekly labor budget, entered in dollars,
  // stored in cents. Empty string means "not set" (kept distinct from $0).
  const [laborBudget, setLaborBudget] = useState('')
  const [budgetSaving, setBudgetSaving] = useState(false)

  // JAY-18 — clock-in trust package: geofence center entered manually (no
  // geocoding integration in this environment) plus an optional required-photo
  // toggle. Radius is stored in meters but shown to the owner in miles, since
  // that's the unit people actually think in for "how far from the store."
  const [geofenceLat, setGeofenceLat] = useState('')
  const [geofenceLng, setGeofenceLng] = useState('')
  const [geofenceRadiusMi, setGeofenceRadiusMi] = useState('')
  const [requireClockinPhoto, setRequireClockinPhoto] = useState(false)
  const [clockinTrustSaving, setClockinTrustSaving] = useState(false)

  // JAY-123 — PTO accrual policy. 'flat' preserves the original behavior
  // (everyone gets the full pto_days_per_year on day one); 'monthly' prorates
  // from hire date, `rate` days per month, up to the annual grant. Rollover
  // cap is stored for a future year-end job — it doesn't affect balances yet.
  const [ptoAccrualMethod, setPtoAccrualMethod] = useState<'flat' | 'monthly'>('flat')
  const [ptoAccrualRate, setPtoAccrualRate] = useState('1.25')
  const [ptoRolloverCap, setPtoRolloverCap] = useState('')
  const [ptoPolicySaving, setPtoPolicySaving] = useState(false)

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
  // JAY-45 — plan-switch proration preview + confirm modal
  const [switchTarget, setSwitchTarget] = useState<{ key: string; name: string } | null>(null)
  const [switchPreview, setSwitchPreview] = useState<{ isNewSubscription: boolean; dueTodayCents?: number; nextChargeCents?: number; nextChargeDate?: string | null } | null>(null)
  const [switchPreviewLoading, setSwitchPreviewLoading] = useState(false)
  const [switchConfirming, setSwitchConfirming] = useState(false)

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
      if (bizData.profile.weekly_labor_budget_cents != null) setLaborBudget((bizData.profile.weekly_labor_budget_cents / 100).toString())
      // JAY-18
      if (bizData.profile.geofence_lat != null) setGeofenceLat(String(bizData.profile.geofence_lat))
      if (bizData.profile.geofence_lng != null) setGeofenceLng(String(bizData.profile.geofence_lng))
      if (bizData.profile.geofence_radius_m != null) setGeofenceRadiusMi((bizData.profile.geofence_radius_m / 1609.34).toFixed(2))
      setRequireClockinPhoto(!!bizData.profile.require_clockin_photo)
      // JAY-123
      if (bizData.profile.pto_accrual_method) setPtoAccrualMethod(bizData.profile.pto_accrual_method)
      if (bizData.profile.pto_accrual_rate != null) setPtoAccrualRate(String(bizData.profile.pto_accrual_rate))
      if (bizData.profile.pto_rollover_cap != null) setPtoRolloverCap(String(bizData.profile.pto_rollover_cap))
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
    refreshBilling(session.access_token)
  }

  async function refreshBilling(token: string) {
    setBillingLoading(true)
    try {
      const res = await fetch('/api/billing/status', { headers: { Authorization: `Bearer ${token}` } })
      const d = await res.json()
      if (!d.error) setBilling(d)
    } catch { /* advisory only */ }
    setBillingLoading(false)
  }

  async function openSwitchModal(planKey: string, planName: string) {
    setSwitchTarget({ key: planKey, name: planName })
    setSwitchPreview(null)
    setSwitchPreviewLoading(true)
    try {
      const res = await fetch('/api/billing/preview-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (res.ok) setSwitchPreview(data)
      else showToast(data.error || 'Could not load switch preview.', 'error')
    } catch {
      showToast('Could not load switch preview.', 'error')
    }
    setSwitchPreviewLoading(false)
  }

  async function confirmSwitch() {
    if (!switchTarget) return
    setSwitchConfirming(true)
    try {
      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan: switchTarget.key }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Could not switch plans.', 'error')
      } else if (data.url) {
        window.location.href = data.url
        return
      } else if (data.switched) {
        showToast(`Switched to ${switchTarget.name}.`, 'success')
        setSwitchTarget(null)
        setSwitchPreview(null)
        await refreshBilling(accessToken)
      }
    } catch {
      showToast('Could not switch plans.', 'error')
    }
    setSwitchConfirming(false)
  }

  async function saveAccount() {
    setAcctSaving(true)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail, accountant_email: accountantEmail }),
    })
    showToast(res.ok ? 'Saved.' : "Couldn't save changes. Check your connection and try again.", res.ok ? 'success' : 'error')
    setAcctSaving(false)
  }

  async function saveHours() {
    setHoursSaving(true)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail, business_hours: bizHours }),
    })
    showToast(res.ok ? 'Saved.' : "Couldn't save changes. Check your connection and try again.", res.ok ? 'success' : 'error')
    setHoursSaving(false)
  }

  // JAY-54 (prerequisite step) — saved separately from hours/account so a
  // partially-typed budget never gets bundled into an unrelated save.
  async function saveLaborBudget() {
    setBudgetSaving(true)
    const trimmed = laborBudget.trim()
    const cents = trimmed === '' ? null : Math.round(parseFloat(trimmed) * 100)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail, weekly_labor_budget_cents: cents }),
    })
    showToast(res.ok ? 'Saved.' : "Couldn't save changes. Check your connection and try again.", res.ok ? 'success' : 'error')
    setBudgetSaving(false)
  }

  // JAY-18 — saved separately, same "own save button" pattern as the labor
  // budget above. Clearing lat/lng/radius disables the geofence entirely
  // (employee/me/route.ts only returns a geofence when all three are set).
  async function saveClockinTrust() {
    setClockinTrustSaving(true)
    const lat = geofenceLat.trim() === '' ? null : parseFloat(geofenceLat)
    const lng = geofenceLng.trim() === '' ? null : parseFloat(geofenceLng)
    const radiusM = geofenceRadiusMi.trim() === '' ? null : Math.round(parseFloat(geofenceRadiusMi) * 1609.34)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        business_name: bizName, address, timezone, contact_email: contactEmail,
        geofence_lat: lat, geofence_lng: lng, geofence_radius_m: radiusM,
        require_clockin_photo: requireClockinPhoto,
      }),
    })
    showToast(res.ok ? 'Saved.' : "Couldn't save changes. Check your connection and try again.", res.ok ? 'success' : 'error')
    setClockinTrustSaving(false)
  }

  // JAY-123 — same "own save button" pattern as the labor budget / clock-in
  // trust sections above.
  async function savePtoPolicy() {
    setPtoPolicySaving(true)
    const rate = ptoAccrualRate.trim() === '' ? null : parseFloat(ptoAccrualRate)
    const rolloverCap = ptoRolloverCap.trim() === '' ? null : parseFloat(ptoRolloverCap)
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        business_name: bizName, address, timezone, contact_email: contactEmail,
        pto_accrual_method: ptoAccrualMethod, pto_accrual_rate: rate, pto_rollover_cap: rolloverCap,
      }),
    })
    showToast(res.ok ? 'Saved.' : "Couldn't save changes. Check your connection and try again.", res.ok ? 'success' : 'error')
    setPtoPolicySaving(false)
  }

  async function saveTemplate() {
    setTmplSaving(true)
    const { error } = await supabase.from('onboarding_templates').upsert(
      { user_id: userId, fields, welcome_pack: welcomePack, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    showToast(error ? "Couldn't save changes. Check your connection and try again." : 'Template saved.', error ? 'error' : 'success')
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
    const res = await fetch('/api/settings/delete-account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      setDeleting(false)
      showToast("Couldn't delete your account. Check your connection and try again.", 'error')
      return
    }
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // JAY-55 — dark-theme conversion. Settings was the one page that never got
  // the redesign pass every other page went through (Payroll/Reports/etc.);
  // it was still rendering the shared light-mode `.card` class. This matches
  // the palette already established in payroll/page.tsx.
  const cardStyle: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }
  const labelStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }
  const sectionLabelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.6rem' }
  // Secondary/ghost button — the shared `.btn` class defaults to a white
  // background with no dark-mode override anywhere in globals.css, so every
  // plain `className="btn"` (not `.auth-btn-primary`) needs this inline
  // override here, same treatment Payroll gives its own ghost buttons.
  const ghostBtnStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.12)' }

  // JAY-55 — grouped into sections (General / Team & Access / Billing /
  // Danger zone) instead of one flat undifferentiated row of 9 tabs, per the
  // Linear ticket's mockup. Danger zone is visually distinct (red) even in
  // the tab bar itself, not just on its own page, so it reads as a different
  // class of action before you even click into it.
  const tabGroups: { label: string; tabs: { key: Tab; label: string }[] }[] = [
    { label: 'General', tabs: [{ key: 'account', label: 'Account' }, { key: 'hours', label: 'Hours' }, { key: 'onboarding', label: 'Onboarding' }, { key: 'notifications', label: 'Notifications' }] },
    { label: 'Team & Access', tabs: [{ key: 'team', label: 'Team' }, { key: 'departments', label: 'Departments' }] },
    { label: 'Billing & Tools', tabs: [{ key: 'billing', label: 'Billing' }, { key: 'integrations', label: 'Integrations' }] },
  ]
  const dangerTab: { key: Tab; label: string } = { key: 'danger', label: 'Danger zone' }

  return (
    <div className="dash-wrap">
      <Nav active="settings" />
      <div className="dash-content">
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--text)' }}>Settings</div>

        {/* Tab bar — grouped */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', borderBottom: '1.5px solid rgba(255,255,255,0.08)', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5rem', flexWrap: 'wrap' }}>
            {tabGroups.map(group => (
              <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 2px' }}>{group.label}</div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {group.tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={{
                      padding: '8px 14px', fontSize: '13px', fontWeight: tab === t.key ? 700 : 400,
                      color: tab === t.key ? 'var(--accent)' : 'var(--text-tertiary)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: '-1.5px', transition: 'all 0.15s', fontFamily: 'inherit',
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* Danger zone — isolated on the far side, red-tinted, own group */}
          <button onClick={() => setTab(dangerTab.key)} style={{
            padding: '8px 14px', fontSize: '13px', fontWeight: tab === dangerTab.key ? 700 : 500,
            color: tab === dangerTab.key ? 'var(--error)' : '#b91c1c',
            background: tab === dangerTab.key ? 'rgba(248,113,113,0.1)' : 'none',
            border: '1px solid rgba(248,113,113,0.25)', borderRadius: '7px', cursor: 'pointer',
            marginBottom: '6px', transition: 'all 0.15s', fontFamily: 'inherit',
          }}>{dangerTab.label}</button>
        </div>

        <div style={{ maxWidth: '540px' }}>

          {/* ACCOUNT */}
          {tab === 'account' && (
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Business information</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label style={labelStyle}>Business name</label>
                  <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Acme Coffee Co." />
                </div>
                <div>
                  <label style={labelStyle}>Address</label>
                  <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, City, State" />
                </div>
                <div>
                  <label style={labelStyle}>Contact email</label>
                  <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder={userEmail} />
                </div>
                <div>
                  <label style={labelStyle}>Accountant email</label>
                  <input type="email" value={accountantEmail} onChange={e => setAccountantEmail(e.target.value)} placeholder="accountant@example.com" />
                </div>
                <div>
                  <label style={labelStyle}>Timezone</label>
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
            <div style={cardStyle}>
              <div style={{ ...sectionLabelStyle, marginBottom: '0.25rem' }}>Business hours</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                Set when you're open. These times pre-fill the shift form and bound auto-generated schedules.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {DAY_KEYS.map((day, i) => {
                  const h = bizHours[day]
                  return (
                    <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: i < 6 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <div style={{ width: '96px', fontSize: '13px', fontWeight: 500, color: h.closed ? 'var(--text-tertiary)' : 'var(--text)', flexShrink: 0 }}>{DAY_LABELS[day]}</div>
                      {h.closed ? (
                        <div style={{ flex: 1, fontSize: '13px', color: 'var(--text-tertiary)' }}>Closed</div>
                      ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="time" value={h.open} onChange={e => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))}
                            style={{ width: '120px', fontSize: '13px', padding: '5px 8px', borderRadius: '6px' }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>to</span>
                          <input type="time" value={h.close} onChange={e => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))}
                            style={{ width: '120px', fontSize: '13px', padding: '5px 8px', borderRadius: '6px' }} />
                        </div>
                      )}
                      <button
                        onClick={() => setBizHours(prev => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }))}
                        style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${h.closed ? 'rgba(255,255,255,0.1)' : 'rgba(248,113,113,0.3)'}`, background: h.closed ? 'rgba(255,255,255,0.04)' : 'rgba(248,113,113,0.1)', color: h.closed ? 'var(--text-secondary)' : 'var(--error)', cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}
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

              {/* JAY-54 (prerequisite step) — the missing input a "budget vs. actual"
                  comparison needs. Optional: leaving it blank hides the comparison
                  on the Schedule page rather than showing a false $0 target. */}
              <div style={{ marginTop: '1.75rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.25rem' }}>Weekly labor budget</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  Optional. Set a target and the Schedule page will show projected cost against it. Leave blank to hide the comparison.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '220px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={laborBudget}
                    onChange={e => setLaborBudget(e.target.value)}
                    placeholder="e.g. 3200"
                  />
                </div>
                <button className="btn auth-btn-primary" onClick={saveLaborBudget} disabled={budgetSaving} style={{ marginTop: '1rem', width: 'auto' }}>
                  {budgetSaving ? 'Saving...' : 'Save budget'}
                </button>
              </div>

              {/* JAY-18 — geofence is informational only (never blocks a clock-in);
                  the photo toggle, when on, is enforced server-side. No geocoding
                  integration here — the owner enters coordinates manually. */}
              <div style={{ marginTop: '1.75rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.25rem' }}>Clock-in verification</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  Optional. A geofence shows employees a location check at clock-in — it's advisory only and never blocks anyone from clocking in. Requiring a photo does block clock-in until one is taken.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', maxWidth: '480px', marginBottom: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '3px' }}>Latitude</label>
                    <input type="number" step="any" value={geofenceLat} onChange={e => setGeofenceLat(e.target.value)} placeholder="e.g. 40.7128" />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '3px' }}>Longitude</label>
                    <input type="number" step="any" value={geofenceLng} onChange={e => setGeofenceLng(e.target.value)} placeholder="e.g. -74.0060" />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '3px' }}>Radius (miles)</label>
                    <input type="number" min="0" step="0.1" value={geofenceRadiusMi} onChange={e => setGeofenceRadiusMi(e.target.value)} placeholder="e.g. 0.25" />
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
                  Tip: search your business address on Google Maps, right-click the pin, and copy the coordinates shown.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={requireClockinPhoto} onChange={e => setRequireClockinPhoto(e.target.checked)} style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                  Require a photo at clock-in
                </label>
                <button className="btn auth-btn-primary" onClick={saveClockinTrust} disabled={clockinTrustSaving} style={{ marginTop: '1rem', width: 'auto' }}>
                  {clockinTrustSaving ? 'Saving...' : 'Save'}
                </button>
              </div>

              {/* JAY-123 — PTO accrual policy. 'Flat' keeps existing accounts'
                  behavior unchanged; 'Monthly' prorates from hire date. */}
              <div style={{ marginTop: '1.75rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.25rem' }}>PTO accrual</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  Flat grants the full annual PTO days on day one. Monthly accrual prorates from each employee&apos;s hire date, adding a set number of days each month up to the annual grant.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="radio" name="pto-accrual-method" checked={ptoAccrualMethod === 'flat'} onChange={() => setPtoAccrualMethod('flat')} style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                    Flat annual grant (current)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="radio" name="pto-accrual-method" checked={ptoAccrualMethod === 'monthly'} onChange={() => setPtoAccrualMethod('monthly')} style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                    Monthly accrual
                  </label>
                </div>
                {ptoAccrualMethod === 'monthly' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxWidth: '320px', marginBottom: '0.5rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '3px' }}>Days / month</label>
                      <input type="number" min="0" step="0.25" value={ptoAccrualRate} onChange={e => setPtoAccrualRate(e.target.value)} placeholder="e.g. 1.25" />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '3px' }}>Rollover cap (days)</label>
                      <input type="number" min="0" step="0.5" value={ptoRolloverCap} onChange={e => setPtoRolloverCap(e.target.value)} placeholder="e.g. 5" />
                    </div>
                  </div>
                )}
                <button className="btn auth-btn-primary" onClick={savePtoPolicy} disabled={ptoPolicySaving} style={{ marginTop: '1rem', width: 'auto' }}>
                  {ptoPolicySaving ? 'Saving...' : 'Save PTO policy'}
                </button>
              </div>
            </div>
          )}

          {/* ONBOARDING */}
          {tab === 'onboarding' && (
            <>
              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Onboarding fields</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
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
                  <button className="btn" style={ghostBtnStyle} onClick={() => { if (!newLabel.trim()) return; setFields(prev => [...prev, { id: newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_'), label: newLabel, placeholder: '' }]); setNewLabel('') }}>+ Add</button>
                </div>
                <button className="btn auth-btn-primary" onClick={saveTemplate} disabled={tmplSaving} style={{ marginTop: '1.25rem', width: 'auto' }}>
                  {tmplSaving ? 'Saving...' : 'Save template'}
                </button>
              </div>

              <div style={{ ...cardStyle, marginTop: '1rem' }}>
                <div style={sectionLabelStyle}>Welcome pack template</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Click a tag below to insert it — it will be replaced with the employee's actual info when you send the welcome pack.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {[{ label: 'Name' }, { label: 'Role' }, { label: 'Start date' }, { label: 'Phone' }, ...fields.map(f => ({ label: f.label }))].map(({ label }) => (
                    <button key={label} onClick={() => setWelcomePack(prev => prev + `[${label}]`)}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1.5px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.12)', color: 'var(--accent)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
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
            <div style={cardStyle}>
              <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>Email notifications</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Choose which events send you an email.</div>
              {toggle(notifTimeOff, setNotifTimeOff, 'Employee requests time off', notifSaving, saveNotifs)}
              {toggle(notifFormSubmit, setNotifFormSubmit, 'Employee submits W-4, I-9, or direct deposit form', notifSaving, saveNotifs)}
              {toggle(notifWelcomeSigned, setNotifWelcomeSigned, 'Employee signs their welcome pack', notifSaving, saveNotifs)}
              {toggle(notifNewEmployee, setNotifNewEmployee, 'New employee is added', notifSaving, saveNotifs)}
              {notifSaving && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '0.75rem' }}>Saving...</div>}
            </div>
          )}

          {/* BILLING */}
          {tab === 'billing' && (
            <div>
              {billingLoading || !billing ? (
                <div style={{ ...cardStyle, color: 'var(--text-tertiary)', fontSize: '14px' }}>Loading billing info…</div>
              ) : (
                <>
                  {/* Current plan card */}
                  <div style={cardStyle}>
                    <div style={{ ...sectionLabelStyle, marginBottom: '1rem' }}>Current plan</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', marginBottom: '1.25rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--accent)' }}>{billing.planName}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                          ${billing.planPrice}/mo · {billing.employeeLimit ? `up to ${billing.employeeLimit} employees` : 'unlimited employees'}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', textTransform: 'capitalize',
                        background: billing.status === 'active' ? 'rgba(34,197,94,0.15)' : billing.status === 'trialing' ? 'rgba(217,119,6,0.15)' : billing.status === 'past_due' ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.06)',
                        color: billing.status === 'active' ? 'var(--success)' : billing.status === 'trialing' ? 'var(--amber)' : billing.status === 'past_due' ? 'var(--error)' : 'var(--text-secondary)',
                      }}>
                        {billing.status === 'trialing' ? `Trial · ${billing.trialDaysLeft} days left` : billing.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '24px', marginBottom: '1.25rem' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active employees</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
                          {billing.employeeCount}
                          {billing.employeeLimit && <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 400 }}> / {billing.employeeLimit}</span>}
                        </div>
                      </div>
                      {billing.currentPeriodEnd && (
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next billing date</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
                            {new Date(billing.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      )}
                      {billing.status === 'trialing' && !billing.hasSubscription && (
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trial ends</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--amber)' }}>
                            {new Date(billing.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      )}
                    </div>

                    {billing.hasSubscription && (
                      <button
                        className="btn"
                        style={{ fontSize: '13px', padding: '8px 18px', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)' }}
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
                    <div style={cardStyle}>
                      <div style={{ ...sectionLabelStyle, marginBottom: '1rem' }}>
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
                              border: `1.5px solid ${isPopular ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                              borderRadius: '12px', padding: '20px', position: 'relative',
                              background: isPopular ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)',
                            }}>
                              {isPopular && (
                                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '10px', fontWeight: 700, padding: '2px 10px', borderRadius: '99px', whiteSpace: 'nowrap' }}>
                                  MOST POPULAR
                                </div>
                              )}
                              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px', color: 'var(--text)' }}>{p.name}</div>
                              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)', marginBottom: '2px' }}>${p.price}<span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-tertiary)' }}>/mo</span></div>
                              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '14px' }}>{p.limit}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                                {p.features.map(f => (
                                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    {f}
                                  </div>
                                ))}
                              </div>
                              <button
                                className="btn auth-btn-primary"
                                style={{ width: '100%', fontSize: '13px', padding: '9px', background: isPopular ? 'var(--accent)' : 'rgba(255,255,255,0.08)', opacity: isCurrent ? 0.5 : 1 }}
                                disabled={isCurrent || checkoutLoading === p.key}
                                onClick={async () => {
                                  // JAY-45 — an existing live subscription gets a proration preview +
                                  // confirm modal first (switching in place, no double-billing risk).
                                  // No subscription yet (trial/none) just starts checkout as before.
                                  if (billing.hasSubscription) {
                                    openSwitchModal(p.key, p.name)
                                    return
                                  }
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
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '12px', textAlign: 'center' }}>
                        14-day free trial included · Cancel anytime · No setup fees
                      </div>
                    </div>
                  )}

                  {/* Plan-switch confirm modal (JAY-45) */}
                  {switchTarget && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                      <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '1.5rem', width: '380px', maxWidth: '90vw' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text)' }}>Switch to {switchTarget.name}?</div>
                        {switchPreviewLoading ? (
                          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '1rem 0' }}>Loading preview...</div>
                        ) : switchPreview?.isNewSubscription ? (
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                            This will start a new subscription with a 14-day free trial.
                          </div>
                        ) : switchPreview ? (
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                            <p style={{ margin: '0 0 8px' }}>Your existing subscription updates in place — you won&apos;t be charged twice.</p>
                            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-tertiary)' }}>Due today (prorated)</span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>${((switchPreview.dueTodayCents ?? 0) / 100).toFixed(2)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-tertiary)' }}>Next full charge</span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                                  ${((switchPreview.nextChargeCents ?? 0) / 100).toFixed(2)}
                                  {switchPreview.nextChargeDate && ` on ${new Date(switchPreview.nextChargeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '13px', color: 'var(--error)', marginBottom: '1rem' }}>Could not load a preview. Try again.</div>
                        )}
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className="btn"
                            style={{ ...ghostBtnStyle, flex: 1, fontSize: '13px', padding: '9px' }}
                            onClick={() => { setSwitchTarget(null); setSwitchPreview(null) }}
                            disabled={switchConfirming}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn auth-btn-primary"
                            style={{ flex: 1, fontSize: '13px', padding: '9px' }}
                            onClick={confirmSwitch}
                            disabled={switchConfirming || switchPreviewLoading || !switchPreview}
                          >
                            {switchConfirming ? 'Switching...' : 'Confirm switch'}
                          </button>
                        </div>
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
              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Access levels</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[
                    { label: 'Owner', color: 'var(--accent)', bg: 'rgba(59,130,246,0.15)', desc: 'Full access including billing and account settings. Only one per business.' },
                    { label: 'Admin', color: '#c4b5fd', bg: 'rgba(139,92,246,0.15)', desc: 'Full dashboard access — employees, shifts, payroll, hiring. Cannot delete the account or change billing.' },
                    { label: 'Manager', color: 'var(--amber)', bg: 'rgba(217,119,6,0.15)', desc: 'Can view employees, manage shifts, approve time off and swap requests. No payroll rates or settings.' },
                    { label: 'Employee', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.06)', desc: 'Portal only — their own schedule, clock in/out, PTO requests, shift swaps.' },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: r.bg, color: r.color, flexShrink: 0, minWidth: '60px', textAlign: 'center' }}>{r.label}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Employee list with inline role change */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ ...sectionLabelStyle, marginBottom: 0 }}>
                    Team ({teamEmployees.filter(e => showTerminated || e.status !== 'terminated').length})
                  </div>
                  {teamEmployees.some(e => e.status === 'terminated') && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={showTerminated}
                        onChange={e => setShowTerminated(e.target.checked)}
                        style={{ cursor: 'pointer', width: '14px', height: '14px', flexShrink: 0 }}
                      />
                      Show terminated
                    </label>
                  )}
                </div>
                {teamEmployees.filter(e => showTerminated || e.status !== 'terminated').length === 0 && (
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '8px 0' }}>No employees yet.</div>
                )}
                {teamEmployees.filter(e => showTerminated || e.status !== 'terminated').map(emp => {
                  const roleColors: Record<string, { bg: string; color: string }> = {
                    admin: { bg: 'rgba(139,92,246,0.15)', color: '#c4b5fd' },
                    manager: { bg: 'rgba(217,119,6,0.15)', color: 'var(--amber)' },
                    employee: { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' },
                  }
                  const rc = roleColors[emp.access_role] ?? roleColors.employee
                  const isOpen = permEmployee?.id === emp.id
                  const hasCustom = emp.permissions !== null
                  const isPending = pendingInviteIds.has(emp.id)
                  return (
                    <div key={emp.id}>
                      <div
                        onClick={() => openPermPanel(emp)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: isOpen ? 'none' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(59,130,246,0.15)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
                          {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.email || emp.role}</div>
                        </div>
                        {isPending && (
                          <>
                            <span style={{ fontSize: '10px', color: 'var(--amber)', background: 'rgba(217,119,6,0.15)', padding: '2px 7px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>Not yet accepted</span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); resendInvite(emp.id) }}
                              disabled={resendingId === emp.id}
                              style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, flexShrink: 0 }}
                            >
                              {resendingId === emp.id ? 'Sending…' : 'Resend invite'}
                            </button>
                          </>
                        )}
                        {hasCustom && <span style={{ fontSize: '10px', color: 'var(--accent)', background: 'rgba(59,130,246,0.15)', padding: '2px 7px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>Custom</span>}
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: rc.bg, color: rc.color, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {emp.access_role}
                        </span>
                        <select
                          value={emp.access_role}
                          disabled={roleUpdating === emp.id}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); updateEmployeeRole(emp.id, e.target.value) }}
                          style={{ fontSize: '12px', padding: '4px 7px', borderRadius: '6px', cursor: 'pointer', flexShrink: 0, width: 'auto' }}
                        >
                          <option value="employee">Employee</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                      </div>

                      {/* Inline permission panel */}
                      {isOpen && (
                        <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Apply preset:</span>
                            {(['employee','manager','admin'] as const).map(r => (
                              <button type="button" key={r} onClick={() => applyRolePreset(r)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{r}</button>
                            ))}
                          </div>
                          {(['Scheduling','Employees','Time off','Payroll','Hiring'] as const).map(section => (
                            <div key={section}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 0 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>{section}</div>
                              {PERM_KEYS.filter(k => PERM_META[k].section === section).map(key => (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', gap: 8 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text)' }}>{PERM_META[key].label}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{PERM_META[key].sub}</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPermValues(prev => ({ ...prev, [key]: !prev[key] }))}
                                    style={{ width: 38, height: 21, borderRadius: 11, border: 'none', cursor: 'pointer', background: permValues[key] ? 'var(--accent)' : 'rgba(255,255,255,0.12)', position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}
                                  >
                                    <span style={{ position: 'absolute', top: 3, left: permValues[key] ? 19 : 3, width: 15, height: 15, borderRadius: '50%', background: 'var(--accent-text)', transition: 'left 0.15s', display: 'block' }} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ))}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
                            <button className="btn auth-btn-primary" onClick={savePermissions} disabled={permSaving} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                              {permSaving ? 'Saving...' : 'Save permissions'}
                            </button>
                            {permSaved && <span style={{ fontSize: '12px', color: 'var(--success)' }}>Saved.</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Invite new person */}
              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>Invite someone new</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
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
              <div style={{ ...cardStyle, marginTop: '1rem' }}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>Share a join link</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Don't have their email handy? Share this link and let them fill in their own name, email, and phone. They'll show up here as pending — assign their role afterward.
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input readOnly value={joinLink} onClick={e => (e.target as HTMLInputElement).select()} style={{ flex: 1, minWidth: '200px', fontSize: '13px', color: 'var(--text-secondary)' }} />
                  <button
                    className="btn"
                    style={{ ...ghostBtnStyle, width: 'auto', fontSize: '13px', padding: '7px 16px' }}
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
              <div style={{ ...cardStyle, marginBottom: '1rem' }}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Departments</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Group your team by department. Assign employees in their profile.
                </div>
                {departments.length === 0 && (
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '8px 0', marginBottom: '0.75rem' }}>No departments yet.</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {departments.map((dept, i) => (
                    <div key={dept.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: i < departments.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: dept.color, flexShrink: 0 }} />
                      {editingDept === dept.id ? (
                        <>
                          <input value={editDeptName} onChange={e => setEditDeptName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveDeptName(dept.id); if (e.key === 'Escape') setEditingDept(null) }} style={{ flex: 1, fontSize: '13px', padding: '4px 8px' }} autoFocus />
                          <button className="btn auth-btn-primary" style={{ fontSize: '12px', padding: '4px 10px', width: 'auto' }} onClick={() => saveDeptName(dept.id)}>Save</button>
                          <button className="btn" style={{ ...ghostBtnStyle, fontSize: '12px', padding: '4px 10px' }} onClick={() => setEditingDept(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{dept.name}</span>
                          <button onClick={() => { setEditingDept(dept.id); setEditDeptName(dept.name) }} style={{ fontSize: '12px', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Rename</button>
                          <button onClick={() => deleteDept(dept.id)} style={{ fontSize: '12px', color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Delete</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Add department</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="e.g. Kitchen" onKeyDown={e => e.key === 'Enter' && createDept()} style={{ flex: 1, minWidth: '140px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Color</label>
                    <input type="color" value={newDeptColor} onChange={e => setNewDeptColor(e.target.value)} style={{ width: 32, height: 32, padding: 2, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer' }} />
                  </div>
                  <button className="btn auth-btn-primary" onClick={createDept} disabled={deptSaving || !newDeptName.trim()} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                    {deptSaving ? 'Adding...' : '+ Add'}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Colorblind-safe picks:</span>
                  {COLORBLIND_SAFE_PALETTE.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewDeptColor(c)}
                      title={c}
                      aria-label={`Use color ${c}`}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                        border: newDeptColor === c ? '2px solid var(--text)' : '1px solid rgba(255,255,255,0.15)',
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
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)', marginBottom: '0.5rem' }}>Export your data</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Download all your employees, payroll entries, and shifts as a JSON file.
                </div>
                <button className="btn" onClick={exportData} disabled={exporting} style={{ ...ghostBtnStyle, width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                  {exporting ? 'Preparing...' : 'Export data'}
                </button>
              </div>

              {/* JAY-55 — visually isolate the destructive action: red-tinted
                  background/border, distinct from the plain-dark card above. */}
              <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '12px', padding: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--error)', marginBottom: '0.5rem' }}>Delete account</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  This permanently deletes your account and all data. Type your email address to confirm.
                </div>
                <input
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder={userEmail}
                  style={{ marginBottom: '0.75rem', borderColor: deleteConfirm && deleteConfirm !== userEmail ? 'var(--error)' : undefined }}
                />
                <button
                  onClick={deleteAccount}
                  disabled={deleteConfirm !== userEmail || deleting}
                  style={{
                    width: 'auto', fontSize: '13px', padding: '7px 16px',
                    background: deleteConfirm === userEmail ? 'var(--error)' : 'rgba(255,255,255,0.05)',
                    color: deleteConfirm === userEmail ? '#1e1e1e' : 'var(--text-tertiary)',
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
  const cardStyle: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem' }
  const ghostBtnStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.12)' }
  const { showToast } = useToast()
  // JAY-46 — last_synced_at/last_sync_summary persist sync outcome across
  // page loads (previously only a one-time toast, gone on refresh).
  type SyncStatus = { last_synced_at: string | null; last_sync_summary: { count: number; errors: number; label: string } | null }
  const [gusto, setGusto] = useState<({ company_uuid: string | null; connected_at: string } & SyncStatus) | null>(null)
  const [google, setGoogle] = useState<({ connected_at: string } & SyncStatus) | null>(null)
  const [qb, setQb] = useState<({ realm_id: string; connected_at: string } & SyncStatus) | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setAccessToken(session.access_token)
      const uid = session.user.id
      await reloadConnections(uid)
      setLoading(false)
    })
  }, [])

  async function reloadConnections(uid: string) {
    const [g, gc, qbr] = await Promise.all([
      supabase.from('gusto_connections').select('company_uuid, connected_at, last_synced_at, last_sync_summary').eq('user_id', uid).single(),
      supabase.from('google_connections').select('connected_at, last_synced_at, last_sync_summary').eq('user_id', uid).single(),
      supabase.from('quickbooks_connections').select('realm_id, connected_at, last_synced_at, last_sync_summary').eq('user_id', uid).single(),
    ])
    if (g.data) setGusto(g.data)
    if (gc.data) setGoogle(gc.data)
    if (qbr.data) setQb(qbr.data)
  }

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
    // JAY-46 — refresh last_synced_at/last_sync_summary so the new status
    // line reflects this sync immediately, not just the one-time toast.
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await reloadConnections(session.user.id)
    setSyncing(null)
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  function syncStatusLine(status: SyncStatus) {
    if (!status.last_synced_at || !status.last_sync_summary) return null
    const { count, errors, label } = status.last_sync_summary
    return (
      <div style={{ fontSize: '12px', color: errors > 0 ? 'var(--error)' : 'var(--success)', background: errors > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)', padding: '6px 10px', borderRadius: '6px', marginBottom: '0.75rem' }}>
        Last synced {fmtDateTime(status.last_synced_at)} — {count} {label}{errors > 0 ? `, ${errors} error${errors !== 1 ? 's' : ''}` : ''}
      </div>
    )
  }
  const connectedBadge = <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: 'rgba(74,222,128,0.15)', color: 'var(--success)' }}>● Connected</span>
  const notConnectedBadge = <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)' }}>○ Not connected</span>

  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Connect your tools to keep data in sync.</div>
      <div style={{ display: 'grid', gap: '1rem', maxWidth: '560px' }}>

        {/* Gusto */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(192,105,43,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ReceiptIcon size={18} color="#e0925a" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>Gusto</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Payroll &amp; HR</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{gusto ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Loading...</div> : gusto ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>Connected {fmtDate(gusto.connected_at)}</div>
              {syncStatusLine(gusto)}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_employees', '/api/gusto/sync', { action: 'push_employees' })} disabled={!!syncing}>{syncing === 'push_employees' ? 'Syncing…' : '↑ Push employees'}</button>
                <button className="btn" style={{ ...ghostBtnStyle, fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('pull_payrolls', '/api/gusto/sync', { action: 'pull_payrolls' })} disabled={!!syncing}>{syncing === 'pull_payrolls' ? 'Importing…' : '↓ Pull payrolls'}</button>
              </div>
              <button style={{ fontSize: '12px', color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('gusto')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('gusto')}>Connect Gusto</button>}
        </div>

        {/* Google Calendar */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(26,115,232,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CalendarIcon size={18} color="var(--accent)" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>Google Calendar</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Schedule sync</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{google ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Loading...</div> : google ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>Connected {fmtDate(google.connected_at)}</div>
              {syncStatusLine(google)}
              <div style={{ marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_shifts', '/api/google/sync', {})} disabled={!!syncing}>{syncing === 'push_shifts' ? 'Syncing…' : '↑ Push this week\'s shifts'}</button>
              </div>
              <button style={{ fontSize: '12px', color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('google')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('google')}>Connect Google Calendar</button>}
        </div>

        {/* QuickBooks */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(46,125,50,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><BookOpenIcon size={18} color="var(--success)" /></div>
            <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>QuickBooks</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Accounting sync</div></div>
            {!loading && <div style={{ marginLeft: 'auto' }}>{qb ? connectedBadge : notConnectedBadge}</div>}
          </div>
          {loading ? <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Loading...</div> : qb ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>Connected {fmtDate(qb.connected_at)}</div>
              {syncStatusLine(qb)}
              <div style={{ marginBottom: '0.75rem' }}>
                <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 14px' }} onClick={() => sync('push_payroll', '/api/quickbooks/sync', {})} disabled={!!syncing}>{syncing === 'push_payroll' ? 'Syncing…' : '↑ Push this month\'s payroll'}</button>
              </div>
              <button style={{ fontSize: '12px', color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => handleDisconnect('quickbooks')}>Disconnect</button>
            </>
          ) : <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => handleConnect('quickbooks')}>Connect QuickBooks</button>}
        </div>

        {/* Indeed */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.75rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(230,81,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1.5" fill="var(--amber)" stroke="none"/><line x1="12" y1="9" x2="12" y2="20"/><path d="M8 20h8"/></svg>
            </div>
            <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>Indeed</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Job board publishing</div></div>
            <div style={{ marginLeft: 'auto' }}><span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: 'rgba(251,191,36,0.15)', color: 'var(--amber)' }}>Via Hiring page</span></div>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: '1.5' }}>Post jobs to Indeed directly from the Hiring page.</div>
          <a href="/hiring" className="btn" style={{ ...ghostBtnStyle, width: 'auto', fontSize: '13px', padding: '7px 16px', display: 'inline-block', textDecoration: 'none' }}>Go to Hiring →</a>
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
