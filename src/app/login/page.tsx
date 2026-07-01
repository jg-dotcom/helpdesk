'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else window.location.href = '/'
    setLoading(false)
  }

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
            <div className="auth-title">Welcome back</div>
            <div className="auth-subtitle">Sign in to your helpdesk account</div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ background: '#ffffff' }} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleLogin()} style={{ background: '#ffffff' }} />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="btn auth-btn auth-btn-primary" onClick={handleLogin} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <div className="auth-switch">
              No account? <a href="/signup">Sign up free</a>
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
