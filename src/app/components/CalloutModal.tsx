'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PhoneIcon, MessageIcon, MailIcon } from './Icons'
import { formatDate as sharedFormatDate } from '../../lib/formatDate'

type Employee = {
  id: number
  name: string
  role: string
  phone: string
  email: string
}

type Props = {
  shiftId: number
  shiftDate: string
  startTime: string
  endTime: string
  calledOutEmployee: { id: number; name: string }
  onClose: () => void
  onCalloutMarked: (shiftId: number) => void
}

function formatTime(t: string) {
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2)
}

export default function CalloutModal({ shiftId, shiftDate, startTime, endTime, calledOutEmployee, onClose, onCalloutMarked }: Props) {
  const [eligible, setEligible] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const [marked, setMarked] = useState(false)

  useEffect(() => {
    loadEligible()
  }, [])

  async function loadEligible() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    // Get all active employees except the one who called out
    const { data: allEmps } = await supabase
      .from('employees')
      .select('id, name, role, phone, email')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .neq('id', calledOutEmployee.id)

    if (!allEmps) { setLoading(false); return }

    // Get shifts already on this date (to exclude already-scheduled employees)
    const { data: dayShifts } = await supabase
      .from('shifts')
      .select('employee_id')
      .eq('user_id', session.user.id)
      .eq('shift_date', shiftDate)
      .neq('employee_id', calledOutEmployee.id)

    const alreadyScheduled = new Set((dayShifts ?? []).map(s => s.employee_id))

    // Get approved time off covering this date
    const { data: timeOff } = await supabase
      .from('time_off_requests')
      .select('employee_id')
      .eq('user_id', session.user.id)
      .eq('status', 'approved')
      .lte('start_date', shiftDate)
      .gte('end_date', shiftDate)

    const onLeave = new Set((timeOff ?? []).map(r => r.employee_id))

    const filtered = allEmps.filter(e => !alreadyScheduled.has(e.id) && !onLeave.has(e.id))
    setEligible(filtered)
    setLoading(false)
  }

  async function notifyAll() {
    setSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setSending(false); return }

    const res = await fetch('/api/callout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        shiftId,
        shiftDate,
        startTime,
        endTime,
        calledOutEmployeeId: calledOutEmployee.id,
        eligibleEmployeeIds: eligible.map(e => e.id),
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setSent(data.sent)
      setMarked(true)
      onCalloutMarked(shiftId)
    }
    setSending(false)
  }

  async function markCalloutOnly() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch('/api/callout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ shiftId, shiftDate, startTime, endTime, calledOutEmployeeId: calledOutEmployee.id, eligibleEmployeeIds: [] }),
    })
    setMarked(true)
    onCalloutMarked(shiftId)
  }

  const smsBody = encodeURIComponent(
    `Hi, we have an open shift on ${sharedFormatDate(shiftDate, 'weekdayShort')} from ${formatTime(startTime)} to ${formatTime(endTime)}. Can you cover it? Reply ASAP — first to confirm gets it.`
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--accent-text)', borderRadius: '14px', padding: '1.5rem', width: '500px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Find shift coverage</div>
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
              <span style={{ fontWeight: 600, color: 'var(--error)' }}>{calledOutEmployee.name}</span> called out
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {sharedFormatDate(shiftDate, 'weekdayShort')} · {formatTime(startTime)} – {formatTime(endTime)}
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: '22px', lineHeight: 1, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {/* Status banner */}
        {marked && (
          <div style={{ background: 'var(--bg-success)', border: '1px solid var(--success)', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', fontSize: '13px', color: 'var(--success)', fontWeight: 500 }}>
            {sent !== null ? `Shift marked as called out. Email sent to ${sent} employee${sent !== 1 ? 's' : ''}.` : 'Shift marked as called out.'}
          </div>
        )}

        {/* Eligible employees */}
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-tertiary)' }}>
          {loading ? 'Finding available employees...' : `${eligible.length} available employee${eligible.length !== 1 ? 's' : ''}`}
        </div>

        {!loading && eligible.length === 0 && (
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
            No available employees — everyone is either already scheduled or on approved leave.
          </div>
        )}

        {!loading && eligible.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
            {eligible.map(emp => (
              <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.75rem', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-info)', color: 'var(--accent)', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {initials(emp.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{emp.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{emp.role}{emp.phone ? ` · ${emp.phone}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                  {emp.phone && (
                    <>
                      <a
                        href={`tel:${emp.phone.replace(/\D/g, '')}`}
                        style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        title="Call"
                      >
                        <PhoneIcon size={13} /> Call
                      </a>
                      <a
                        href={`sms:${emp.phone.replace(/\D/g, '')}?body=${smsBody}`}
                        style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        title="Text"
                      >
                        <MessageIcon size={13} /> Text
                      </a>
                    </>
                  )}
                  {!emp.phone && (
                    <span style={{ fontSize: '11px', color: 'var(--border)' }}>No phone</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          {!marked && eligible.length > 0 && (
            <button
              onClick={notifyAll}
              disabled={sending}
              style={{ fontSize: '13px', padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontWeight: 600, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {sending ? 'Sending...' : <><MailIcon size={13} /> Email all {eligible.length} available</>}
            </button>
          )}
          {!marked && (
            <button
              onClick={markCalloutOnly}
              style={{ fontSize: '13px', padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', cursor: 'pointer', fontWeight: 500 }}
            >
              Mark called out only
            </button>
          )}
          <button
            onClick={onClose}
            style={{ fontSize: '13px', padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', cursor: 'pointer', fontWeight: 500 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
