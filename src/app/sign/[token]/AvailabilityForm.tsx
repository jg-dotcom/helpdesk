'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type DayAvail = {
  enabled: boolean
  start: string
  end: string
}

const DEFAULT_AVAIL: DayAvail[] = DAYS.map(() => ({ enabled: false, start: '09:00', end: '17:00' }))

export default function AvailabilityForm({ employeeId }: { employeeId: number }) {
  const [avail, setAvail] = useState<DayAvail[]>(DEFAULT_AVAIL)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('employee_availability')
        .select('*')
        .eq('employee_id', employeeId)
      if (data && data.length > 0) {
        const next = [...DEFAULT_AVAIL.map(d => ({ ...d }))]
        data.forEach(row => {
          next[row.day_of_week] = { enabled: true, start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) }
        })
        setAvail(next)
      }
      setLoaded(true)
    }
    load()
  }, [employeeId])

  function toggle(i: number) {
    setAvail(prev => prev.map((d, idx) => idx === i ? { ...d, enabled: !d.enabled } : d))
  }

  function setTime(i: number, field: 'start' | 'end', value: string) {
    setAvail(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d))
  }

  async function save() {
    setSaving(true)
    setMsg('')

    // Delete existing and re-insert
    await supabase.from('employee_availability').delete().eq('employee_id', employeeId)

    const rows = avail
      .map((d, i) => ({ enabled: d.enabled, day: i, start: d.start, end: d.end }))
      .filter(d => d.enabled)
      .map(d => ({
        employee_id: employeeId,
        day_of_week: d.day,
        start_time: d.start,
        end_time: d.end,
      }))

    if (rows.length > 0) {
      const { error } = await supabase.from('employee_availability').insert(rows)
      if (error) { setMsg('Error saving. Try again.'); setSaving(false); return }
    }

    setMsg('Availability saved!')
    setTimeout(() => setMsg(''), 3000)
    setSaving(false)
  }

  if (!loaded) return null

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
      <div className="sign-section-label">My Availability</div>
      <p style={{ fontSize: '13px', color: '#666', marginTop: '0.25rem', marginBottom: '1rem' }}>
        Let your employer know which days and hours you're available to work.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {DAYS.map((day, i) => (
          <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div
              onClick={() => toggle(i)}
              style={{
                width: '90px',
                fontSize: '13px',
                fontWeight: avail[i].enabled ? 600 : 400,
                color: avail[i].enabled ? '#185fa5' : '#999',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <div style={{
                width: '16px', height: '16px', borderRadius: '4px',
                border: `2px solid ${avail[i].enabled ? '#185fa5' : '#ccc'}`,
                background: avail[i].enabled ? '#185fa5' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {avail[i].enabled && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>✓</span>}
              </div>
              {day}
            </div>
            {avail[i].enabled && (
              <>
                <input type="time" value={avail[i].start} onChange={e => setTime(i, 'start', e.target.value)}
                  style={{ fontSize: '13px', padding: '4px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
                <span style={{ fontSize: '13px', color: '#666' }}>to</span>
                <input type="time" value={avail[i].end} onChange={e => setTime(i, 'end', e.target.value)}
                  style={{ fontSize: '13px', padding: '4px 8px', border: '1px solid #dde1ea', borderRadius: '6px' }} />
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save availability'}
        </button>
        {msg && <div className="done-msg">{msg}</div>}
      </div>
    </div>
  )
}
