'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const allRulesPassed = RULES.every(r => r.test(password))
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0

  function switchMode(m: 'signin' | 'signup') {
    setMode(m); setError(''); setPassword(''); setConfirmPassword('')
  }

  async function handleSignIn() {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else window.location.href = '/'
    setLoading(false)
  }

  async function handleSignUp() {
    if (!allRulesPassed) { setError('Password does not meet all requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  if (done) return (
    <div style={wrap}>
      <div style={card}>
        <div style={logo}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.4rem' }}>Check your email</div>
        <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
        </div>
        <button onClick={() => { setDone(false); switchMode('signin') }}
          style={{ fontSize: '13px', color: '#185fa5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Back to sign in
        </button>
      </div>
    </div>
  )

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={logo}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        <div style={{ fontSize: '13px', color: '#888', marginTop: '-1.25rem', marginBottom: '1.75rem' }}>
          HR for small business — onboarding, payroll, and scheduling in one place.
        </div>

        {/* Toggle */}
        <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: '10px', padding: '4px', marginBottom: '1.75rem' }}>
          {(['signin', 'signup'] as const).map(m => (
            <button key={m} onClick={() => switchMode(m)} style={{
              flex: 1, padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
              background: mode === m ? '#fff' : 'transparent',
              color: mode === m ? '#111' : '#888',
              boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            }}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {/* Email */}
        <div style={{ marginBottom: '0.875rem' }}>
          <label style={labelStyle}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>

        {/* Password */}
        <div style={{ marginBottom: '0.875rem' }}>
          <label style={labelStyle}>Password</label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
            onKeyDown={e => mode === 'signin' && e.key === 'Enter' && handleSignIn()}
          />
          {mode === 'signup' && password.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {RULES.map(rule => (
                <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: rule.test(password) ? '#27ae60' : '#bbb' }}>
                  <span>{rule.test(password) ? '✓' : '○'}</span>{rule.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirm password (signup only) */}
        {mode === 'signup' && (
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={labelStyle}>Confirm password</label>
            <input
              type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSignUp()}
              style={{ borderColor: confirmPassword.length > 0 ? (passwordsMatch ? '#27ae60' : '#c0392b') : undefined }}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords don't match</div>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}

        <button
          className="btn auth-btn-primary"
          onClick={mode === 'signin' ? handleSignIn : handleSignUp}
          disabled={loading || !email || !password || (mode === 'signup' && (!allRulesPassed || !passwordsMatch))}
          style={{ width: '100%', marginTop: '0.25rem' }}
        >
          {loading ? (mode === 'signin' ? 'Signing in...' : 'Creating account...') : (mode === 'signin' ? 'Sign in' : 'Create account')}
        </button>

        {mode === 'signin' && (
          <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '13px', color: '#888' }}>
            No account? <button onClick={() => switchMode('signup')} style={{ color: '#185fa5', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>Sign up free</button>
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#f7f8fa', padding: '1.5rem',
}

const card: React.CSSProperties = {
  width: '100%', maxWidth: '400px', background: '#fff',
  borderRadius: '18px', padding: '2.25rem 2rem',
  boxShadow: '0 2px 24px rgba(0,0,0,0.08)',
}

const logo: React.CSSProperties = {
  fontSize: '22px', fontWeight: 800, marginBottom: '1.75rem', color: '#111',
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500,
}
