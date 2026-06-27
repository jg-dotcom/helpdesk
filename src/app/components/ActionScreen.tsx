'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Employee, ActionType } from '../page'

type Props = {
  employee: Employee
  action: ActionType
  onBack: () => void
  onDocDone: () => void
  userId: string
}

const titles = { onboarding: 'Welcome pack', checkin: 'Check-in note', offboarding: 'Offboarding plan' }

export default function ActionScreen({ employee, action, onBack, onDocDone, userId }: Props) {
  const [notes, setNotes] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('New job')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')
  const [saved, setSaved] = useState(false)

  async function generate() {
    setLoading(true)
    setDoneMsg('')
    setSaved(false)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employee, notes, lastDay, reason }),
      })
      const data = await res.json()
      setOutput(data.text || 'Error generating response.')
    } catch {
      setOutput('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  function copyDoc() {
    navigator.clipboard.writeText(output).then(() => {
      setDoneMsg('Copied to clipboard.')
      setTimeout(() => setDoneMsg(''), 2000)
    })
  }

  async function markDone() {
    if (saved) {
      setDoneMsg('Already saved.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('documents').insert([{
      type: action,
      employee_name: employee.name,
      content: output,
      user_id: userId,
    }])
    if (error) {
      setDoneMsg('Error saving. Try again.')
    } else {
      setSaved(true)
      setDoneMsg('Saved to records.')
      onDocDone()
    }
    setSaving(false)
  }

  if (!action) return null

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">help<span>desk</span></div>
      </div>

      <button className="back-btn" onClick={onBack}>← Back</button>

      <div className="screen-title">{titles[action]}</div>
      <div className="context-bar">
        For {employee.name} · {employee.role} · {employee.type}
      </div>

      <div className="card">
        {action === 'checkin' && (
          <div className="field">
            <label>Quick notes (what happened?)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Always on time, great with customers. Needs to improve inventory accuracy."
            />
          </div>
        )}

        {action === 'offboarding' && (
          <div className="row2">
            <div className="field">
              <label>Last day</label>
              <input type="date" value={lastDay} onChange={e => setLastDay(e.target.value)} />
            </div>
            <div className="field">
              <label>Reason for leaving</label>
              <select value={reason} onChange={e => setReason(e.target.value)}>
                <option>New job</option>
                <option>Personal reasons</option>
                <option>Seasonal end</option>
                <option>Let go</option>
                <option>Retirement</option>
              </select>
            </div>
          </div>
        )}

        <div className="actions-row">
          <button className="btn" onClick={generate} disabled={loading}>
            {loading ? 'Generating...' : '✦ Generate with AI'}
          </button>
          {loading && <div className="spinner" />}
        </div>
      </div>

      {output && (
        <div className="card">
          <div className="section-label">Generated document</div>
          <div className="output">{output}</div>
          <div className="doc-actions">
            <button className="doc-btn" onClick={copyDoc}>Copy</button>
            <button className="doc-btn" onClick={markDone} disabled={saving || saved}>
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save to records'}
            </button>
            <button className="doc-btn" onClick={generate}>Regenerate</button>
          </div>
          {doneMsg && <div className="done-msg">{doneMsg}</div>}
        </div>
      )}
    </div>
  )
}
