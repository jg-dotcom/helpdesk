'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate as sharedFormatDate } from '../../lib/formatDate'

type Props = {
  employeeId: number
  i9Status: string
  w4Status: string
  directDepositStatus: string
  welcomePackSent: boolean
  documentsSigned: boolean
  onUpdate: (field: 'i9_status' | 'w4_status' | 'direct_deposit_status', value: string) => void
  // JAY-13 — optional work-authorization reverification date, only relevant
  // for employees with time-limited work authorization (visas, EADs). Most
  // employees will never have this set, which is fine — it's opt-in per
  // employee, not a required field.
  workAuthExpiresOn?: string | null
  onUpdateExpiration?: (value: string | null) => void
}

type Item = {
  key: string
  label: string
  description: string
  checked: boolean
  field?: 'i9_status' | 'w4_status' | 'direct_deposit_status'
}

export default function ComplianceChecklist({
  employeeId, i9Status, w4Status, directDepositStatus, welcomePackSent, documentsSigned, onUpdate,
  workAuthExpiresOn, onUpdateExpiration,
}: Props) {
  const [saving, setSaving] = useState<string | null>(null)
  // JAY-13 — inline editor for the expiration date, mirroring the "edit one
  // field, save immediately" pattern markManually already uses below.
  const [editingExpiration, setEditingExpiration] = useState(false)
  const [expirationDraft, setExpirationDraft] = useState(workAuthExpiresOn ?? '')
  const [savingExpiration, setSavingExpiration] = useState(false)

  async function markManually(field: 'i9_status' | 'w4_status' | 'direct_deposit_status', current: string) {
    const next = current === 'complete' ? 'pending' : 'complete'
    setSaving(field)
    await supabase.from('employees').update({ [field]: next }).eq('id', employeeId)
    onUpdate(field, next)
    setSaving(null)
  }

  async function saveExpiration() {
    setSavingExpiration(true)
    const value = expirationDraft.trim() || null
    await supabase.from('employees').update({ work_auth_expires_on: value }).eq('id', employeeId)
    onUpdateExpiration?.(value)
    setSavingExpiration(false)
    setEditingExpiration(false)
  }

  // Advisory only — surfaced here and on the Dashboard needs-attention card,
  // never blocks anything (unlike an actual legal reverification deadline,
  // which requires a human to act, not the app to lock someone out).
  const daysUntilExpiration = workAuthExpiresOn
    ? Math.ceil((new Date(workAuthExpiresOn + 'T00:00:00').getTime() - Date.now()) / 86400000)
    : null
  const expirationSoon = daysUntilExpiration !== null && daysUntilExpiration <= 90

  const items: Item[] = [
    {
      key: 'welcome',
      label: 'Welcome pack sent',
      description: 'Onboarding link generated and sent to employee',
      checked: welcomePackSent,
    },
    {
      key: 'w4',
      label: 'W-4 completed',
      description: 'Tax withholding form submitted',
      checked: w4Status === 'complete',
      field: 'w4_status',
    },
    {
      key: 'i9',
      label: 'I-9 completed',
      description: 'Work authorization verified',
      checked: i9Status === 'complete',
      field: 'i9_status',
    },
    {
      key: 'direct_deposit',
      label: 'Direct deposit set up',
      description: 'Bank account info collected for payroll',
      checked: directDepositStatus === 'complete',
      field: 'direct_deposit_status',
    },
    {
      key: 'signed',
      label: 'Agreement signed',
      description: 'Employee reviewed and signed their welcome pack',
      checked: documentsSigned,
    },
  ]

  const completed = items.filter(i => i.checked).length
  const currentStatus = (f: Item['field']) => {
    if (f === 'w4_status') return w4Status
    if (f === 'i9_status') return i9Status
    if (f === 'direct_deposit_status') return directDepositStatus
    return 'pending'
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div className="emp-panel-section" style={{ margin: 0 }}>Onboarding status</div>
        <span className={`badge ${completed === items.length ? 'badge-green' : completed === 0 ? 'badge-red' : 'badge-yellow'}`}>
          {completed}/{items.length} complete
        </span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>
        Auto-updates when employee submits via portal. Use "Mark received" for paper forms.
      </div>
      <div className="compliance-list">
        {items.map(item => (
          <div key={item.key} className="compliance-item" style={{ alignItems: 'center' }}>
            <div className={`compliance-check${item.checked ? ' checked' : ''}`}>
              {item.checked && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20,6 9,17 4,12" />
                </svg>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div className="compliance-label">{item.label}</div>
              <div className="compliance-desc">{item.description}</div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: '0.5rem' }}>
              {item.checked ? (
                <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 500 }}>
                  {item.field ? 'via portal' : 'auto'}
                </span>
              ) : item.field ? (
                <button
                  onClick={() => markManually(item.field!, currentStatus(item.field))}
                  disabled={saving === item.field}
                  style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                    color: 'var(--text-tertiary)', cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  {saving === item.field ? '...' : 'Mark received'}
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>pending</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* JAY-13 — work-authorization reverification date. Only meaningful once
          I-9 is complete; opt-in per employee (most won't have time-limited
          authorization at all), so this stays collapsed unless a date is
          already set or the owner explicitly adds one. */}
      {i9Status === 'complete' && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          {editingExpiration ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="date"
                value={expirationDraft}
                onChange={e => setExpirationDraft(e.target.value)}
                style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
              <button
                onClick={saveExpiration}
                disabled={savingExpiration}
                style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontWeight: 500 }}
              >
                {savingExpiration ? '...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingExpiration(false); setExpirationDraft(workAuthExpiresOn ?? '') }}
                style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--accent-text)', color: 'var(--text-tertiary)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          ) : workAuthExpiresOn ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: expirationSoon ? 'var(--error)' : 'var(--text-tertiary)' }}>
                Work authorization expires: {sharedFormatDate(workAuthExpiresOn, 'short')}
                {expirationSoon && ` (${daysUntilExpiration! < 0 ? 'expired' : `${daysUntilExpiration} days`})`}
              </span>
              <button onClick={() => setEditingExpiration(true)} style={{ fontSize: '11px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
            </div>
          ) : (
            <button onClick={() => setEditingExpiration(true)} style={{ fontSize: '11px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              + Add work authorization expiration date
            </button>
          )}
        </div>
      )}
    </div>
  )
}
