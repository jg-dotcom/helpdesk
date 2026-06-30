'use client'

import { useState } from 'react'

export function TimeOffRequest({ token }: { token: string }) {
  const [show, setShow] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [type, setType] = useState('PTO / Vacation')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!startDate || !endDate) { setError('Please select start and end dates.'); return }
    if (new Date(endDate) < new Date(startDate)) { setError('End date must be after start date.'); return }
    setSubmitting(true)
    setError('')
    const res = await fetch(`/api/sign/${token}/time-off`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, type, reason }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Could not submit request. Try again.')
    } else {
      setSubmitted(true)
    }
    setSubmitting(false)
  }

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
      <div className="sign-section-label">Time Off</div>
      {submitted ? (
        <div className="done-msg" style={{ fontSize: '15px', padding: '0.75rem 0' }}>✓ Time-off request submitted!</div>
      ) : !show ? (
        <button className="btn" onClick={() => setShow(true)} style={{ marginTop: '0.5rem' }}>Request time off</button>
      ) : (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="row2" style={{ marginBottom: '0.75rem' }}>
            <div className="field">
              <label>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option>PTO / Vacation</option>
              <option>Sick leave</option>
              <option>Unpaid leave</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label>Reason (optional)</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Family vacation" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit request'}
            </button>
            <button className="btn" onClick={() => setShow(false)} style={{ background: 'transparent', color: '#666', boxShadow: 'none' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SignUpload({ token }: { token: string }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [done, setDone] = useState<string[]>([])

  const [signatureName, setSignatureName] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [signed, setSigned] = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File must be under 10MB.')
      return
    }
    setUploading(true)
    setUploadError('')
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`/api/sign/${token}/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setUploadError(data.error || 'Upload failed. Try again.')
    } else {
      setDone(prev => [...prev, file.name])
    }
    setUploading(false)
    e.target.value = ''
  }

  async function handleAcknowledge() {
    if (!acknowledged) {
      setSignError('Please check the box to confirm you have read the welcome pack.')
      return
    }
    if (!signatureName.trim()) {
      setSignError('Please type your full name to sign.')
      return
    }
    setSigning(true)
    setSignError('')
    const res = await fetch(`/api/sign/${token}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureName: signatureName.trim() }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSignError(data.error || 'Could not save signature. Try again.')
    } else {
      setSigned(true)
    }
    setSigning(false)
  }

  return (
    <>
      <div className="doc-upload" style={{ marginTop: '1rem' }}>
        <label className="btn upload-label">
          {uploading ? 'Uploading...' : '+ Upload document'}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            onChange={handleUpload}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
        {uploadError && <div className="auth-error">{uploadError}</div>}
        {done.map((name, i) => (
          <div key={i} className="done-msg">✓ Uploaded {name}</div>
        ))}
      </div>

      <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
        <div className="sign-section-label">Acknowledgment</div>
        {signed ? (
          <div className="done-msg" style={{ fontSize: '15px', padding: '1rem 0' }}>
            ✓ Signed by {signatureName}. You&apos;re all set!
          </div>
        ) : (
          <div>
            <label htmlFor="ack" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                id="ack"
                checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
                style={{ marginTop: '3px', flexShrink: 0, width: '16px', height: '16px' }}
              />
              <span style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: 1.5 }}>
                I confirm that I have read and understood this welcome pack, and agree to the policies described above.
              </span>
            </label>
            <div className="field">
              <label>Type your full name to sign</label>
              <input
                value={signatureName}
                onChange={e => setSignatureName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            {signError && <div className="auth-error">{signError}</div>}
            <button className="btn" onClick={handleAcknowledge} disabled={signing} style={{ marginTop: '0.75rem' }}>
              {signing ? 'Saving...' : '✍ Sign & submit'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
