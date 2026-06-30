'use client'

import { useState } from 'react'

type Props = {
  token: string
  employeeId: number
  userId: string
  defaultName?: string
}

export default function W4Form({ token, employeeId, userId, defaultName }: Props) {
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    firstName: defaultName?.split(' ')[0] || '',
    lastName: defaultName?.split(' ').slice(1).join(' ') || '',
    ssn: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    filingStatus: 'single',
    multipleJobs: false,
    dependentsAmount: '',
    otherIncome: '',
    deductions: '',
    extraWithholding: '',
    exempt: false,
  })

  function set(field: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    if (!form.firstName || !form.lastName || !form.ssn || !form.address || !form.filingStatus) {
      setError('Please fill out all required fields.')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/sign/${token}/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType: 'w4', formData: form, employeeId, userId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Could not save. Try again.')
    } else {
      setSubmitted(true)
    }
    setSaving(false)
  }

  if (submitted) {
    return <div className="done-msg" style={{ padding: '0.75rem 0' }}>✓ W-4 submitted successfully.</div>
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '1rem' }}>
        Complete your federal tax withholding form. This tells your employer how much federal income tax to withhold from your paycheck.
      </p>

      <div className="row2">
        <div className="field">
          <label>First name <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Jane" />
        </div>
        <div className="field">
          <label>Last name <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Smith" />
        </div>
      </div>

      <div className="field">
        <label>Social Security Number <span style={{ color: '#c0392b' }}>*</span></label>
        <input value={form.ssn} onChange={e => set('ssn', e.target.value)} placeholder="XXX-XX-XXXX" maxLength={11} />
      </div>

      <div className="field">
        <label>Home address <span style={{ color: '#c0392b' }}>*</span></label>
        <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" />
      </div>

      <div className="row2">
        <div className="field">
          <label>City <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Springfield" />
        </div>
        <div className="field">
          <label>State</label>
          <input value={form.state} onChange={e => set('state', e.target.value)} placeholder="IL" maxLength={2} />
        </div>
      </div>

      <div className="field">
        <label>ZIP code</label>
        <input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="62701" maxLength={10} />
      </div>

      <div className="field">
        <label>Filing status <span style={{ color: '#c0392b' }}>*</span></label>
        <select value={form.filingStatus} onChange={e => set('filingStatus', e.target.value)}>
          <option value="single">Single or Married filing separately</option>
          <option value="married">Married filing jointly</option>
          <option value="head">Head of household</option>
        </select>
      </div>

      <div style={{ background: '#f8f9fb', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem', border: '1px solid #e8eaf0' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem' }}>Step 2 — Multiple jobs (optional)</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', width: '100%' }}>
          <input type="checkbox" checked={form.multipleJobs} onChange={e => set('multipleJobs', e.target.checked)} style={{ marginTop: '2px', flexShrink: 0, width: '16px', height: '16px' }} />
          <span style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.5, flex: 1, minWidth: 0 }}>
            I have more than one job at a time, or my spouse also works.
          </span>
        </label>
      </div>

      <div style={{ background: '#f8f9fb', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem', border: '1px solid #e8eaf0' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem' }}>Step 3 — Dependents (optional)</div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Total dependent tax credit amount ($)</label>
          <input type="number" value={form.dependentsAmount} onChange={e => set('dependentsAmount', e.target.value)} placeholder="0" step="0.01" />
          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>$2,000 per child under 17; $500 per other dependent</div>
        </div>
      </div>

      <div style={{ background: '#f8f9fb', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem', border: '1px solid #e8eaf0' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem' }}>Step 4 — Other adjustments (optional)</div>
        <div className="field">
          <label>Other income not from jobs ($)</label>
          <input type="number" value={form.otherIncome} onChange={e => set('otherIncome', e.target.value)} placeholder="0" step="0.01" />
        </div>
        <div className="field">
          <label>Deductions ($)</label>
          <input type="number" value={form.deductions} onChange={e => set('deductions', e.target.value)} placeholder="0" step="0.01" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Extra withholding per pay period ($)</label>
          <input type="number" value={form.extraWithholding} onChange={e => set('extraWithholding', e.target.value)} placeholder="0" step="0.01" />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem', cursor: 'pointer', width: '100%' }}>
        <input type="checkbox" checked={form.exempt} onChange={e => set('exempt', e.target.checked)} style={{ marginTop: '2px', flexShrink: 0, width: '16px', height: '16px' }} />
        <span style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.5, flex: 1, minWidth: 0 }}>
          I claim exemption from withholding. (No tax liability last year, none expected this year.)
        </span>
      </label>

      {error && <div className="auth-error">{error}</div>}
      <button className="btn auth-btn-primary" style={{ width: 'auto', marginTop: '0.5rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Submitting...' : 'Submit W-4'}
      </button>
    </div>
  )
}
