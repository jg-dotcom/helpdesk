'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../components/Toast'

export default function AcceptInvite() {
  const { showToast } = useToast()
  const { token } = useParams<{ token: string }>()
  const [status, setStatus] = useState<'loading' | 'needs_signup' | 'accepting' | 'done' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Check if invite token is valid
    fetch(`/api/team/accept?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setStatus('error'); return }
        setEmail(data.memberEmail)
        setOwnerName(data.ownerName)
        setStatus('needs_signup')
      })
  }, [token])

  async function accept() {
    setSubmitting(true)

    // Check if user already has an account
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      // Try sign in first, then sign up
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) {
        // Create new account
        const { error: signUpErr } = await supabase.auth.signUp({ email, password })
        if (signUpErr) { showToast(signUpErr.message, 'error'); setSubmitting(false); return }
      }
    }

    // Mark invite as accepted
    const { data: { session: newSession } } = await supabase.auth.getSession()
    if (!newSession) { showToast('Could not sign in. Try again.', 'error'); setSubmitting(false); return }

    const res = await fetch('/api/team/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newSession.access_token}` },
      body: JSON.stringify({ token }),
    })

    if (!res.ok) { showToast('This invite could not be accepted. It may have expired — ask whoever invited you to send a new one.', 'error'); setSubmitting(false); return }

    setStatus('done')
    setTimeout(() => { window.location.href = '/' }, 1500)
  }

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '14px', color: '#999' }}>Loading...</div>
    </div>
  )

  if (status === 'error') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '0.5rem' }}>Invalid invite</div>
        <div style={{ fontSize: '13px', color: '#888' }}>This link may have expired or already been used.</div>
      </div>
    </div>
  )

  if (status === 'done') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '0.75rem' }}>✓</div>
        <div style={{ fontSize: '17px', fontWeight: 700 }}>You&apos;re in! Redirecting...</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, marginBottom: '0.25rem' }}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        </div>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
          <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '0.25rem' }}>You&apos;ve been invited</div>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            {ownerName ? `${ownerName} has invited you` : 'You\'ve been invited'} to join their team on Helpdesk.
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Your email</div>
          <input value={email} readOnly style={{ marginBottom: '0.75rem', background: '#f7f8fa', color: '#888' }} />
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Set a password</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ marginBottom: '0.75rem' }} onKeyDown={e => e.key === 'Enter' && accept()} />
          <button className="btn auth-btn-primary" onClick={accept} disabled={submitting || !password} style={{ width: '100%' }}>
            {submitting ? 'Joining...' : 'Accept invitation'}
          </button>
        </div>
      </div>
    </div>
  )
}
