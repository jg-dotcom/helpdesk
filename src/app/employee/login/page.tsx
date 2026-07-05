'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function EmployeeLogin() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendLink() {
    if (!email.trim()) return
    setLoading(true)
    setError('')

    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/employee`,
        shouldCreateUser: true,
      },
    })

    if (err) {
      setError(err.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f7f8fa', padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#111', marginBottom: '0.25rem' }}>
            help<span style={{ color: '#185fa5' }}>desk</span>
          </div>
          <div style={{ fontSize: '14px', color: '#888' }}>Employee portal</div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: '1rem', color: '#185fa5' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></div>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.5rem' }}>Check your email</div>
              <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6 }}>
                We sent a login link to <strong>{email}</strong>. Click the link to access your portal.
              </div>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                style={{ marginTop: '1.5rem', fontSize: '13px', color: '#185fa5', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.25rem' }}>Sign in</div>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '1.5rem' }}>
                Enter your work email to receive a login link.
              </div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                onKeyDown={e => e.key === 'Enter' && sendLink()}
                style={{ marginBottom: '0.75rem' }}
                autoFocus
              />
              {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}
              <button
                className="btn auth-btn-primary"
                onClick={sendLink}
                disabled={loading || !email.trim()}
                style={{ width: '100%' }}
              >
                {loading ? 'Sending...' : 'Send login link'}
              </button>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '12px', color: '#aaa' }}>
          Are you an employer? <a href="/login" style={{ color: '#185fa5' }}>Sign in here</a>
        </div>
      </div>
    </div>
  )
}
