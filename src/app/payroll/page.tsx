'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import { DollarIcon } from '../components/Icons'
import { useToast } from '../components/Toast'

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

type PayrollRun = {
  id: number
  period_start: string
  period_end: string
  run_date: string
  status: 'draft' | 'finalized'
  total_gross: number
  employee_count: number
  notes: string | null
}

type PayrollRunItem = {
  id: number
  run_id: number
  employee_id: number
  employee_name: string
  pay_type: string
  pay_rate: number
  hours_worked: number | null
  gross_pay: number
  deductions: { federal: number; state: number; other: number }
  net_pay: number
  notes: string | null
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
  const { showToast } = useToast()
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'overview' | 'history' | 'runs'>('dashboard')

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

  // Payroll runs state
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [accountantEmail, setAccountantEmail] = useState<string>('')
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [expandedRun, setExpandedRun] = useState<number | null>(null)
  const [runItems, setRunItems] = useState<Record<number, PayrollRunItem[]>>({})
  const [runPeriodStart, setRunPeriodStart] = useState(defaultPeriod.start)
  const [runPeriodEnd, setRunPeriodEnd] = useState(defaultPeriod.end)
  const [runNotes, setRunNotes] = useState('')
  const [runCreating, setRunCreating] = useState(false)
  const [savingDeductions, setSavingDeductions] = useState<number | null>(null)
  const [editDeductions, setEditDeductions] = useState<Record<number, { federal: string; state: string; other: string }>>({})

  // Pre-payroll confidence check — read-only flags before you run, not after
  const [hoursAnomalies, setHoursAnomalies] = useState<{ employeeId: number; employeeName: string; hoursThisPeriod: number; avgHours: number }[]>([])
  const [clockOverlaps, setClockOverlaps] = useState<{ employeeId: number; employeeName: string; count: number }[]>([])
  const [openTimeEntries, setOpenTimeEntries] = useState<{ employeeId: number; employeeName: string; clockIn: string; hoursOpen: number }[]>([])
  const [paidTimeOff, setPaidTimeOff] = useState<{ requestCount: number; totalHours: number }>({ requestCount: 0, totalHours: 0 })

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)
    const token = session.access_token
    setSessionToken(token)

    const [{ data: emps }, { data: payroll }, runsRes, bizRes] = await Promise.all([
      supabase.from('employees').select('id, name, role, type, status, pay_type, pay_rate, pay_period').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('payroll_entries').select('*').eq('user_id', session.user.id).order('period_start', { ascending: false }),
      fetch('/api/payroll/run', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/settings/business', { headers: { Authorization: `Bearer ${token}` } }),
    ])

    if (emps) setEmployees(emps)
    if (payroll) setEntries(payroll)
    if (runsRes.ok) {
      const d = await runsRes.json()
      setRuns(d.runs ?? [])
    }
    if (bizRes.ok) {
      const biz = await bizRes.json()
      setAccountantEmail(biz.profile?.accountant_email ?? '')
    }

    try {
      const confidenceRes = await fetch(
        `/api/payroll/confidence-check?periodStart=${defaultPeriod.start}&periodEnd=${defaultPeriod.end}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (confidenceRes.ok) {
        const c = await confidenceRes.json()
        setHoursAnomalies(c.hoursAnomalies ?? [])
        setClockOverlaps(c.overlaps ?? [])
        setOpenTimeEntries(c.openTimeEntries ?? [])
        setPaidTimeOff(c.paidTimeOff ?? { requestCount: 0, totalHours: 0 })
      }
    } catch {
      // advisory only — a failed check should never block the rest of the page
    }

    setLoading(false)
  }

  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  function calcGrossPay() {
    if (!selectedEmp?.pay_rate) return 0
    if (selectedEmp.pay_type === 'salary') return selectedEmp.pay_rate / 26
    return (parseFloat(hours) || 0) * selectedEmp.pay_rate
  }

  async function handleSubmit() {
    if (!selectedEmp) { showToast('Select an employee.', 'error'); return }
    if (!selectedEmp.pay_rate) { showToast('Set a pay rate on the employee first.', 'error'); return }
    if (selectedEmp.pay_type === 'hourly' && !hours) { showToast('Enter hours worked.', 'error'); return }
    setSaving(true)

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
      showToast('Error saving. Try again.', 'error')
    } else {
      showToast('Saved.', 'success')
      setShowForm(false)
      setHours('')
      setNotes('')
      setSelectedEmpId(null)
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

  async function loadRunItems(runId: number, token: string) {
    const res = await fetch(`/api/payroll/run/${runId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      setRunItems(prev => ({ ...prev, [runId]: data.items ?? [] }))
    }
  }

  async function reloadRuns(token: string) {
    const res = await fetch('/api/payroll/run', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const d = await res.json()
      setRuns(d.runs ?? [])
    }
  }

  async function createRun() {
    if (!sessionToken) return
    setRunCreating(true)
    const res = await fetch('/api/payroll/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: runPeriodStart, periodEnd: runPeriodEnd, notes: runNotes.trim() || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      showToast(data.error ?? 'Failed to create run.', 'error')
    } else {
      showToast('Run created.', 'success')
      await reloadRuns(sessionToken)
    }
    setRunCreating(false)
  }

  async function finalizeRun(runId: number) {
    if (!sessionToken) return
    await fetch(`/api/payroll/run/${runId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finalize' }),
    })
    await reloadRuns(sessionToken)
    // Reload items for this run if expanded
    loadRunItems(runId, sessionToken)
  }

  async function saveDeductions(item: PayrollRunItem) {
    if (!sessionToken) return
    setSavingDeductions(item.id)
    const ed = editDeductions[item.id] ?? { federal: '0', state: '0', other: '0' }
    const deductions = {
      federal: parseFloat(ed.federal) || 0,
      state: parseFloat(ed.state) || 0,
      other: parseFloat(ed.other) || 0,
    }
    const res = await fetch(`/api/payroll/run/${item.run_id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, deductions }),
    })
    if (res.ok) {
      setEditDeductions(prev => { const n = { ...prev }; delete n[item.id]; return n })
      await loadRunItems(item.run_id, sessionToken)
      await reloadRuns(sessionToken)
    }
    setSavingDeductions(null)
  }

  function downloadPayStubs(runId: number, employeeId?: number) {
    if (!sessionToken) return
    const url = employeeId
      ? `/api/payroll/run/${runId}/paystub?employeeId=${employeeId}`
      : `/api/payroll/run/${runId}/paystub`
    fetch(url, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = employeeId ? `paystub-${employeeId}-${runId}.pdf` : `paystubs-${runId}.pdf`
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }

  function downloadReport(run: PayrollRun) {
    if (!sessionToken) return
    fetch(`/api/payroll/run/${run.id}/report`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `payroll-report-${run.period_end}.pdf`
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }

  function exportRunCSV(run: PayrollRun, items: PayrollRunItem[]) {
    const rows = [
      ['Employee', 'Pay Type', 'Hours Worked', 'Pay Rate', 'Gross Pay', 'Federal Tax', 'State Tax', 'Other Deductions', 'Net Pay'],
      ...items.map(item => {
        const d = (item.deductions ?? {}) as Record<string, number>
        return [
          item.employee_name,
          item.pay_type,
          item.hours_worked != null ? item.hours_worked : '',
          item.pay_rate,
          item.gross_pay,
          d.federal ?? 0,
          d.state ?? 0,
          d.other ?? 0,
          item.net_pay,
        ]
      }),
      ['TOTAL', '', '', '',
        items.reduce((s, i) => s + i.gross_pay, 0),
        items.reduce((s, i) => s + ((i.deductions as any)?.federal ?? 0), 0),
        items.reduce((s, i) => s + ((i.deductions as any)?.state ?? 0), 0),
        items.reduce((s, i) => s + ((i.deductions as any)?.other ?? 0), 0),
        items.reduce((s, i) => s + i.net_pay, 0),
      ],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payroll-${run.period_end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function sendToAccountant(run: PayrollRun) {
    if (!sessionToken) return
    // Download the PDF first
    const res = await fetch(`/api/payroll/run/${run.id}/report`, { headers: { Authorization: `Bearer ${sessionToken}` } })
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payroll-report-${run.period_end}.pdf`
    a.click()
    URL.revokeObjectURL(a.href)
    // Open email client
    const subject = encodeURIComponent(`Payroll Report — ${formatDate(run.period_start)} – ${formatDate(run.period_end)}`)
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the attached payroll report for the pay period ${formatDate(run.period_start)} – ${formatDate(run.period_end)}.\n\nGross total: ${formatMoney(run.total_gross)}\nEmployees: ${run.employee_count}\n\nPlease review and let me know what deductions to apply for each employee.\n\nThank you`
    )
    const to = accountantEmail ? encodeURIComponent(accountantEmail) : ''
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`
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

  // Needs attention — forward-looking, so you see what's outstanding before running
  // payroll rather than only reviewing what's already been paid.
  const missingPayRate = employees.filter(e => !e.pay_rate)
  const notYetPaidThisPeriod = employees.filter(emp => {
    if (!emp.pay_rate) return false // already flagged separately
    const p = getPeriodForType((emp.pay_period || 'biweekly') as PayPeriod)
    return !(empEntryMap[emp.id] ?? []).some(e => e.period_start === p.start)
  })
  const draftRuns = runs.filter(r => r.status === 'draft')
  const hasAttentionItems = missingPayRate.length > 0 || notYetPaidThisPeriod.length > 0 || draftRuns.length > 0
    || hoursAnomalies.length > 0 || clockOverlaps.length > 0 || openTimeEntries.length > 0 || paidTimeOff.requestCount > 0

  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem' }
  const ghostBtn: React.CSSProperties = { fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }
  const primaryBtn: React.CSSProperties = { fontSize: '13px', padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
  const sectionLabel: React.CSSProperties = { fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }
  const emptyState: React.CSSProperties = { textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }

  return (
    <div className="dash-wrap">
      <Nav active="payroll" />

      <div className="dash-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Payroll</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Pay periods vary by employee</div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {entries.length > 0 && (
              <button style={ghostBtn} onClick={exportCSV}>Export CSV</button>
            )}
            <button style={primaryBtn} onClick={() => setShowForm(v => !v)}>
              {showForm ? 'Cancel' : '+ Log payment'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={cardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>This period</div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9' }}>{formatMoney(totalThisPeriod)}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Total paid (all time)</div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9' }}>{formatMoney(totalAllTime)}</div>
          </div>
        </div>

        {/* Needs attention */}
        {!loading && hasAttentionItems && (
          <div style={{ ...cardStyle, marginBottom: '1.25rem', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '0.75rem' }}>Needs attention</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {missingPayRate.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                  <span style={{ color: '#fbbf24' }}>●</span>
                  {missingPayRate.length} employee{missingPayRate.length !== 1 ? 's' : ''} {missingPayRate.length !== 1 ? 'have' : 'has'} no pay rate set
                  <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('overview')}>Review</button>
                </div>
              )}
              {notYetPaidThisPeriod.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                  <span style={{ color: '#fbbf24' }}>●</span>
                  {notYetPaidThisPeriod.length} employee{notYetPaidThisPeriod.length !== 1 ? 's' : ''} not yet paid for the current period
                  <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('overview')}>Review</button>
                </div>
              )}
              {draftRuns.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                  <span style={{ color: '#fbbf24' }}>●</span>
                  {draftRuns.length} pay run{draftRuns.length !== 1 ? 's' : ''} still in draft, not finalized
                  <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('runs')}>Review</button>
                </div>
              )}
              {(hoursAnomalies.length > 0 || clockOverlaps.length > 0 || openTimeEntries.length > 0 || paidTimeOff.requestCount > 0) && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Before you run</div>
                  {hoursAnomalies.map(a => (
                    <div key={`hours-${a.employeeId}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                      <span style={{ color: '#fbbf24' }}>●</span>
                      {a.employeeName} — {a.hoursThisPeriod} hrs this period (avg: {a.avgHours})
                      <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('overview')}>Review time entries</button>
                    </div>
                  ))}
                  {clockOverlaps.map(o => (
                    <div key={`overlap-${o.employeeId}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                      <span style={{ color: '#fbbf24' }}>●</span>
                      Overlapping clock-in/out for {o.employeeName} ({o.count} instance{o.count !== 1 ? 's' : ''})
                      <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('overview')}>Review time entries</button>
                    </div>
                  ))}
                  {openTimeEntries.map(o => (
                    <div key={`open-${o.employeeId}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                      <span style={{ color: '#fbbf24' }}>●</span>
                      {o.employeeName} — still clocked in since {new Date(o.clockIn).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ({o.hoursOpen}+ hrs, likely forgot to clock out)
                      <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: '11px' }} onClick={() => setActiveTab('overview')}>Review time entries</button>
                    </div>
                  ))}
                  {paidTimeOff.requestCount > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                      <span style={{ color: '#4ade80' }}>●</span>
                      {paidTimeOff.requestCount} approved paid time-off request{paidTimeOff.requestCount !== 1 ? 's' : ''} will add {paidTimeOff.totalHours.toFixed(1)} hrs to this period's pay (PTO/Sick/Personal — Unpaid excluded)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Log payment form */}
        {showForm && (
          <div style={{ ...cardStyle, marginBottom: '1.25rem' }}>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '1rem' }}>Log a payment</div>
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
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#93c5fd', marginBottom: '0.75rem' }}>
                Gross pay: {formatMoney(calcGrossPay())}
              </div>
            ) : null}
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. included overtime" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button style={primaryBtn} onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : 'Save payment'}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {([['dashboard', 'Dashboard'], ['overview', 'By employee'], ['history', 'Full history'], ['runs', 'Pay runs']] as [typeof activeTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{ padding: '8px 18px', fontWeight: activeTab === key ? 600 : 400, fontSize: '13px', color: activeTab === key ? '#93c5fd' : '#64748b', background: 'none', border: 'none', borderBottom: activeTab === key ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: '-1px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={cardStyle}><div style={emptyState}>Loading...</div></div>
        ) : activeTab === 'dashboard' ? (() => {
          const now = new Date()
          const thisMonth = now.getMonth()
          const thisYear = now.getFullYear()

          // YTD
          const ytd = entries.filter(e => new Date(e.period_start).getFullYear() === thisYear)
            .reduce((s, e) => s + e.gross_pay, 0)

          // This month
          const monthTotal = entries.filter(e => {
            const d = new Date(e.period_start)
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear
          }).reduce((s, e) => s + e.gross_pay, 0)

          // Last 12 periods grouped by month
          const byMonth: Record<string, number> = {}
          entries.forEach(e => {
            const d = new Date(e.period_start)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            byMonth[key] = (byMonth[key] || 0) + e.gross_pay
          })
          const sortedMonths = Object.keys(byMonth).sort().slice(-12)
          const monthValues = sortedMonths.map(k => byMonth[k])
          const maxMonthVal = Math.max(...monthValues, 1)

          // Cost by employee
          const empTotals: Record<number, number> = {}
          entries.forEach(e => { empTotals[e.employee_id] = (empTotals[e.employee_id] || 0) + e.gross_pay })
          const sortedEmps = Object.entries(empTotals)
            .map(([id, total]) => ({ emp: employees.find(em => em.id === Number(id)), total }))
            .filter(x => x.emp)
            .sort((a, b) => b.total - a.total)
            .slice(0, 8)
          const maxEmpVal = Math.max(...sortedEmps.map(x => x.total), 1)

          // Pay type split
          const hourlyCount = employees.filter(e => e.pay_type !== 'salary').length
          const salaryCount = employees.filter(e => e.pay_type === 'salary').length
          const totalEmps = employees.length || 1

          const avgPerPeriod = entries.length > 0
            ? entries.reduce((s, e) => s + e.gross_pay, 0) / new Set(entries.map(e => e.period_start)).size
            : 0

          const labelMonth = (key: string) => {
            const [y, m] = key.split('-')
            return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
          }

          return (
            <div>
              {entries.length === 0 ? (
                <div style={cardStyle}><div style={emptyState}>No payroll data yet — log some payments to see your dashboard.</div></div>
              ) : (
                <>
                  {/* Stat cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
                    <div style={cardStyle}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>This month</div>
                      <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>{formatMoney(monthTotal)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>YTD {thisYear}</div>
                      <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>{formatMoney(ytd)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Avg per period</div>
                      <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>{formatMoney(avgPerPeriod)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Active employees</div>
                      <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>{employees.length}</div>
                    </div>
                  </div>

                  {/* Payroll over time */}
                  {sortedMonths.length > 1 && (
                    <div style={{ ...cardStyle, marginBottom: '1.25rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9', marginBottom: '1.25rem' }}>Payroll by month</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '140px', paddingBottom: '24px', position: 'relative' }}>
                        {sortedMonths.map((key, i) => {
                          const val = byMonth[key]
                          const pct = val / maxMonthVal
                          const barH = Math.max(pct * 116, 4)
                          const isCurrentMonth = key === `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`
                          return (
                            <div key={key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '140px', justifyContent: 'flex-end' }}>
                              <div style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 600, opacity: pct > 0.5 ? 1 : 0 }}>
                                {formatMoney(val).replace('$', '$').split('.')[0]}
                              </div>
                              <div
                                title={`${labelMonth(key)}: ${formatMoney(val)}`}
                                style={{
                                  width: '100%', height: `${barH}px`, borderRadius: '4px 4px 0 0',
                                  background: isCurrentMonth ? '#3b82f6' : 'rgba(59,130,246,0.25)',
                                  transition: 'height 0.3s',
                                }}
                              />
                              <div style={{ fontSize: '9px', color: '#475569', textAlign: 'center', position: 'absolute', bottom: 0, width: `${100 / sortedMonths.length}%`, left: `${(i / sortedMonths.length) * 100}%` }}>
                                {labelMonth(key)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1.25rem' }}>
                    {/* Cost by employee */}
                    {sortedEmps.length > 0 && (
                      <div style={cardStyle}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9', marginBottom: '1rem' }}>Cost by employee</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {sortedEmps.map(({ emp, total }) => (
                            <div key={emp!.id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{emp!.name}</span>
                                <span style={{ color: '#93c5fd', fontWeight: 600 }}>{formatMoney(total)}</span>
                              </div>
                              <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                                <div style={{ height: '100%', width: `${(total / maxEmpVal) * 100}%`, background: '#3b82f6', borderRadius: '3px' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pay type split */}
                    <div style={cardStyle}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9', marginBottom: '1rem' }}>Pay type</div>
                      {employees.length === 0 ? (
                        <div style={{ fontSize: '13px', color: '#64748b' }}>No employees.</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{ flex: 1, textAlign: 'center', background: 'rgba(29,78,216,0.12)', borderRadius: '8px', padding: '12px' }}>
                              <div style={{ fontSize: '24px', fontWeight: 700, color: '#93c5fd' }}>{hourlyCount}</div>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>Hourly</div>
                            </div>
                            <div style={{ flex: 1, textAlign: 'center', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', padding: '12px' }}>
                              <div style={{ fontSize: '24px', fontWeight: 700, color: '#4ade80' }}>{salaryCount}</div>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>Salary</div>
                            </div>
                          </div>
                          <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${(hourlyCount / totalEmps) * 100}%`, background: '#3b82f6', borderRadius: '4px' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                            <span>{Math.round((hourlyCount / totalEmps) * 100)}% hourly</span>
                            <span>{Math.round((salaryCount / totalEmps) * 100)}% salary</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        })() : activeTab === 'overview' ? (
          <div style={cardStyle}>
            {employees.length === 0 ? (
              <div style={emptyState}>No active employees.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {employees.map(emp => {
                  const empEntries = empEntryMap[emp.id] || []
                  const total = empEntries.reduce((sum, e) => sum + e.gross_pay, 0)
                  const last = empEntries[0]
                  return (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => router.push(`/employees/${emp.id}`)}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(100,116,139,0.18)', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                        {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {emp.pay_type === 'salary'
                            ? `${formatMoney(emp.pay_rate ?? 0)}/yr`
                            : `${formatMoney(emp.pay_rate ?? 0)}/hr`}
                          {' · '}
                          {emp.pay_period ? emp.pay_period.charAt(0).toUpperCase() + emp.pay_period.slice(1) : 'Biweekly'}
                          {' · '}
                          {(() => { const p = getPeriodForType((emp.pay_period || 'biweekly') as PayPeriod); return `${formatDate(p.start)} – ${formatDate(p.end)}` })()}
                          {last ? ` · Last paid ${formatDate(last.paid_at)}` : ' · Not yet paid'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: '#93c5fd' }}>{formatMoney(total)}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>total paid</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'runs' ? (
          <div>
            {/* Run payroll form */}
            <div style={{ ...cardStyle, marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '1rem' }}>Run payroll</div>
              <div className="row2" style={{ marginBottom: '0.75rem' }}>
                <div className="field">
                  <label>Period start</label>
                  <input type="date" value={runPeriodStart} onChange={e => setRunPeriodStart(e.target.value)} />
                </div>
                <div className="field">
                  <label>Period end</label>
                  <input type="date" value={runPeriodEnd} onChange={e => setRunPeriodEnd(e.target.value)} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label>Notes (optional)</label>
                <input value={runNotes} onChange={e => setRunNotes(e.target.value)} placeholder="e.g. regular biweekly run" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button style={primaryBtn} onClick={createRun} disabled={runCreating}>
                  {runCreating ? 'Processing...' : 'Run payroll'}
                </button>
              </div>
            </div>

            {/* Past runs */}
            {runs.length === 0 ? (
              <div style={cardStyle}><div style={emptyState}>No payroll runs yet.</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {runs.map(run => {
                  const isExpanded = expandedRun === run.id
                  const items = runItems[run.id] ?? []
                  return (
                    <div key={run.id} style={cardStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                        onClick={() => {
                          if (!isExpanded) {
                            setExpandedRun(run.id)
                            if (!runItems[run.id] && sessionToken) loadRunItems(run.id, sessionToken)
                          } else {
                            setExpandedRun(null)
                          }
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>
                            {formatDate(run.period_start)} – {formatDate(run.period_end)}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                            {run.employee_count} employee{run.employee_count !== 1 ? 's' : ''} · run on {formatDate(run.run_date)}
                            {run.notes ? ` · ${run.notes}` : ''}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: '#93c5fd', fontSize: '15px' }}>{formatMoney(run.total_gross)}</div>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px',
                          background: run.status === 'finalized' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.16)',
                          color: run.status === 'finalized' ? '#4ade80' : '#fbbf24',
                        }}>
                          {run.status === 'finalized' ? 'Finalized' : 'Draft'}
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>

                      {isExpanded && (
                        <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '1rem' }}>
                          {items.length === 0 ? (
                            <div style={{ fontSize: '13px', color: '#64748b' }}>Loading...</div>
                          ) : (
                            <>
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '1rem' }}>
                                  <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>Employee</th>
                                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>Gross</th>
                                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>Federal</th>
                                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>State</th>
                                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>Other</th>
                                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#93c5fd' }}>Net pay</th>
                                      {run.status === 'draft' && <th style={{ padding: '8px 10px' }}></th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map(item => {
                                      const ed = editDeductions[item.id] ?? {
                                        federal: String(item.deductions?.federal ?? 0),
                                        state: String(item.deductions?.state ?? 0),
                                        other: String(item.deductions?.other ?? 0),
                                      }
                                      const isDirty = editDeductions[item.id] !== undefined
                                      const previewNet = isDirty
                                        ? item.gross_pay - ((parseFloat(ed.federal) || 0) + (parseFloat(ed.state) || 0) + (parseFloat(ed.other) || 0))
                                        : item.net_pay
                                      return (
                                        <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                          <td style={{ padding: '8px 10px' }}>
                                            <div style={{ fontWeight: 500, color: '#e2e8f0' }}>{item.employee_name}</div>
                                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                                              {item.pay_type === 'salary' ? 'Salary' : `${item.hours_worked ?? 0} hrs`}
                                              {item.notes && <span style={{ color: '#4ade80', marginLeft: '6px' }}>{item.notes}</span>}
                                            </div>
                                          </td>
                                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 500, color: '#e2e8f0' }}>{formatMoney(item.gross_pay)}</td>
                                          {run.status === 'draft' ? (
                                            <>
                                              {(['federal', 'state', 'other'] as const).map(key => (
                                                <td key={key} style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                  <input type="number" value={ed[key]} min="0" step="0.01"
                                                    style={{ width: '72px', textAlign: 'right', padding: '4px 6px', fontSize: '12px' }}
                                                    onChange={e => setEditDeductions(prev => ({ ...prev, [item.id]: { ...ed, [key]: e.target.value } }))}
                                                  />
                                                </td>
                                              ))}
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#93c5fd', fontWeight: 600 }}>
                                                {formatMoney(previewNet)}
                                              </td>
                                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                                {isDirty && (
                                                  <button style={{ ...ghostBtn, fontSize: '11px', padding: '3px 10px' }}
                                                    disabled={savingDeductions === item.id}
                                                    onClick={() => saveDeductions(item)}
                                                  >
                                                    {savingDeductions === item.id ? '...' : 'Save'}
                                                  </button>
                                                )}
                                              </td>
                                            </>
                                          ) : (
                                            <>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#94a3b8' }}>{formatMoney(item.deductions?.federal ?? 0)}</td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#94a3b8' }}>{formatMoney(item.deductions?.state ?? 0)}</td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#94a3b8' }}>{formatMoney(item.deductions?.other ?? 0)}</td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#93c5fd', fontWeight: 600 }}>{formatMoney(item.net_pay)}</td>
                                            </>
                                          )}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button style={primaryBtn}
                                  onClick={() => sendToAccountant(run)}>
                                  {accountantEmail ? `Send to accountant` : 'Email to accountant'}
                                </button>
                                <button style={ghostBtn}
                                  onClick={() => exportRunCSV(run, items)}>
                                  Export CSV
                                </button>
                                <button style={ghostBtn}
                                  onClick={() => downloadPayStubs(run.id)}>
                                  All pay stubs
                                </button>
                                {run.status === 'draft' && (
                                  <button style={primaryBtn}
                                    onClick={() => finalizeRun(run.id)}>
                                    Finalize run
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={cardStyle}>
            {entries.length === 0 ? (
              <div style={emptyState}>No payments logged yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {entries.map(entry => {
                  const emp = employees.find(e => e.id === entry.employee_id)
                  return (
                    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px' }}>
                      <div style={{ width: 32, textAlign: 'center', flexShrink: 0 }}><DollarIcon size={16} color="#93c5fd" /></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{emp?.name ?? 'Unknown'}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                          {entry.hours_worked != null ? ` · ${entry.hours_worked} hrs` : ''}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </div>
                      </div>
                      <span style={{ fontWeight: 600, color: '#93c5fd', fontSize: '14px' }}>{formatMoney(entry.gross_pay)}</span>
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
