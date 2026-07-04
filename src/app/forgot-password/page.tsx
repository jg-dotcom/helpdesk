'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <a href="/login" style={{ fontSize: '22px', fontWeight: 800, textDecoration: 'none', color: '#111' }}>
            help<span style={{ color: '#4a9eff' }}>desk</span>
          </a>
        </div>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
          {done ? (
            <>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.5rem' }}>Check your email</div>
              <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                We sent a password reset link to <strong>{email}</strong>.
              </div>
              <a href="/login" style={{ fontSize: '13px', color: '#185fa5' }}>← Back to sign in</a>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.25rem' }}>Reset your password</div>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '1.5rem' }}>
                Enter your email and we'll send you a reset link.
              </div>
              <label style={lbl}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{ marginBottom: '0.875rem' }}
              />
              {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}
              <button
                className="btn auth-btn-primary"
                onClick={handleSubmit}
                disabled={loading || !email}
                style={{ width: '100%', marginBottom: '1rem' }}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
              <a href="/login" style={{ fontSize: '13px', color: '#185fa5', display: 'block', textAlign: 'center' }}>← Back to sign in</a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500,
}
