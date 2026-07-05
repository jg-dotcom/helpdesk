'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Props = {
  employeeId: number
  i9Status: string
  w4Status: string
  directDepositStatus: string
  welcomePackSent: boolean
  documentsSigned: boolean
  onUpdate: (field: 'i9_status' | 'w4_status' | 'direct_deposit_status', value: string) => void
}

type Item = {
  key: string
  label: string
  description: string
  checked: boolean
  field?: 'i9_status' | 'w4_status' | 'direct_deposit_status'
}

export default function ComplianceChecklist({
  employeeId, i9Status, w4Status, directDepositStatus, welcomePackSent, documentsSigned, onUpdate
}: Props) {
  const [saving, setSaving] = useState<string | null>(null)

  async function markManually(field: 'i9_status' | 'w4_status' | 'direct_deposit_status', current: string) {
    const next = current === 'complete' ? 'pending' : 'complete'
    setSaving(field)
    await supabase.from('employees').update({ [field]: next }).eq('id', employeeId)
    onUpdate(field, next)
    setSaving(null)
  }

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
      <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '0.75rem' }}>
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
                <span style={{ fontSize: '11px', color: '#27ae60', fontWeight: 500 }}>
                  {item.field ? 'via portal' : 'auto'}
                </span>
              ) : item.field ? (
                <button
                  onClick={() => markManually(item.field!, currentStatus(item.field))}
                  disabled={saving === item.field}
                  style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid #d0d5e8', background: '#f5f6fa',
                    color: '#555', cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  {saving === item.field ? '...' : 'Mark received'}
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: '#c0c0c0' }}>pending</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
