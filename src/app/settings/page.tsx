'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import DocumentLibrary from '../components/DocumentLibrary'

type Field = {
  id: string
  label: string
  placeholder: string
}

const DEFAULT_FIELDS: Field[] = [
  { id: 'startTime', label: 'Start time', placeholder: 'e.g. 9:00 AM' },
  { id: 'reportTo', label: 'Reports to', placeholder: 'e.g. Store manager' },
  { id: 'payRate', label: 'Pay rate', placeholder: 'e.g. $15/hr' },
  { id: 'dresscode', label: 'Dress code', placeholder: 'e.g. Black shirt, jeans' },
]

export default function Settings() {
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS)
  const [welcomePack, setWelcomePack] = useState('')
  const [offboardingTemplate, setOffboardingTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [userId, setUserId] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }
    setUserId(session.user.id)
    const { data } = await supabase
      .from('onboarding_templates')
      .select('fields, welcome_pack, offboarding_template')
      .eq('user_id', session.user.id)
      .single()
    if (data?.fields && data.fields.length > 0) {
      setFields(data.fields)
    }
    if (data?.welcome_pack) {
      setWelcomePack(data.welcome_pack)
    }
    if (data?.offboarding_template) {
      setOffboardingTemplate(data.offboarding_template)
    }
    setLoading(false)
  }

  function addField() {
    if (!newLabel.trim()) return
    const id = newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_')
    setFields(prev => [...prev, { id, label: newLabel, placeholder: '' }])
    setNewLabel('')
  }

  function removeField(id: string) {
    setFields(prev => prev.filter(f => f.id !== id))
  }

  function updateLabel(id: string, label: string) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, label } : f))
  }

  async function save() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase
      .from('onboarding_templates')
      .upsert({ user_id: userId, fields, welcome_pack: welcomePack, offboarding_template: offboardingTemplate, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
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
        <div className="screen-title">Onboarding template</div>
        <div className="context-bar" style={{ background: '#f7f7f5', color: '#6b6b6b' }}>
          Customize the questions you fill in when onboarding a new hire. This applies to every employee going forward.
        </div>

        <div className="card">
          <div className="section-label">Your fields</div>
          <div className="template-fields">
            {fields.map(field => (
              <div key={field.id} className="template-field-row">
                <input
                  value={field.label}
                  onChange={e => updateLabel(field.id, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="delete-btn" style={{ opacity: 1 }} onClick={() => removeField(field.id)}>×</button>
              </div>
            ))}
          </div>

          <div className="template-add-row">
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="e.g. Food handler's permit"
              onKeyDown={e => e.key === 'Enter' && addField()}
            />
            <button className="btn" onClick={addField}>+ Add field</button>
          </div>

          <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ marginTop: '1.25rem', width: 'auto' }}>
            {saving ? 'Saving...' : 'Save template'}
          </button>
          {saveMsg && <div className="done-msg">{saveMsg}</div>}
        </div>

        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="section-label">Welcome pack template</div>
          <div className="context-bar" style={{ background: '#f7f7f5', color: '#6b6b6b', marginBottom: '1rem' }}>
            Write your welcome pack once. Use <strong>{'{{employee_name}}'}</strong> and any field name in double curly braces — e.g. <strong>{'{{startTime}}'}</strong>, <strong>{'{{payRate}}'}</strong> — and they'll be filled in automatically when you onboard someone.
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Click to insert</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {[
                { id: 'employee_name', label: 'Employee name' },
                { id: 'phone', label: 'Phone' },
                { id: 'email', label: 'Email' },
                { id: 'address', label: 'Address' },
                { id: 'role', label: 'Role' },
                { id: 'start', label: 'Start date' },
                { id: 'emergency_contact', label: 'Emergency contact' },
                { id: 'date_of_birth', label: 'Date of birth' },
                ...fields.map(f => ({ id: f.id, label: f.label })),
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setWelcomePack(prev => prev + `{{${id}}}`)}
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
            value={welcomePack}
            onChange={e => setWelcomePack(e.target.value)}
            placeholder={`Hi {{employee_name}},\n\nWelcome to the team! Your start time is {{startTime}} and your pay rate is {{payRate}}.\n\n...`}
            style={{ minHeight: '260px', fontFamily: 'inherit', fontSize: '14px' }}
          />
          <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ marginTop: '1rem', width: 'auto' }}>
            {saving ? 'Saving...' : 'Save template'}
          </button>
          {saveMsg && <div className="done-msg">{saveMsg}</div>}
        </div>

        <DocumentLibrary userId={userId} />
      </div>
    </div>
  )
}
