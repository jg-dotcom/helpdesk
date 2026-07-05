'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type PayrollEntry = {
  id: number
  period_start: string
  period_end: string
  hours_worked: number | null
  gross_pay: number
  notes: string | null
  paid_at: string
}

type Props = {
  employeeId: number
  payType: string
  payRate: number | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// Get the most recent biweekly period start (Sunday-based)
function getDefaultPeriod() {
  const today = new Date()
  const day = today.getDay()
  const startOffset = day % 14
  const start = new Date(today)
  start.setDate(today.getDate() - startOffset)
  const end = new Date(start)
  end.setDate(start.getDate() + 13)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export default function PayrollTab({ employeeId, payType, payRate }: Props) {
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const defaultPeriod = getDefaultPeriod()
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start)
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end)
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    load()
  }, [employeeId])

  async function load() {
    const { data } = await supabase
      .from('payroll_entries')
      .select('*')
      .eq('employee_id', employeeId)
      .order('period_start', { ascending: false })
    if (data) setEntries(data)
    setLoading(false)
  }

  function calcGrossPay() {
    if (!payRate) return 0
    if (payType === 'salary') {
      return payRate / 26 // biweekly
    }
    return (parseFloat(hours) || 0) * payRate
  }

  async function handleSubmit() {
    if (!payRate) { setSaveMsg('Set a pay rate on the employee first.'); return }
    if (payType === 'hourly' && !hours) { setSaveMsg('Enter hours worked.'); return }
    setSaving(true)
    setSaveMsg('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const gross = calcGrossPay()
    const { error } = await supabase.from('payroll_entries').insert([{
      user_id: session.user.id,
      employee_id: employeeId,
      period_start: periodStart,
      period_end: periodEnd,
      hours_worked: payType === 'hourly' ? parseFloat(hours) : null,
      gross_pay: gross,
      notes: notes.trim() || null,
    }])

    if (error) {
      setSaveMsg('Error saving. Try again.')
    } else {
      setSaveMsg('Saved.')
      setShowForm(false)
      setHours('')
      setNotes('')
      setTimeout(() => setSaveMsg(''), 2000)
      load()
    }
    setSaving(false)
  }

  function exportCSV() {
    const rows = [
      ['Period Start', 'Period End', 'Hours Worked', 'Gross Pay', 'Notes', 'Paid At'],
      ...entries.map(e => [
        e.period_start,
        e.period_end,
        e.hours_worked ?? '',
        e.gross_pay,
        e.notes ?? '',
        formatDate(e.paid_at),
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payroll-employee-${employeeId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPaid = entries.reduce((sum, e) => sum + e.gross_pay, 0)

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>Payroll history</div>
          {payRate ? (
            <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>
              {payType === 'salary'
                ? `${formatMoney(payRate)}/yr · ${formatMoney(payRate / 26)} per period`
                : `${formatMoney(payRate)}/hr`}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#c0392b', marginTop: '2px' }}>No pay rate set — edit employee info first.</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {entries.length > 0 && (
            <button className="btn" style={{ fontSize: '13px', padding: '6px 12px' }} onClick={exportCSV}>Export CSV</button>
          )}
          <button className="btn auth-btn-primary" style={{ fontSize: '13px', padding: '6px 14px', width: 'auto' }} onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ Log payment'}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: '#f8f9fb', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', border: '1px solid #e8eaf0' }}>
          <div className="row2" style={{ marginBottom: '0.75rem' }}>
            <div className="field">
              <label>Period start</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Period end</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          {payType === 'hourly' && (
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Hours worked</label>
              <input type="number" value={hours} onChange={e => setHours(e.target.value)} placeholder="80" step="0.5" />
            </div>
          )}

          {(payType === 'salary' || hours) && payRate ? (
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#185fa5', marginBottom: '0.75rem' }}>
              Gross pay: {formatMoney(calcGrossPay())}
            </div>
          ) : null}

          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. included overtime" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn auth-btn-primary" style={{ width: 'auto' }} onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : 'Save payment'}
            </button>
            {saveMsg && <div className="done-msg">{saveMsg}</div>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No payments logged yet.</div>
      ) : (
        <>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '0.75rem' }}>
            Total paid: <strong>{formatMoney(totalPaid)}</strong> across {entries.length} period{entries.length !== 1 ? 's' : ''}
          </div>
          <div className="upload-list">
            {entries.map(entry => (
              <div key={entry.id} className="upload-item">
                <div className="upload-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
                <div style={{ flex: 1 }}>
                  <div className="upload-name">
                    {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                  </div>
                  <div className="upload-meta">
                    {entry.hours_worked != null ? `${entry.hours_worked} hrs · ` : ''}
                    {entry.notes ? `${entry.notes} · ` : ''}
                    {formatDate(entry.paid_at)}
                  </div>
                </div>
                <span style={{ fontWeight: 600, color: '#185fa5', fontSize: '14px' }}>{formatMoney(entry.gross_pay)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
