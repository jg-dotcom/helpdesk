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
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo" style={{ marginBottom: '1.5rem' }}>help<span>desk</span></div>
        <div className="auth-title">Check your email</div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
        </p>
        <div className="auth-switch" style={{ marginTop: '1rem' }}>
          <a href="/login">Back to sign in</a>
        </div>
      </div>
    </div>
  )

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo" style={{ marginBottom: '1.5rem' }}>help<span>desk</span></div>
        <div className="auth-title">Create your account</div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
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
  )
}
