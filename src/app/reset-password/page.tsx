'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase sets session from URL hash after redirect
    supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
  }, [])

  const allRulesPassed = RULES.every(r => r.test(password))
  const passwordsMatch = password === confirm && confirm.length > 0

  async function handleReset() {
    if (!allRulesPassed || !passwordsMatch) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
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
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.5rem' }}>Password updated</div>
              <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Your password has been changed. You can now sign in.
              </div>
              <a href="/login" style={{ fontSize: '13px', color: '#185fa5' }}>Sign in →</a>
            </>
          ) : !ready ? (
            <div style={{ fontSize: '14px', color: '#888', textAlign: 'center', padding: '1rem 0' }}>
              Verifying reset link…
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '1.5rem' }}>Choose a new password</div>
              <label style={lbl}>New password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" style={{ marginBottom: '0.5rem' }}
              />
              {password.length > 0 && (
                <div style={{ marginBottom: '0.875rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {RULES.map(rule => (
                    <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: rule.test(password) ? '#27ae60' : '#bbb' }}>
                      <span>{rule.test(password) ? '✓' : '○'}</span>{rule.label}
                    </div>
                  ))}
                </div>
              )}
              <label style={lbl}>Confirm password</label>
              <input
                type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleReset()}
                style={{ marginBottom: '0.875rem', borderColor: confirm.length > 0 ? (passwordsMatch ? '#27ae60' : '#c0392b') : undefined }}
              />
              {error && <div style={{ fontSize: '13px', color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}
              <button
                className="btn auth-btn-primary"
                onClick={handleReset}
                disabled={loading || !allRulesPassed || !passwordsMatch}
                style={{ width: '100%' }}
              >
                {loading ? 'Updating...' : 'Update password'}
              </button>
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
