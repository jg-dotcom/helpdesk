'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'
import DocumentUpload from './DocumentUpload'

type Props = {
  employee: Employee
  action: ActionType
  onBack: () => void
  onDocDone: () => void
  userId: string
}

type Field = {
  id: string
  label: string
  placeholder: string
}

const DEFAULT_FIELDS: Field[] = [
  { id: 'startTime', label: 'Start time', placeholder: 'e.g. 9:00 AM' },
  { id: 'reportTo', label: 'Reports to', placeholder: 'e.g. Store manager' },
  { id: 'payRate', label: 'Pay rate', placeholder: 'e.g. $15/hr' },
  { id: 'dresscode', label: 'Dress code', placeholder: 'e.g. Black shirt, jeans' },
]

const titles = { onboarding: 'Welcome pack', checkin: 'Check-in note', offboarding: 'Offboarding' }

const OFFBOARDING_ITEMS = [
  { key: 'keys', label: 'Keys / access cards returned' },
  { key: 'equipment', label: 'Equipment returned (uniform, devices, tools)' },
  { key: 'access', label: 'System access revoked (email, POS, software)' },
  { key: 'paycheck', label: 'Final paycheck processed' },
  { key: 'pto', label: 'Unused PTO paid out (if applicable)' },
  { key: 'exit', label: 'Exit interview completed' },
]

function OffboardingFlow({ employee, userId, onBack }: { employee: Employee; userId: string; onBack: () => void }) {
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('Resignation')
  const [notes, setNotes] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function toggle(key: string) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function complete() {
    setSaving(true)
    await supabase.from('employees').update({ status: 'terminated' }).eq('id', employee.id)
    await supabase.from('documents').insert([{
      type: 'offboarding',
      employee_name: employee.name,
      content: `Last day: ${lastDay || 'Not set'}\nReason: ${reason}\nChecklist: ${OFFBOARDING_ITEMS.map(i => `${i.label}: ${checked[i.key] ? '✓' : '✗'}`).join(', ')}\nNotes: ${notes}`,
      user_id: userId,
    }])
    setSaving(false)
    setDone(true)
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <div style={{ fontSize: '40px', marginBottom: '0.75rem' }}>✓</div>
        <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '0.5rem' }}>Offboarding complete</div>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '1.5rem' }}>
          {employee.name} has been marked as terminated and the offboarding record has been saved.
        </p>
        <button className="btn" onClick={onBack}>← Back to dashboard</button>
      </div>
    )
  }

  return (
    <div>
      <div className="row2" style={{ marginBottom: '0.75rem' }}>
        <div className="field">
          <label>Last day</label>
          <input type="date" value={lastDay} onChange={e => setLastDay(e.target.value)} />
        </div>
        <div className="field">
          <label>Reason for leaving</label>
          <select value={reason} onChange={e => setReason(e.target.value)}>
            <option>Resignation</option>
            <option>Termination</option>
            <option>Layoff</option>
            <option>Seasonal end</option>
            <option>Retirement</option>
            <option>Personal reasons</option>
          </select>
        </div>
      </div>

      <div className="section-label" style={{ marginBottom: '0.75rem' }}>Offboarding checklist</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {OFFBOARDING_ITEMS.map(item => (
          <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem', background: checked[item.key] ? '#f0faf4' : '#fafafa', border: `1px solid ${checked[item.key] ? '#a8dab5' : '#e8eaf0'}`, borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s' }}>
            <input
              type="checkbox"
              checked={!!checked[item.key]}
              onChange={() => toggle(item.key)}
              style={{ width: '16px', height: '16px', flexShrink: 0 }}
            />
            <span style={{ fontSize: '13px', color: checked[item.key] ? '#27ae60' : '#3a3a3a', textDecoration: checked[item.key] ? 'line-through' : 'none' }}>
              {item.label}
            </span>
          </label>
        ))}
      </div>

      <div className="field">
        <label>Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any additional notes about the departure..."
          style={{ minHeight: '80px' }}
        />
      </div>

      <button
        className="btn auth-btn-primary"
        style={{ width: 'auto', background: '#c0392b', marginTop: '0.25rem' }}
        onClick={complete}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Complete offboarding & terminate'}
      </button>
    </div>
  )
}

export default function ActionScreen({ employee, action, onBack, onDocDone, userId }: Props) {
  const [notes, setNotes] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('New job')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')
  const [saved, setSaved] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [employeeEmail, setEmployeeEmail] = useState(employee.email || '')

  const [templateFields, setTemplateFields] = useState<Field[]>(DEFAULT_FIELDS)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [welcomePackTemplate, setWelcomePackTemplate] = useState('')
  const [policies, setPolicies] = useState('')

  useEffect(() => {
    if (action === 'onboarding') loadTemplate()
  }, [action])

  async function loadTemplate() {
    const { data } = await supabase
      .from('onboarding_templates')
      .select('fields, welcome_pack')
      .eq('user_id', userId)
      .single()
    if (data?.fields && data.fields.length > 0) {
      setTemplateFields(data.fields)
    }
    if (data?.welcome_pack) {
      setWelcomePackTemplate(data.welcome_pack)
    }
  }

  function setFieldValue(id: string, value: string) {
    const newValues = { ...fieldValues, [id]: value }
    setFieldValues(newValues)
    if (welcomePackTemplate) {
      setOutput(applyTemplate(welcomePackTemplate, newValues))
    }
  }

  function applyTemplate(template: string, values: Record<string, string>) {
    // Merge employee profile fields so they're available as placeholders too
    const allValues: Record<string, string> = {
      employee_name: employee.name,
      phone: employee.phone || '',
      email: employee.email || '',
      address: employee.address || '',
      emergency_contact: employee.emergency_contact || '',
      ssn_last4: employee.ssn_last4 || '',
      date_of_birth: employee.date_of_birth || '',
      start: employee.start || '',
      role: employee.role || '',
      type: employee.type || '',
      ...values,
    }
    let result = template
    for (const [key, val] of Object.entries(allValues)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || `[${key}]`)
    }
    result = result.replace(/\{\{(\w+)\}\}/g, '[$1]')
    return result
  }

  async function generate() {
    setLoading(true)
    setDoneMsg('')
    setSaved(false)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employee, notes, lastDay, reason }),
      })
      const data = await res.json()
      setOutput(data.text || 'Error generating response.')
    } catch {
      setOutput('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  function copyDoc() {
    navigator.clipboard.writeText(output).then(() => {
      setDoneMsg('Copied to clipboard.')
      setTimeout(() => setDoneMsg(''), 2000)
    })
  }

  async function markDone() {
    if (saved) return
    setSaving(true)
    const { error } = await supabase.from('documents').insert([{
      type: action,
      employee_name: employee.name,
      content: output,
      user_id: userId,
    }])
    if (!error) {
      setSaved(true)
      onDocDone()
    }
    setSaving(false)
    return !error
  }

  async function sendToEmployee() {
    setSending(true)
    setSendError('')
    // Save to records first (silently)
    if (!saved) {
      const ok = await markDone()
      if (!ok) {
        setSendError('Could not save record. Try again.')
        setSending(false)
        return
      }
    }
    // Generate shareable link
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setSendError('You need to be signed in.')
        setSending(false)
        return
      }
      const res = await fetch('/api/onboarding-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          employeeId: employee.id,
          employeeName: employee.name,
          welcomePack: output,
          employeeEmail: employeeEmail.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSendError(data.error || 'Could not create link.')
      } else {
        setLinkUrl(data.url)
      }
    } catch {
      setSendError('Could not create link. Try again.')
    }
    setSending(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(linkUrl).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  if (!action) return null

  return (
    <div className="dash-wrap">
      <div className="dash-nav">
        <div className="dash-nav-left">
          <div className="logo">help<span>desk</span></div>
        </div>
      </div>

      <div className="dash-content">
        <button className="back-btn" onClick={onBack}>← Back to dashboard</button>

        <div className="screen-title">{titles[action]}</div>
        <div className="context-bar">
          For {employee.name} · {employee.role} · {employee.type}
        </div>

        <div className="card">
          {action === 'onboarding' && (
            <div>
              <div className="section-label" style={{ marginBottom: '1rem' }}>
                Position details
                <a href="/settings" style={{ float: 'right', fontWeight: 400, textTransform: 'none', color: '#185fa5', letterSpacing: 'normal' }}>Edit fields</a>
              </div>
              <div className="row2">
                {templateFields.map(field => (
                  <div className="field" key={field.id}>
                    <label>{field.label}</label>
                    <input
                      value={fieldValues[field.id] || ''}
                      onChange={e => setFieldValue(field.id, e.target.value)}
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {action === 'checkin' && (
            <div className="field">
              <label>Quick notes (what happened?)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Always on time, great with customers. Needs to improve inventory accuracy."
              />
            </div>
          )}

          {action === 'offboarding' && (
            <OffboardingFlow employee={employee} userId={userId} onBack={onBack} />
          )}

          {action === 'checkin' && (
            <div className="actions-row">
              <button className="btn" onClick={generate} disabled={loading}>
                {loading ? 'Generating...' : '✦ Generate with AI'}
              </button>
              {loading && <div className="spinner" />}
            </div>
          )}
        </div>

        {action === 'onboarding' && (
          <div className="card">
            <div className="section-label">Welcome pack</div>
            {!welcomePackTemplate && (
              <div className="hist-meta" style={{ marginBottom: '0.75rem' }}>
                No welcome pack template set up yet. <a href="/settings" style={{ color: '#185fa5' }}>Add one in Settings</a> and it will auto-fill here.
              </div>
            )}
            <textarea
              value={output}
              onChange={e => setOutput(e.target.value)}
              placeholder="Fill in the position details above to populate your welcome pack template, or type directly here."
              style={{ minHeight: '260px', fontFamily: 'inherit', fontSize: '14px' }}
            />
            <div className="doc-actions">
              <button className="doc-btn" onClick={copyDoc}>Copy</button>
            </div>

            <DocumentUpload
              employeeId={employee.id}
              employeeName={employee.name}
              userId={userId}
            />

            <div style={{ marginTop: '1.25rem' }}>
              {!linkUrl ? (
                <>
                  <div className="field" style={{ marginBottom: '0.75rem' }}>
                    <label>Employee email <span style={{ color: '#9a9a9a', fontWeight: 400 }}>(optional — leave blank to just get a link)</span></label>
                    <input
                      type="email"
                      value={employeeEmail}
                      onChange={e => setEmployeeEmail(e.target.value)}
                      placeholder="employee@example.com"
                    />
                  </div>
                  <button className="btn" onClick={sendToEmployee} disabled={sending}>
                    {sending ? 'Sending...' : '✉ Send to employee'}
                  </button>
                  {sendError && <div className="auth-error" style={{ marginTop: '0.5rem' }}>{sendError}</div>}
                </>
              ) : (
                <>
                  <div className="share-link-row">
                    <input className="share-link-input" readOnly value={linkUrl} onFocus={e => e.target.select()} />
                    <button className="doc-btn" onClick={copyLink}>{linkCopied ? '✓ Copied' : 'Copy link'}</button>
                  </div>
                  <div className="hist-meta" style={{ marginTop: '0.5rem' }}>
                    Send this link to {employee.name} — they can view the welcome pack and upload their documents. No account needed.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {output && action === 'checkin' && (
          <div className="card">
            <div className="section-label">Generated document</div>
            <div className="output">{output}</div>
            <div className="doc-actions">
              <button className="doc-btn" onClick={copyDoc}>Copy</button>
              <button className="doc-btn" onClick={generate}>Regenerate</button>
              <button className="doc-btn" onClick={markDone} disabled={saving || saved}>
                {saving ? 'Saving...' : saved ? '✓ Saved to records' : 'Save to records'}
              </button>
            </div>
            {doneMsg && <div className="done-msg">{doneMsg}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
