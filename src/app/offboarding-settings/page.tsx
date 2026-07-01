'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function OffboardingSettings() {
  const [offboardingTemplate, setOffboardingTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [userId, setUserId] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.href = '/login'; return }
    setUserId(session.user.id)
    const { data } = await supabase
      .from('onboarding_templates')
      .select('offboarding_template')
      .eq('user_id', session.user.id)
      .single()
    if (data?.offboarding_template) setOffboardingTemplate(data.offboarding_template)
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase
      .from('onboarding_templates')
      .upsert({ user_id: userId, offboarding_template: offboardingTemplate, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) {
      setSaveMsg('Error saving. Try again.')
    } else {
      setSaveMsg('Template saved.')
      setTimeout(() => setSaveMsg(''), 2000)
    }
    setSaving(false)
  }

  if (loading) return <div className="dash-content"><div className="loading-state">Loading...</div></div>

  return (
    <div className="dash-wrap">
      <div className="dash-nav">
        <div className="dash-nav-left">
          <div className="logo">help<span>desk</span></div>
        </div>
      </div>

      <div className="dash-content">
        <a href="/" className="back-btn">← Back to dashboard</a>
        <div className="screen-title">Offboarding template</div>
        <div className="context-bar" style={{ background: '#f7f7f5', color: '#6b6b6b' }}>
          Write notes or instructions that pre-fill every time you offboard someone. Placeholders are replaced automatically when you start an offboarding.
        </div>

        <div className="card">
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Click to insert</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {[
                { id: 'employee_name', label: 'Employee name' },
                { id: 'lastDay', label: 'Last day' },
                { id: 'reason', label: 'Reason' },
                { id: 'role', label: 'Role' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setOffboardingTemplate(prev => prev + `{{${id}}}`)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    padding: '5px 10px', borderRadius: '6px', border: '1.5px solid #d0d5e8',
                    background: '#f4f6fc', color: '#185fa5', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#e8edf8')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#f4f6fc')}
                >
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>[ ]</span> {label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={offboardingTemplate}
            onChange={e => setOffboardingTemplate(e.target.value)}
            placeholder={`{{employee_name}}'s last day is {{lastDay}}.\nReason: {{reason}}\n\nPlease ensure all equipment is returned and system access is revoked before their departure.`}
            style={{ minHeight: '220px', fontFamily: 'inherit', fontSize: '14px' }}
          />
          <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ marginTop: '1rem', width: 'auto' }}>
            {saving ? 'Saving...' : 'Save template'}
          </button>
          {saveMsg && <div className="done-msg" style={{ marginTop: '0.5rem' }}>{saveMsg}</div>}
        </div>
      </div>
    </div>
  )
}
