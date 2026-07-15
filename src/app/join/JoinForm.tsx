'use client'

import { useState } from 'react'

type Props = { ownerId: string }

// Public, unauthenticated form (JAY-29) — mirrors careers/ApplyForm.tsx's structure
// and styling, but submits to /api/team/join instead of /api/applications.
export default function JoinForm({ ownerId }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/team/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: ownerId, name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Failed to submit.'); setLoading(false); return }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div style={{ fontSize: '14px', color: '#27ae60', fontWeight: 600, textAlign: 'center', padding: '1rem 0' }}>
        ✓ Thanks! The team will be in touch to finish setting up your account.
      </div>
    )
  }

  return (
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
      {error && <div style={{ fontSize: '13px', color: '#c0392b' }}>{error}</div>}
      <button onClick={handleSubmit} disabled={loading} style={{
        marginTop: '0.25rem', padding: '10px 20px', background: '#185fa5', color: '#fff',
        border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        opacity: loading ? 0.6 : 1,
      }}>
        {loading ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #dde1ea', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' }
