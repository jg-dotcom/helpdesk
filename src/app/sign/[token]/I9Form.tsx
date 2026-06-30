'use client'

import { useState } from 'react'

type Props = {
  token: string
  employeeId: number
  userId: string
  defaultName?: string
}

export default function I9Form({ token, employeeId, userId, defaultName }: Props) {
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    lastName: defaultName?.split(' ').slice(1).join(' ') || '',
    firstName: defaultName?.split(' ')[0] || '',
    middleInitial: '',
    otherLastNames: '',
    address: '',
    aptNumber: '',
    city: '',
    state: '',
    zip: '',
    dob: '',
    ssn: '',
    email: '',
    phone: '',
    citizenshipStatus: 'citizen',
    alienRegNumber: '',
    i94Number: '',
    foreignPassportNumber: '',
    countryOfIssuance: '',
    authExpDate: '',
    // List A docs
    listADocType: '',
    listADocNumber: '',
    listAExpDate: '',
    // List B + C docs
    listBDocType: '',
    listBDocNumber: '',
    listBExpDate: '',
    listCDocType: '',
    listCDocNumber: '',
    listCExpDate: '',
    useListA: true,
  })

  function set(field: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    if (!form.firstName || !form.lastName || !form.dob || !form.ssn || !form.citizenshipStatus) {
      setError('Please fill out all required fields.')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/sign/${token}/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType: 'i9', formData: form, employeeId, userId }),
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
    return <div className="done-msg" style={{ padding: '0.75rem 0' }}>✓ I-9 submitted successfully.</div>
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '1rem' }}>
        Complete Section 1 of your Employment Eligibility Verification form. Your employer will complete Section 2 after verifying your documents.
      </p>

      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem', color: '#185fa5' }}>Personal information</div>

      <div className="row2">
        <div className="field">
          <label>Last name <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Smith" />
        </div>
        <div className="field">
          <label>First name <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Jane" />
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label>Middle initial</label>
          <input value={form.middleInitial} onChange={e => set('middleInitial', e.target.value)} placeholder="A" maxLength={1} />
        </div>
        <div className="field">
          <label>Other last names used</label>
          <input value={form.otherLastNames} onChange={e => set('otherLastNames', e.target.value)} placeholder="N/A" />
        </div>
      </div>

      <div className="field">
        <label>Address <span style={{ color: '#c0392b' }}>*</span></label>
        <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" />
      </div>

      <div className="row2">
        <div className="field">
          <label>City <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Springfield" />
        </div>
        <div className="field">
          <label>State / ZIP</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={form.state} onChange={e => set('state', e.target.value)} placeholder="IL" maxLength={2} style={{ width: '60px' }} />
            <input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="62701" maxLength={10} />
          </div>
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label>Date of birth <span style={{ color: '#c0392b' }}>*</span></label>
          <input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
        </div>
        <div className="field">
          <label>SSN <span style={{ color: '#c0392b' }}>*</span></label>
          <input value={form.ssn} onChange={e => set('ssn', e.target.value)} placeholder="XXX-XX-XXXX" maxLength={11} />
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" />
        </div>
      </div>

      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem', marginTop: '1rem', color: '#185fa5' }}>Citizenship / immigration status</div>

      <div className="field">
        <label>I attest that I am <span style={{ color: '#c0392b' }}>*</span></label>
        <select value={form.citizenshipStatus} onChange={e => set('citizenshipStatus', e.target.value)}>
          <option value="citizen">A citizen of the United States</option>
          <option value="noncitizen_national">A noncitizen national of the United States</option>
          <option value="permanent_resident">A lawful permanent resident</option>
          <option value="alien_authorized">An alien authorized to work</option>
        </select>
      </div>

      {form.citizenshipStatus === 'permanent_resident' && (
        <div className="field">
          <label>Alien Registration Number / USCIS Number</label>
          <input value={form.alienRegNumber} onChange={e => set('alienRegNumber', e.target.value)} placeholder="A-XXXXXXXXX" />
        </div>
      )}

      {form.citizenshipStatus === 'alien_authorized' && (
        <>
          <div className="field">
            <label>Authorization expiration date</label>
            <input type="date" value={form.authExpDate} onChange={e => set('authExpDate', e.target.value)} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Alien Reg. / USCIS Number</label>
              <input value={form.alienRegNumber} onChange={e => set('alienRegNumber', e.target.value)} placeholder="A-XXXXXXXXX" />
            </div>
            <div className="field">
              <label>Form I-94 Number</label>
              <input value={form.i94Number} onChange={e => set('i94Number', e.target.value)} placeholder="XXXXXXXXXXX" />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Foreign Passport Number</label>
              <input value={form.foreignPassportNumber} onChange={e => set('foreignPassportNumber', e.target.value)} />
            </div>
            <div className="field">
              <label>Country of Issuance</label>
              <input value={form.countryOfIssuance} onChange={e => set('countryOfIssuance', e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem', marginTop: '1rem', color: '#185fa5' }}>Identity documents</div>
      <p style={{ fontSize: '12px', color: '#666', marginBottom: '0.75rem' }}>
        Provide either one List A document OR one List B + one List C document.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`profile-tab${form.useListA ? ' active' : ''}`}
          onClick={() => set('useListA', true)}
          type="button"
        >List A (one document)</button>
        <button
          className={`profile-tab${!form.useListA ? ' active' : ''}`}
          onClick={() => set('useListA', false)}
          type="button"
        >List B + C (two documents)</button>
      </div>

      {form.useListA ? (
        <>
          <div className="field">
            <label>Document type</label>
            <select value={form.listADocType} onChange={e => set('listADocType', e.target.value)}>
              <option value="">Select...</option>
              <option>U.S. Passport</option>
              <option>U.S. Passport Card</option>
              <option>Permanent Resident Card (Form I-551)</option>
              <option>Employment Authorization Document (Form I-766)</option>
              <option>Foreign Passport with I-551 stamp</option>
              <option>Other List A document</option>
            </select>
          </div>
          <div className="row2">
            <div className="field">
              <label>Document number</label>
              <input value={form.listADocNumber} onChange={e => set('listADocNumber', e.target.value)} />
            </div>
            <div className="field">
              <label>Expiration date</label>
              <input type="date" value={form.listAExpDate} onChange={e => set('listAExpDate', e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '0.5rem' }}>List B — Identity</div>
          <div className="field">
            <label>Document type</label>
            <select value={form.listBDocType} onChange={e => set('listBDocType', e.target.value)}>
              <option value="">Select...</option>
              <option>Driver's license</option>
              <option>State ID card</option>
              <option>School ID with photo</option>
              <option>Voter registration card</option>
              <option>U.S. Military card</option>
              <option>Other List B document</option>
            </select>
          </div>
          <div className="row2">
            <div className="field">
              <label>Document number</label>
              <input value={form.listBDocNumber} onChange={e => set('listBDocNumber', e.target.value)} />
            </div>
            <div className="field">
              <label>Expiration date</label>
              <input type="date" value={form.listBExpDate} onChange={e => set('listBExpDate', e.target.value)} />
            </div>
          </div>

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', margin: '0.75rem 0 0.5rem' }}>List C — Employment Authorization</div>
          <div className="field">
            <label>Document type</label>
            <select value={form.listCDocType} onChange={e => set('listCDocType', e.target.value)}>
              <option value="">Select...</option>
              <option>Social Security card</option>
              <option>U.S. birth certificate</option>
              <option>U.S. citizen ID card (Form I-197)</option>
              <option>Employment authorization document</option>
              <option>Other List C document</option>
            </select>
          </div>
          <div className="row2">
            <div className="field">
              <label>Document number</label>
              <input value={form.listCDocNumber} onChange={e => set('listCDocNumber', e.target.value)} />
            </div>
            <div className="field">
              <label>Expiration date</label>
              <input type="date" value={form.listCExpDate} onChange={e => set('listCExpDate', e.target.value)} />
            </div>
          </div>
        </>
      )}

      {error && <div className="auth-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
      <button className="btn auth-btn-primary" style={{ width: 'auto', marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
        {saving ? 'Submitting...' : 'Submit I-9'}
      </button>
    </div>
  )
}
