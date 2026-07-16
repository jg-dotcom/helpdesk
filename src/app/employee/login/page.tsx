'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'

export default function EmployeeLogin() {
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function sendLink() {
    if (!email.trim()) return
    setLoading(true)

    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/employee`,
        shouldCreateUser: true,
      },
    })

    if (err) {
      showToast(err.message, 'error')
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  // JAY-78 — this page (reached before an employee is authenticated, so it
  // can't rely on .dash-content's dark-mode input override) was still the
  // full pre-redesign light template. Converted to the established dark
  // palette; the <input> gets explicit inline styling for the same reason
  // the chat page's textarea needed it — no .dash-content wrapper here.
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#e2e8f0', marginBottom: '0.25rem' }}>
            help<span style={{ color: '#3b82f6' }}>desk</span>
          </div>
          <div style={{ fontSize: '14px', color: '#94a3b8' }}>Employee portal</div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '2rem' }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: '1rem', color: '#3b82f6' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></div>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.5rem', color: '#e2e8f0' }}>Check your email</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                We sent a login link to <strong style={{ color: '#e2e8f0' }}>{email}</strong>. Click the link to access your portal.
              </div>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                style={{ marginTop: '1.5rem', fontSize: '13px', color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.25rem', color: '#e2e8f0' }}>Sign in</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '1.5rem' }}>
                Enter your work email to receive a login link.
              </div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                onKeyDown={e => e.key === 'Enter' && sendLink()}
                style={{ marginBottom: '0.75rem', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)' }}
                autoFocus
              />
              <button
                className="btn"
                onClick={sendLink}
                disabled={loading || !email.trim()}
                style={{ width: '100%', background: '#1d4ed8', color: '#fff', border: 'none' }}
              >
                {loading ? 'Sending...' : 'Send login link'}
              </button>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '12px', color: '#64748b' }}>
          Are you an employer? <a href="/login" style={{ color: '#93c5fd' }}>Sign in here</a>
        </div>
      </div>
    </div>
  )
}
