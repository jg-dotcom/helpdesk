'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import Nav from '../components/Nav'

const DEFAULT_ITEMS = [
  'Keys / access cards returned',
  'Equipment returned (uniform, devices, tools)',
  'System access revoked (email, POS, software)',
  'Final paycheck processed',
  'Unused PTO paid out (if applicable)',
  'Exit interview completed',
]

export default function OffboardingSettings() {
  const { showToast } = useToast()
  const [offboardingTemplate, setOffboardingTemplate] = useState('')
  const [checklistItems, setChecklistItems] = useState<string[]>(DEFAULT_ITEMS)
  const [newItem, setNewItem] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.href = '/login'; return }
    setUserId(session.user.id)
    const { data } = await supabase
      .from('onboarding_templates')
      .select('offboarding_template, offboarding_checklist')
      .eq('user_id', session.user.id)
      .single()
    if (data?.offboarding_template) setOffboardingTemplate(data.offboarding_template)
    if (data?.offboarding_checklist && data.offboarding_checklist.length > 0) {
      setChecklistItems(data.offboarding_checklist)
    }
    setLoading(false)
  }

  function addItem() {
    const val = newItem.trim()
    if (!val) return
    setChecklistItems(prev => [...prev, val])
    setNewItem('')
  }

  function removeItem(i: number) {
    setChecklistItems(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateItem(i: number, val: string) {
    setChecklistItems(prev => prev.map((item, idx) => idx === i ? val : item))
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase
      .from('onboarding_templates')
      .upsert({
        user_id: userId,
        offboarding_template: offboardingTemplate,
        offboarding_checklist: checklistItems,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    showToast(error ? 'Error saving. Try again.' : 'Saved.', error ? 'error' : 'success')
    setSaving(false)
  }

  // JAY-74 — this page was still on the pre-redesign light template (the
  // ticket flagged just the chip-button colors, but on inspection the whole
  // page — nav bar, card background, all text colors — was light; fixing the
  // full page rather than just the chip block it was filed against, since
  // that's the actual scope of the drift). Matches the established dark
  // palette (payroll/page.tsx reference): #0f172a page bg, #1e293b cards,
  // rgba(255,255,255,0.07) borders, #e2e8f0/#94a3b8/#64748b text tiers.
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem' }

  if (loading) return (
    <div className="dash-wrap" style={{ background: '#0f172a', minHeight: '100vh' }}>
      <Nav active="settings" />
      <div className="dash-content" style={{ color: '#94a3b8' }}><div className="loading-state">Loading...</div></div>
    </div>
  )

  return (
    <div className="dash-wrap" style={{ background: '#0f172a', minHeight: '100vh' }}>
      <Nav active="settings" />

      <div className="dash-content">
        <a href="/" className="back-btn" style={{ color: '#94a3b8' }}>← Back to dashboard</a>
        <div className="screen-title" style={{ color: '#e2e8f0' }}>Offboarding template</div>

        <div style={cardStyle}>
          <div className="section-label" style={{ color: '#64748b' }}>Checklist items</div>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '1rem' }}>
            These steps appear every time you offboard someone. Edit, add, or remove to match your process.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
            {checklistItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#475569', fontSize: '13px', userSelect: 'none' }}>☰</span>
                <input
                  value={item}
                  onChange={e => updateItem(i, e.target.value)}
                  style={{ flex: 1, fontSize: '13px' }}
                />
                <button
                  onClick={() => removeItem(i)}
                  style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 4px' }}
                >×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <input
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Add a step..."
              style={{ flex: 1, fontSize: '13px' }}
            />
            <button className="btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)' }} onClick={addItem}>+ Add</button>
          </div>

          <div className="section-label" style={{ marginTop: '0.5rem', color: '#64748b' }}>Notes template</div>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '0.75rem' }}>
            Pre-fills the notes field. Use <strong>{'{{employee_name}}'}</strong>, <strong>{'{{lastDay}}'}</strong>, <strong>{'{{reason}}'}</strong>, <strong>{'{{role}}'}</strong>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
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
                  padding: '5px 10px', borderRadius: '6px', border: '1.5px solid rgba(59,130,246,0.3)',
                  background: 'rgba(59,130,246,0.15)', color: '#93c5fd', fontSize: '12px', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.25)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
              >
                <span style={{ fontSize: '10px', opacity: 0.6 }}>[ ]</span> {label}
              </button>
            ))}
          </div>
          <textarea
            value={offboardingTemplate}
            onChange={e => setOffboardingTemplate(e.target.value)}
            placeholder={`{{employee_name}}'s last day is {{lastDay}}.\nReason: {{reason}}\n\nPlease ensure all equipment is returned and system access is revoked.`}
            style={{ minHeight: '160px', fontFamily: 'inherit', fontSize: '14px', marginBottom: '1rem' }}
          />

          <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ width: 'auto' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
