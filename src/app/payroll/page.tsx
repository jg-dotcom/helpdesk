'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

type Employee = {
  id: number
  name: string
  role: string
  type: string
  status: string
  pay_type: string
  pay_rate: number | null
  pay_period: string
}

type PayrollEntry = {
  id: number
  employee_id: number
  period_start: string
  period_end: string
  hours_worked: number | null
  gross_pay: number
  notes: string | null
  paid_at: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

type PayPeriod = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly'

function getPeriodForType(type: PayPeriod) {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()

  if (type === 'weekly') {
    const start = new Date(today)
    start.setDate(d - today.getDay())
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }
  if (type === 'biweekly') {
    const startOffset = today.getDay() % 14
    const start = new Date(today)
    start.setDate(d - startOffset)
    const end = new Date(start)
    end.setDate(start.getDate() + 13)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }
  if (type === 'semi-monthly') {
    const start = new Date(y, m, d < 16 ? 1 : 16)
    const end = d < 16
      ? new Date(y, m, 15)
      : new Date(y, m + 1, 0)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }
  // monthly
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export default function PayrollPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview')

  // Log payment form
  const [showForm, setShowForm] = useState(false)
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null)
  const [payPeriodType, setPayPeriodType] = useState<PayPeriod>('biweekly')
  const defaultPeriod = getPeriodForType('biweekly')
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start)
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end)

  function handlePeriodTypeChange(type: PayPeriod) {
    setPayPeriodType(type)
    const p = getPeriodForType(type)
    setPeriodStart(p.start)
    setPeriodEnd(p.end)
  }
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)

    const [{ data: emps }, { data: payroll }] = await Promise.all([
      supabase.from('employees').select('id, name, role, type, status, pay_type, pay_rate, pay_period').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('payroll_entries').select('*').eq('user_id', session.user.id).order('period_start', { ascending: false }),
    ])

    if (emps) setEmployees(emps)
    if (payroll) setEntries(payroll)
    setLoading(false)
  }

  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  function calcGrossPay() {
    if (!selectedEmp?.pay_rate) return 0
    if (selectedEmp.pay_type === 'salary') return selectedEmp.pay_rate / 26
    return (parseFloat(hours) || 0) * selectedEmp.pay_rate
  }

  async function handleSubmit() {
    if (!selectedEmp) { setSaveMsg('Select an employee.'); return }
    if (!selectedEmp.pay_rate) { setSaveMsg('Set a pay rate on the employee first.'); return }
    if (selectedEmp.pay_type === 'hourly' && !hours) { setSaveMsg('Enter hours worked.'); return }
    setSaving(true)
    setSaveMsg('')

    const gross = calcGrossPay()
    const { error } = await supabase.from('payroll_entries').insert([{
      user_id: userId,
      employee_id: selectedEmp.id,
      period_start: periodStart,
      period_end: periodEnd,
      hours_worked: selectedEmp.pay_type === 'hourly' ? parseFloat(hours) : null,
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
      setSelectedEmpId(null)
      setTimeout(() => setSaveMsg(''), 2000)
      load()
    }
    setSaving(false)
  }

  function exportCSV() {
    const rows = [
      ['Employee', 'Period Start', 'Period End', 'Hours Worked', 'Gross Pay', 'Notes', 'Paid At'],
      ...entries.map(e => {
        const emp = employees.find(em => em.id === e.employee_id)
        return [
          emp?.name ?? e.employee_id,
          e.period_start,
          e.period_end,
          e.hours_worked ?? '',
          e.gross_pay,
          e.notes ?? '',
          formatDate(e.paid_at),
        ]
      })
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'payroll-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalThisPeriod = entries
    .filter(e => e.period_start === defaultPeriod.start)
    .reduce((sum, e) => sum + e.gross_pay, 0)

  const totalAllTime = entries.reduce((sum, e) => sum + e.gross_pay, 0)

  const empEntryMap: Record<number, PayrollEntry[]> = {}
  entries.forEach(e => {
    if (!empEntryMap[e.employee_id]) empEntryMap[e.employee_id] = []
    empEntryMap[e.employee_id].push(e)
  })

  return (
    <div className="dash-wrap">
      <div className="dash-nav">
        <div className="dash-nav-left">
          <div className="logo">help<span>desk</span></div>
          <nav className="dash-nav-links">
            <a href="/" className="dash-nav-link">Dashboard</a>
            <div className="dash-nav-link active">Payroll</div>
          </nav>
        </div>
      </div>

      <div className="dash-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700 }}>Payroll</div>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select
                value={payPeriodType}
                onChange={e => handlePeriodTypeChange(e.target.value as PayPeriod)}
                style={{ fontSize: '13px', border: 'none', background: 'transparent', color: '#666', cursor: 'pointer', padding: 0 }}
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semi-monthly">Semi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
              · {formatDate(periodStart)} – {formatDate(periodEnd)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {entries.length > 0 && (
              <button className="btn" style={{ fontSize: '13px', padding: '7px 14px' }} onClick={exportCSV}>Export CSV</button>
            )}
            <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => setShowForm(v => !v)}>
              {showForm ? 'Cancel' : '+ Log payment'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="dash-stats" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card">
            <div className="stat-label">This period</div>
            <div className="stat-value">{formatMoney(totalThisPeriod)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total paid (all time)</div>
            <div className="stat-value">{formatMoney(totalAllTime)}</div>
          </div>
        </div>

        {/* Log payment form */}
        {showForm && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Log a payment</div>
            <div className="row2" style={{ marginBottom: '0.75rem' }}>
              <div className="field">
                <label>Employee</label>
                <select value={selectedEmpId ?? ''} onChange={e => {
                  const id = Number(e.target.value)
                  setSelectedEmpId(id)
                  const emp = employees.find(em => em.id === id)
                  if (emp?.pay_period) {
                    const p = getPeriodForType(emp.pay_period as PayPeriod)
                    setPayPeriodType(emp.pay_period as PayPeriod)
                    setPeriodStart(p.start)
                    setPeriodEnd(p.end)
                  }
                }}>
                  <option value="">Select employee...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} — {emp.pay_type === 'salary' ? `${formatMoney(emp.pay_rate ?? 0)}/yr` : `${formatMoney(emp.pay_rate ?? 0)}/hr`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Pay period</label>
                <select value={payPeriodType} onChange={e => handlePeriodTypeChange(e.target.value as PayPeriod)}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="semi-monthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
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
            {selectedEmp?.pay_type === 'hourly' && (
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Hours worked</label>
                <input type="number" value={hours} onChange={e => setHours(e.target.value)} placeholder="80" step="0.5" />
              </div>
            )}
            {selectedEmp?.pay_rate && (selectedEmp.pay_type === 'salary' || hours) ? (
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

        {/* Tabs */}
        <div className="profile-tabs" style={{ marginBottom: '1rem' }}>
          <button className={`profile-tab${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>By employee</button>
          <button className={`profile-tab${activeTab === 'history' ? ' active' : ''}`} onClick={() => setActiveTab('history')}>Full history</button>
        </div>

        {loading ? (
          <div className="card"><div className="empty-state">Loading...</div></div>
        ) : activeTab === 'overview' ? (
          <div className="card">
            {employees.length === 0 ? (
              <div className="empty-state">No active employees.</div>
            ) : (
              <div className="upload-list">
                {employees.map(emp => {
                  const empEntries = empEntryMap[emp.id] || []
                  const total = empEntries.reduce((sum, e) => sum + e.gross_pay, 0)
                  const last = empEntries[0]
                  return (
                    <div key={emp.id} className="upload-item" style={{ cursor: 'pointer' }} onClick={() => router.push(`/employees/${emp.id}`)}>
                      <div className="emp-initials">{emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</div>
                      <div style={{ flex: 1 }}>
                        <div className="upload-name">{emp.name}</div>
                        <div className="upload-meta">
                          {emp.pay_type === 'salary'
                            ? `${formatMoney(emp.pay_rate ?? 0)}/yr · ${formatMoney((emp.pay_rate ?? 0) / 26)} per period`
                            : `${formatMoney(emp.pay_rate ?? 0)}/hr`}
                          {last ? ` · Last paid ${formatDate(last.paid_at)}` : ' · Not yet paid'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: '#185fa5' }}>{formatMoney(total)}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>total paid</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            {entries.length === 0 ? (
              <div className="empty-state">No payments logged yet.</div>
            ) : (
              <div className="upload-list">
                {entries.map(entry => {
                  const emp = employees.find(e => e.id === entry.employee_id)
                  return (
                    <div key={entry.id} className="upload-item">
                      <div className="upload-icon">💵</div>
                      <div style={{ flex: 1 }}>
                        <div className="upload-name">{emp?.name ?? 'Unknown'}</div>
                        <div className="upload-meta">
                          {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                          {entry.hours_worked != null ? ` · ${entry.hours_worked} hrs` : ''}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </div>
                      </div>
                      <span style={{ fontWeight: 600, color: '#185fa5', fontSize: '14px' }}>{formatMoney(entry.gross_pay)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
