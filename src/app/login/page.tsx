'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Onboard in minutes',
    desc: 'Send one link — employees complete W-4, I-9, and direct deposit from their phone.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: 'Clock in / clock out',
    desc: 'Employees tap a button on their phone. Hours are logged and payroll is calculated automatically.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    title: 'Scheduling & time off',
    desc: 'Build shifts, approve time-off requests, and sync your schedule to Google Calendar.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    title: 'Payroll tracking',
    desc: 'Log payments, track pay history, and sync to QuickBooks — no spreadsheets needed.',
  },
]

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
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
    setFullName(''); setBusinessName('')
  }

  async function handleSignIn() {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else window.location.href = '/'
    setLoading(false)
  }

  async function handleSignUp() {
    if (!fullName.trim()) { setError('Please enter your name.'); return }
    if (!businessName.trim()) { setError('Please enter your business name.'); return }
    if (!allRulesPassed) { setError('Password does not meet all requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName.trim(), business_name: businessName.trim() } },
      })
      if (error) {
        const raw = error.message ?? ''
        // Supabase sometimes returns '{}' for existing/rate-limited emails
        const msg = (!raw || raw === '{}' || raw === '{ }')
          ? 'Could not create account. This email may already be registered, or you have hit a rate limit — try again in a few minutes.'
          : raw
        setError(msg)
        setLoading(false); return
      }

      // If we have a session (no email confirmation required), save business profile now
      if (data.session?.access_token) {
        await fetch('/api/settings/business', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ business_name: businessName.trim(), contact_email: email }),
        })
      }
      // Otherwise, business profile is auto-created from user metadata on first login

      setDone(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.'
      setError(msg)
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>

      {/* Left panel */}
      <div style={{
        flex: 1, background: '#0f1923', color: '#fff',
        padding: '3rem 3.5rem', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '22px', fontWeight: 800 }}>
          help<span style={{ color: '#4a9eff' }}>desk</span>
        </div>

        <div>
          <div style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.3, marginBottom: '0.75rem' }}>
            HR built for<br />small business.
          </div>
          <div style={{ fontSize: '14px', color: '#8899aa', marginBottom: '2.5rem', lineHeight: 1.6 }}>
            Everything you need to hire, onboard, schedule, and pay your team — in one place.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '9px', background: 'rgba(74,158,255,0.12)',
                  color: '#4a9eff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{f.title}</div>
                  <div style={{ fontSize: '13px', color: '#8899aa', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: '#4a5568' }}>
          © {new Date().getFullYear()} Helpdesk. Built for owners, not HR departments.
        </div>
      </div>

      {/* Right panel */}
      <div style={{
        flex: 1, background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '3rem 2.5rem',
      }}>
        {done ? (
          <div style={{ width: '100%', maxWidth: '340px' }}>
            <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '0.5rem' }}>Check your email</div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
            </div>
            <button onClick={() => { setDone(false); switchMode('signin') }}
              style={{ fontSize: '13px', color: '#185fa5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              ← Back to sign in
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: '340px' }}>
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

            {mode === 'signup' && (
              <>
                <div style={{ marginBottom: '0.875rem' }}>
                  <label style={lbl}>Full name</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div style={{ marginBottom: '0.875rem' }}>
                  <label style={lbl}>Business name</label>
                  <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Acme Co." />
                </div>
              </>
            )}

            <div style={{ marginBottom: '0.875rem' }}>
              <label style={lbl}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <label style={lbl}>Password</label>
                {mode === 'signin' && (
                  <a href="/forgot-password" style={{ fontSize: '12px', color: '#4a9eff', textDecoration: 'none' }}>Forgot password?</a>
                )}
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                onKeyDown={e => mode === 'signin' && e.key === 'Enter' && handleSignIn()} />
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

            {mode === 'signup' && (
              <div style={{ marginBottom: '0.875rem' }}>
                <label style={lbl}>Confirm password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSignUp()}
                  style={{ borderColor: confirmPassword.length > 0 ? (passwordsMatch ? '#27ae60' : '#c0392b') : undefined }} />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords don't match</div>
                )}
              </div>
            )}

            {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}

            <button className="btn auth-btn-primary"
              onClick={mode === 'signin' ? handleSignIn : handleSignUp}
              disabled={loading || !email || !password || (mode === 'signup' && (!allRulesPassed || !passwordsMatch || !fullName.trim() || !businessName.trim()))}
              style={{ width: '100%', marginTop: '0.25rem' }}>
              {loading
                ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
                : (mode === 'signin' ? 'Sign in' : 'Create account')}
            </button>
          </div>
        )}
      </div>

    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500,
}
