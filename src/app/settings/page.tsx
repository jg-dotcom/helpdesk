'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import DocumentLibrary from '../components/DocumentLibrary'
import { Suspense } from 'react'

type Tab = 'account' | 'onboarding' | 'notifications' | 'billing' | 'team' | 'danger'

type Field = { id: string; label: string; placeholder: string }
const DEFAULT_FIELDS: Field[] = [
  { id: 'startTime', label: 'Start time', placeholder: 'e.g. 9:00 AM' },
  { id: 'reportTo', label: 'Reports to', placeholder: 'e.g. Store manager' },
  { id: 'payRate', label: 'Pay rate', placeholder: 'e.g. $15/hr' },
  { id: 'dresscode', label: 'Dress code', placeholder: 'e.g. Black shirt, jeans' },
]

type TeamMember = {
  id: number
  member_email: string
  role: string
  invited_at: string
  accepted_at: string | null
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
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) ?? 'account'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [userId, setUserId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userEmail, setUserEmail] = useState('')

  // Account
  const [bizName, setBizName] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [contactEmail, setContactEmail] = useState('')
  const [acctSaving, setAcctSaving] = useState(false)
  const [acctMsg, setAcctMsg] = useState('')

  // Onboarding template
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS)
  const [welcomePack, setWelcomePack] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [tmplSaving, setTmplSaving] = useState(false)
  const [tmplMsg, setTmplMsg] = useState('')

  // Notifications
  const [notifTimeOff, setNotifTimeOff] = useState(true)
  const [notifFormSubmit, setNotifFormSubmit] = useState(true)
  const [notifWelcomeSigned, setNotifWelcomeSigned] = useState(true)
  const [notifNewEmployee, setNotifNewEmployee] = useState(true)
  const [notifSaving, setNotifSaving] = useState(false)

  // Team
  const [members, setMembers] = useState<TeamMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager'>('manager')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')

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

    const [bizRes, tmplRes, notifRes, teamRes] = await Promise.all([
      fetch('/api/settings/business', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      supabase.from('onboarding_templates').select('fields, welcome_pack').eq('user_id', session.user.id).single(),
      fetch('/api/settings/notifications', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      fetch('/api/team/invite', { headers: { Authorization: `Bearer ${session.access_token}` } }),
    ])

    const bizData = await bizRes.json()
    if (bizData.profile) {
      setBizName(bizData.profile.business_name ?? '')
      setAddress(bizData.profile.address ?? '')
      setTimezone(bizData.profile.timezone ?? 'America/New_York')
      setContactEmail(bizData.profile.contact_email ?? '')
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

    const teamData = await teamRes.json()
    if (teamData.members) setMembers(teamData.members)
  }

  async function saveAccount() {
    setAcctSaving(true)
    setAcctMsg('')
    const res = await fetch('/api/settings/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_name: bizName, address, timezone, contact_email: contactEmail }),
    })
    setAcctMsg(res.ok ? 'Saved.' : 'Error saving.')
    setAcctSaving(false)
    setTimeout(() => setAcctMsg(''), 2000)
  }

  async function saveTemplate() {
    setTmplSaving(true)
    setTmplMsg('')
    const { error } = await supabase.from('onboarding_templates').upsert(
      { user_id: userId, fields, welcome_pack: welcomePack, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setTmplMsg(error ? 'Error saving.' : 'Template saved.')
    setTmplSaving(false)
    setTimeout(() => setTmplMsg(''), 2000)
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

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteMsg('')
    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json()
    if (!res.ok) {
      setInviteMsg(data.error)
    } else {
      setInviteMsg(`Invite sent to ${inviteEmail}.`)
      setInviteEmail('')
      load()
    }
    setInviting(false)
    setTimeout(() => setInviteMsg(''), 3000)
  }

  async function removeTeamMember(id: number) {
    await fetch('/api/team/invite', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ memberId: id }),
    })
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  async function exportData() {
    setExporting(true)
    window.location.href = `/api/settings/export?token=${accessToken}`
    setTimeout(() => setExporting(false), 2000)
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
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'billing', label: 'Billing' },
    { key: 'team', label: 'Team' },
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
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Timezone</label>
                  <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ width: '100%' }}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn auth-btn-primary" onClick={saveAccount} disabled={acctSaving} style={{ marginTop: '1.25rem', width: 'auto' }}>
                {acctSaving ? 'Saving...' : 'Save'}
              </button>
              {acctMsg && <div className="done-msg" style={{ marginTop: '0.5rem' }}>{acctMsg}</div>}
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
                {tmplMsg && <div className="done-msg">{tmplMsg}</div>}
              </div>

              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="section-label">Welcome pack template</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Use <strong>{'{{employee_name}}'}</strong>, <strong>{'{{startTime}}'}</strong>, etc. — filled in automatically when you onboard someone.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {[{ id: 'employee_name', label: 'Name' }, { id: 'role', label: 'Role' }, { id: 'start', label: 'Start date' }, { id: 'phone', label: 'Phone' }, ...fields.map(f => ({ id: f.id, label: f.label }))].map(({ id, label }) => (
                    <button key={id} onClick={() => setWelcomePack(prev => prev + `{{${id}}}`)}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1.5px solid #d0d5e8', background: '#f4f6fc', color: '#185fa5', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <textarea value={welcomePack} onChange={e => setWelcomePack(e.target.value)} placeholder={`Hi {{employee_name}},\n\nWelcome to the team!...`} style={{ minHeight: '200px', fontFamily: 'inherit', fontSize: '14px' }} />
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
            <div className="card">
              <div className="section-label" style={{ marginBottom: '1rem' }}>Subscription & billing</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: '#f7f9fc', borderRadius: '10px', marginBottom: '1.25rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#185fa5' }}>Free plan</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Up to 10 employees · Core features</div>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: '#e8f0fe', color: '#185fa5' }}>Active</span>
              </div>
              <div style={{ fontSize: '13px', color: '#555', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                Upgrade to <strong>Pro</strong> for unlimited employees, priority support, and advanced reporting.
              </div>
              <button
                className="btn auth-btn-primary"
                style={{ width: 'auto', fontSize: '13px', padding: '8px 18px' }}
                onClick={async () => {
                  const { data: { session } } = await supabase.auth.getSession()
                  if (session) window.location.href = `/api/billing/portal?token=${session.access_token}`
                }}
              >
                Manage billing →
              </button>
            </div>
          )}

          {/* TEAM */}
          {tab === 'team' && (
            <div>
              <div className="card">
                <div className="section-label" style={{ marginBottom: '0.5rem' }}>Invite a team member</div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Admins have full access. Managers can view employees and approve time-off but can't change settings.
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com" style={{ flex: 1, minWidth: '180px' }} onKeyDown={e => e.key === 'Enter' && sendInvite()} />
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'manager')} style={{ width: 'auto' }}>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button className="btn auth-btn-primary" onClick={sendInvite} disabled={inviting || !inviteEmail.trim()} style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }}>
                  {inviting ? 'Sending...' : 'Send invite'}
                </button>
                {inviteMsg && <div className={`${inviteMsg.startsWith('Invite') ? 'done-msg' : 'auth-error'}`} style={{ marginTop: '0.5rem', fontSize: '13px' }}>{inviteMsg}</div>}
              </div>

              {members.length > 0 && (
                <div className="card" style={{ marginTop: '1rem' }}>
                  <div className="section-label" style={{ marginBottom: '0.75rem' }}>Team members</div>
                  {members.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 500 }}>{m.member_email}</div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '2px', textTransform: 'capitalize' }}>{m.role}</div>
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
                        background: m.accepted_at ? '#e8f8ef' : '#fff8e1',
                        color: m.accepted_at ? '#27ae60' : '#f59e0b',
                      }}>
                        {m.accepted_at ? 'Active' : 'Pending'}
                      </span>
                      <button onClick={() => removeTeamMember(m.id)} style={{ fontSize: '12px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
