'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const allRulesPassed = RULES.every(r => r.test(password))
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0

  async function handleSignup() {
    if (!allRulesPassed) { setError('Password does not meet all requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }
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
        <div className="auth-header-sub">HR built for small business.</div>
      </div>
      <div className="auth-body">
        <div className="auth-left">
          <div className="auth-headline">You're almost in.</div>
          <div className="auth-sub">Check your inbox and click the confirmation link to activate your account.</div>
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
        <div className="auth-header-sub">HR built for small business.</div>
      </div>
      <div className="auth-body">
        <div className="auth-left">
          <div>
            <div className="auth-headline">Everything you need to run your team.</div>
            <div className="auth-sub">From hiring to offboarding — helpdesk handles your HR so you can focus on your business.</div>
            <div className="auth-features">
              <div className="auth-feature">→ Digital onboarding — W-4, I-9, direct deposit, all in one link</div>
              <div className="auth-feature">✓ Compliance tracker — know exactly who's missing what</div>
              <div className="auth-feature">📅 Schedule builder — shifts, availability, and time-off requests</div>
              <div className="auth-feature">💵 Payroll visibility — track pay rates, periods, and history</div>
              <div className="auth-feature">← Offboarding checklists — customizable, step by step</div>
            </div>
            <div className="auth-stats">
              <div className="auth-stat">
                <div className="auth-stat-n">2 min</div>
                <div className="auth-stat-l">to onboard a new hire</div>
              </div>
              <div className="auth-stat">
                <div className="auth-stat-n">0 paper</div>
                <div className="auth-stat-l">everything digital</div>
              </div>
              <div className="auth-stat">
                <div className="auth-stat-n">100%</div>
                <div className="auth-stat-l">paper trail</div>
              </div>
            </div>
          </div>
          <div className="auth-trust">
            <div className="auth-trust-item">
              <div className="auth-trust-title">No HR degree needed</div>
              <div className="auth-trust-sub">Built for owners, not HR departments</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">Data encrypted</div>
              <div className="auth-trust-sub">Secured at rest and in transit</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">Timestamped records</div>
              <div className="auth-trust-sub">Every doc dated and saved</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">No contracts</div>
              <div className="auth-trust-sub">Cancel anytime, no questions</div>
            </div>
          </div>
        </div>
        <div className="auth-right">
          <div style={{ width: '100%' }}>
            <div className="auth-title">Create your account</div>
            <div className="auth-subtitle">Free to try — no credit card required.</div>

            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ background: '#ffffff' }} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ background: '#ffffff' }} />
              {password.length > 0 && (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {RULES.map(rule => (
                    <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: rule.test(password) ? '#27ae60' : '#9a9a9a' }}>
                      <span>{rule.test(password) ? '✓' : '○'}</span>
                      {rule.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleSignup()}
                style={{ background: '#ffffff', borderColor: confirmPassword.length > 0 ? (passwordsMatch ? '#27ae60' : '#c0392b') : undefined }}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords don't match</div>
              )}
            </div>

            {error && <div className="auth-error">{error}</div>}
            <button
              className="btn auth-btn auth-btn-primary"
              onClick={handleSignup}
              disabled={loading || !allRulesPassed || !passwordsMatch || !email}
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
            <div className="auth-switch">
              Already have an account? <a href="/login">Sign in</a>
            </div>
          </div>
          <div className="auth-why">
            <div className="auth-why-title">Built for small business</div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">Employees onboard from their phone</div>
                <div className="auth-why-sub">Send a link — they fill out W-4, I-9, and direct deposit digitally.</div>
              </div>
            </div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">Always know your team's status</div>
                <div className="auth-why-sub">Compliance, schedules, and time-off all in one place.</div>
              </div>
            </div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">Legal protection built in</div>
                <div className="auth-why-sub">Every document is timestamped and saved automatically.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
