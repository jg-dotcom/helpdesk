'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

export default function PortalSetupPage() {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Magic link drops a session automatically — just verify it exists
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        // Link may have already been used or expired
        window.location.href = '/login'
      } else {
        setReady(true)
        // Pre-fill name from user metadata if available
        const meta = session.user.user_metadata
        if (meta?.full_name) setName(meta.full_name)
      }
    })
  }, [])

  const allRules = RULES.every(r => r.test(password))
  const match = password === confirm && confirm.length > 0

  async function handleSubmit() {
    if (!allRules) { setError('Password does not meet all requirements.'); return }
    if (!match) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')

    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) { setError(updateErr.message); setLoading(false); return }

    // Redirect to portal
    window.location.href = '/portal'
  }

  if (!ready) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Setting up your account...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '2rem', textAlign: 'center' }}>
          help<span style={{ color: '#185fa5' }}>desk</span>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #eee' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 6px' }}>Create your account</h1>
          <p style={{ fontSize: '14px', color: '#888', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
            Set a password to access your employee portal anytime.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <label style={lbl}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', padding: '10px 36px 10px 12px', fontSize: '14px', border: '1px solid #dde1ea', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: '2px', lineHeight: 1 }}>
                {showPw
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>

            {password.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {RULES.map(rule => (
                  <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: rule.test(password) ? '#27ae60' : '#bbb' }}>
                    <span>{rule.test(password) ? '✓' : '○'}</span>{rule.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={lbl}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="••••••••"
              style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${confirm.length > 0 ? (match ? '#27ae60' : '#c0392b') : '#dde1ea'}`, borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
            />
            {confirm.length > 0 && !match && (
              <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords don't match</div>
            )}
          </div>

          {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}

          <button
            onClick={handleSubmit}
            disabled={loading || !allRules || !match}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: allRules && match ? '#185fa5' : '#dde1ea', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: allRules && match ? 'pointer' : 'default', transition: 'background 0.15s' }}>
            {loading ? 'Creating account...' : 'Create account & go to portal'}
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#bbb', marginTop: '1rem' }}>
          Already have an account? <a href="/login" style={{ color: '#185fa5' }}>Sign in</a>
        </p>

      </div>
    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px', fontWeight: 500,
}
