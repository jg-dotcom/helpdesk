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
  onToggle?: () => void
  readOnly?: boolean
}

export default function ComplianceChecklist({
  employeeId, i9Status, w4Status, directDepositStatus, welcomePackSent, documentsSigned, onUpdate
}: Props) {
  const [saving, setSaving] = useState<string | null>(null)

  async function toggle(field: 'i9_status' | 'w4_status' | 'direct_deposit_status', current: string) {
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
      readOnly: true,
    },
    {
      key: 'w4',
      label: 'W-4 completed',
      description: 'Tax withholding form collected before first paycheck',
      checked: w4Status === 'complete',
      onToggle: () => toggle('w4_status', w4Status),
    },
    {
      key: 'i9',
      label: 'I-9 completed',
      description: 'Work authorization verified within 3 days of start',
      checked: i9Status === 'complete',
      onToggle: () => toggle('i9_status', i9Status),
    },
    {
      key: 'direct_deposit',
      label: 'Direct deposit set up',
      description: 'Bank account info collected for payroll',
      checked: directDepositStatus === 'complete',
      onToggle: () => toggle('direct_deposit_status', directDepositStatus),
    },
    {
      key: 'signed',
      label: 'Agreement signed',
      description: 'Employee reviewed documents and signed off on their paperwork',
      checked: documentsSigned,
      readOnly: true,
    },
  ]

  const completed = items.filter(i => i.checked).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div className="emp-panel-section" style={{ margin: 0 }}>Compliance</div>
        <span className={`badge ${completed === items.length ? 'badge-green' : completed === 0 ? 'badge-red' : 'badge-yellow'}`}>
          {completed}/{items.length} complete
        </span>
      </div>
      <div className="compliance-list">
        {items.map(item => (
          <div
            key={item.key}
            className={`compliance-item${item.onToggle && !item.readOnly ? ' clickable' : ''}`}
            onClick={item.onToggle && saving !== item.key ? item.onToggle : undefined}
          >
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
            {item.readOnly && (
              <span style={{ fontSize: '11px', color: '#9a9a9a' }}>auto</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
