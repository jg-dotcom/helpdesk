'use client'

import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { isValidRoutingNumber } from '../../../lib/routingNumber'

type Props = {
  token: string
  employeeId: number
  userId: string
  onComplete?: () => void
}

export default function DirectDepositForm({ token, employeeId, userId, onComplete }: Props) {
  const { showToast } = useToast()
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    bankName: '',
    accountType: 'checking',
    routingNumber: '',
    accountNumber: '',
    confirmAccountNumber: '',
  })

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    if (!form.bankName || !form.routingNumber || !form.accountNumber) {
      showToast('Please fill out all required fields.', 'error')
      return
    }
    if (form.routingNumber.length !== 9 || !/^\d+$/.test(form.routingNumber)) {
      showToast('Routing number must be 9 digits.', 'error')
      return
    }
    if (!isValidRoutingNumber(form.routingNumber)) {
      showToast("This doesn't look like a valid routing number — please double-check with your bank.", 'error')
      return
    }
    if (form.accountNumber !== form.confirmAccountNumber) {
      showToast('Account numbers do not match.', 'error')
      return
    }
    setSaving(true)
    const res = await fetch(`/api/sign/${token}/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'direct_deposit',
        formData: {
          bankName: form.bankName,
          accountType: form.accountType,
          routingNumber: form.routingNumber,
          accountNumber: form.accountNumber,
        },
        employeeId,
        userId,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      showToast(data.error || 'Could not save. Try again.', 'error')
    } else {
      setSubmitted(true)
      setTimeout(() => onComplete?.(), 1200)
    }
    setSaving(false)
  }

  if (submitted) {
    return <div className="done-msg" style={{ padding: '0.75rem 0' }}>✓ Direct deposit info submitted.</div>
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '1rem' }}>
        Enter your bank account information to receive your pay via direct deposit.
        Your information is encrypted and transmitted securely.
      </p>

      <div className="field">
        <label>Bank name <span style={{ color: '#c0392b' }}>*</span></label>
        <input value={form.bankName} onChange={e => set('bankName', e.target.value)} placeholder="Chase, Wells Fargo, etc." />
      </div>

      <div className="field">
        <label>Account type <span style={{ color: '#c0392b' }}>*</span></label>
        <select value={form.accountType} onChange={e => set('accountType', e.target.value)}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </div>

      <div className="field">
        <label>Routing number <span style={{ color: '#c0392b' }}>*</span></label>
        <input
          value={form.routingNumber}
          onChange={e => set('routingNumber', e.target.value.replace(/\D/g, '').slice(0, 9))}
          placeholder="9-digit routing number"
          inputMode="numeric"
          maxLength={9}
        />
        {form.routingNumber.length === 9 ? (
          isValidRoutingNumber(form.routingNumber) ? (
            <div style={{ fontSize: '11px', color: '#27ae60', marginTop: '4px' }}>✓ Valid routing number</div>
          ) : (
            <div style={{ fontSize: '11px', color: '#c0392b', marginTop: '4px' }}>✗ This doesn&apos;t look like a valid routing number — please double-check with your bank</div>
          )
        ) : (
          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>Found at the bottom-left of a check</div>
        )}
      </div>

      <div className="field">
        <label>Account number <span style={{ color: '#c0392b' }}>*</span></label>
        <input
          value={form.accountNumber}
          onChange={e => set('accountNumber', e.target.value.replace(/\D/g, ''))}
          placeholder="Account number"
          inputMode="numeric"
          type="password"
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Confirm account number <span style={{ color: '#c0392b' }}>*</span></label>
        <input
          value={form.confirmAccountNumber}
          onChange={e => set('confirmAccountNumber', e.target.value.replace(/\D/g, ''))}
          placeholder="Re-enter account number"
          inputMode="numeric"
          type="password"
          autoComplete="off"
        />
      </div>

      <button className="btn auth-btn-primary" style={{ width: 'auto', marginTop: '0.5rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Submitting...' : 'Submit direct deposit'}
      </button>
    </div>
  )
}
