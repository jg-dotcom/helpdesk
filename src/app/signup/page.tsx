'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSignup() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  if (done) return (
    <div className="auth-wrap">
      <div className="auth-header">
        <div className="auth-brand">help<span>desk</span></div>
        <div className="auth-header-sub">HR that protects your business.</div>
      </div>
      <div className="auth-body">
        <div className="auth-left">
          <div className="auth-headline">HR made simple.</div>
          <div className="auth-sub">Generate onboarding packs, check-in notes, and offboarding docs in seconds.</div>
        </div>
        <div className="auth-right">
          <div className="auth-card">
            <div className="auth-title">Check your email</div>
            <p style={{ fontSize: '13px', color: '#6b6b6b', marginTop: '0.5rem', lineHeight: 1.6 }}>
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
            </p>
            <div className="auth-switch" style={{ marginTop: '1.5rem' }}>
              <a href="/login">Back to sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="auth-wrap">
      <div className="auth-header">
        <div className="auth-brand">help<span>desk</span></div>
        <div className="auth-header-sub">HR that protects your business.</div>
      </div>
      <div className="auth-body">
        <div className="auth-left">
          <div className="auth-headline">HR made simple.</div>
          <div className="auth-sub">Generate onboarding packs, check-in notes, and offboarding docs in seconds — with a timestamped paper trail that keeps you covered.</div>
          <div className="auth-features">
            <div className="auth-feature">→ Welcome packs for new hires</div>
            <div className="auth-feature">✓ Performance check-in notes</div>
            <div className="auth-feature">← Offboarding checklists</div>
          </div>
        </div>
        <div className="auth-right">
          <div className="auth-card">
            <div className="auth-title">Create your account</div>
            <div className="auth-subtitle">Free to try. $39/month after.</div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ background: '#ffffff' }} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSignup()} style={{ background: '#ffffff' }} />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="btn auth-btn" onClick={handleSignup} disabled={loading}>
              {loading ? 'Creating account...' : 'Create account'}
            </button>
            <div className="auth-switch">
              Already have an account? <a href="/login">Sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
