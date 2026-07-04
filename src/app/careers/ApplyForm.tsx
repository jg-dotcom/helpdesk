'use client'

import { useState } from 'react'

type Props = { jobId: string; jobTitle: string; ownerId: string }

export default function ApplyForm({ jobId, jobTitle, ownerId }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_posting_id: jobId, owner_id: ownerId, name: name.trim(), email: email.trim(), phone: phone.trim(), cover_letter: coverLetter.trim() }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to submit.'); setLoading(false); return }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: '1rem', padding: '10px 20px', background: '#185fa5', color: '#fff',
          border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        }}
      >
        Apply for this role
      </button>
    )
  }

  return (
    <div style={{ marginTop: '1.25rem', borderTop: '1px solid #eee', paddingTop: '1.25rem' }}>
      {done ? (
        <div style={{ fontSize: '14px', color: '#27ae60', fontWeight: 600 }}>
          ✓ Application submitted! We'll be in touch.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '1rem' }}>Apply — {jobTitle}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={lbl}>Full name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" style={inp} />
            </div>
            <div>
              <label style={lbl}>Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" style={inp} />
            </div>
            <div>
              <label style={lbl}>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" style={inp} />
            </div>
            <div>
              <label style={lbl}>Cover letter / message</label>
              <textarea value={coverLetter} onChange={e => setCoverLetter(e.target.value)}
                placeholder="Tell us a bit about yourself..." rows={4}
                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            {error && <div style={{ fontSize: '13px', color: '#c0392b' }}>{error}</div>}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={handleSubmit} disabled={loading} style={{
                padding: '10px 20px', background: '#185fa5', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}>
                {loading ? 'Submitting...' : 'Submit application'}
              </button>
              <button onClick={() => setOpen(false)} style={{
                padding: '10px 16px', background: 'transparent', color: '#666',
                border: '1px solid #dde1ea', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #dde1ea', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' }
