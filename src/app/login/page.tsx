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
        <div className="auth-header-sub">HR that protects your business.</div>
      </div>
      <div className="auth-body">
        <div className="auth-left">
          <div>
            <div className="auth-headline">HR made simple.</div>
            <div className="auth-sub">Generate onboarding packs, check-in notes, and offboarding docs in seconds — with a timestamped paper trail that keeps you covered.</div>
            <div className="auth-features">
              <div className="auth-feature">→ Welcome packs for new hires</div>
              <div className="auth-feature">✓ Performance check-in notes</div>
              <div className="auth-feature">← Offboarding checklists</div>
            </div>
            <div className="auth-stats">
              <div className="auth-stat">
                <div className="auth-stat-n">2min</div>
                <div className="auth-stat-l">to onboard a hire</div>
              </div>
              <div className="auth-stat">
                <div className="auth-stat-n">$39</div>
                <div className="auth-stat-l">flat per month</div>
              </div>
              <div className="auth-stat">
                <div className="auth-stat-n">100%</div>
                <div className="auth-stat-l">paper trail</div>
              </div>
            </div>
          </div>
          <div className="auth-trust">
            <div className="auth-trust-item">
              <div className="auth-trust-title">Data encrypted</div>
              <div className="auth-trust-sub">Secured at rest and in transit</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">Timestamped docs</div>
              <div className="auth-trust-sub">Every record dated and saved</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">No contracts</div>
              <div className="auth-trust-sub">Cancel anytime, no questions</div>
            </div>
            <div className="auth-trust-item">
              <div className="auth-trust-title">Built for small biz</div>
              <div className="auth-trust-sub">Not enterprise software</div>
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
            <div className="auth-why-title">Why small businesses choose helpdesk</div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">No HR department needed</div>
                <div className="auth-why-sub">Built for owners, not HR professionals.</div>
              </div>
            </div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">Legal protection built in</div>
                <div className="auth-why-sub">Every doc is timestamped and saved.</div>
              </div>
            </div>
            <div className="auth-why-item">
              <div className="auth-why-dot">✓</div>
              <div>
                <div className="auth-why-name">Cancel anytime</div>
                <div className="auth-why-sub">No contracts. $39/month flat.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
