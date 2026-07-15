'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Employee = { id: number; name: string; role: string; status: string; start: string; pay_type: string; pay_rate: number | null; i9_status: string; w4_status: string; direct_deposit_status: string }
type TimeEntry = { employee_id: number; total_minutes: number | null; clock_in: string }
type TimeOffRequest = { employee_id: number; start_date: string; end_date: string; status: string }
type PayrollEntry = { gross_pay: number; created_at: string }

function fmtMoney(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

function HBarChart({ data }: { data: { name: string; value: number; color?: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '110px', fontSize: '12px', color: '#94a3b8', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
          <div style={{ flex: 1, height: '18px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: d.color ?? '#3b82f6', borderRadius: '4px', transition: 'width 0.4s' }} />
          </div>
          <div style={{ width: '50px', fontSize: '12px', color: '#e2e8f0', textAlign: 'right', flexShrink: 0 }}>{d.value}</div>
        </div>
      ))}
    </div>
  )
}

function BarChart({ data, color = '#3b82f6', prefix = '', suffix = '' }: { data: { label: string; value: number }[]; color?: string; prefix?: string; suffix?: string }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '120px', padding: '0 4px' }}>
      {data.map((d, i) => {
        const pct = d.value / max
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap' }}>{prefix}{d.value > 0 ? (d.value >= 1000 ? `${(d.value/1000).toFixed(1)}k` : d.value) : ''}{suffix}</div>
            <div style={{ width: '100%', background: color, borderRadius: '4px 4px 0 0', height: `${Math.max(pct * 85, d.value > 0 ? 4 : 0)}%`, minHeight: d.value > 0 ? '4px' : 0 }} />
            <div style={{ fontSize: '10px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRequest[]>([])
  const [payroll, setPayroll] = useState<PayrollEntry[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const uid = session.user.id
      const since = new Date(); since.setFullYear(since.getFullYear() - 1)

      const [{ data: emps }, { data: ents }, { data: to }, { data: pay }] = await Promise.all([
        supabase.from('employees').select('id, name, role, status, start, pay_type, pay_rate, i9_status, w4_status, direct_deposit_status').eq('user_id', uid),
        supabase.from('time_entries').select('employee_id, total_minutes, clock_in').eq('user_id', uid).gte('clock_in', since.toISOString()).not('total_minutes', 'is', null),
        supabase.from('time_off_requests').select('employee_id, start_date, end_date, status').eq('user_id', uid).eq('status', 'approved').gte('start_date', since.toISOString().slice(0, 10)),
        supabase.from('payroll_entries').select('gross_pay, created_at').eq('user_id', uid).gte('created_at', since.toISOString()),
      ])
      setEmployees(emps ?? [])
      setEntries(ents ?? [])
      setTimeOff(to ?? [])
      setPayroll(pay ?? [])
      setLoading(false)
    })
  }, [])

  async function exportCSV() {
    setExporting(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setExporting(false); return }
    const res = await fetch('/api/reports/export', { headers: { Authorization: `Bearer ${session.access_token}` } })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'helpdesk-hours-report.csv'; a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  // ── Derived metrics ────────────────────────────────────────────────────────

  const active = employees.filter(e => e.status === 'active' || !e.status)
  const terminated = employees.filter(e => e.status === 'terminated')

  // Turnover rate (terminated / total in last 12 months)
  const turnoverRate = employees.length > 0 ? Math.round((terminated.length / employees.length) * 100) : 0

  // Compliance score
  const compliantCount = active.filter(e => e.w4_status === 'complete' && e.i9_status === 'complete' && e.direct_deposit_status === 'complete').length
  const complianceScore = active.length > 0 ? Math.round((compliantCount / active.length) * 100) : 100

  // Average tenure (active employees)
  const avgTenureMonths = active.length > 0
    ? Math.round(active.reduce((sum, e) => sum + (Date.now() - new Date(e.start).getTime()) / 2629800000, 0) / active.length)
    : 0

  // Total payroll last 12 months
  const totalPayroll = payroll.reduce((s, p) => s + p.gross_pay, 0)

  // Hours by employee (last 12 months)
  const hoursByEmp = new Map<number, number>()
  for (const e of entries) hoursByEmp.set(e.employee_id, (hoursByEmp.get(e.employee_id) ?? 0) + Math.round((e.total_minutes ?? 0) / 60))
  const hoursData = active.map(e => ({ name: e.name.split(' ')[0], value: hoursByEmp.get(e.id) ?? 0 })).filter(d => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 10)

  // PTO days used by employee
  const ptoDaysByEmp = new Map<number, number>()
  for (const r of timeOff) {
    const days = Math.ceil((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1
    ptoDaysByEmp.set(r.employee_id, (ptoDaysByEmp.get(r.employee_id) ?? 0) + days)
  }
  const ptoData = active.map(e => ({ name: e.name.split(' ')[0], value: ptoDaysByEmp.get(e.id) ?? 0 })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)

  // Monthly payroll trend (last 6 months)
  const monthlyPayroll: { label: string; value: number }[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    const value = Math.round(payroll.filter(p => {
      const m = new Date(p.created_at)
      return m.getMonth() === d.getMonth() && m.getFullYear() === d.getFullYear()
    }).reduce((s, p) => s + p.gross_pay, 0))
    return { label, value }
  })

  // Headcount by month (last 6 months)
  const monthlyHeadcount: { label: string; value: number }[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    const value = employees.filter(e => new Date(e.start) <= endOfMonth && (e.status !== 'terminated')).length
    return { label, value }
  })

  // Roles breakdown
  const roleCount: Record<string, number> = {}
  for (const e of active) { const r = e.role || 'Unknown'; roleCount[r] = (roleCount[r] ?? 0) + 1 }
  const roleData = Object.entries(roleCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }))

  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '1.25rem' }
  const ghostBtn: React.CSSProperties = { fontSize: '13px', padding: '7px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }
  const emptyState: React.CSSProperties = { textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '13px' }

  if (loading) return (
    <div className="dash-wrap"><Nav active="reports" />
      <div className="dash-content"><div style={cardStyle}><div style={emptyState}>Loading...</div></div></div>
    </div>
  )

  return (
    <div className="dash-wrap">
      <Nav active="reports" />
      <div className="dash-content">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Reports</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Last 12 months</div>
          </div>
          <button style={ghostBtn} onClick={exportCSV} disabled={exporting}>
            {exporting ? 'Preparing...' : '↓ Export data'}
          </button>
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#f1f5f9' }}>{active.length}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Active employees</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: turnoverRate > 20 ? '#f87171' : '#f1f5f9' }}>{turnoverRate}%</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Turnover rate</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '22px', fontWeight: 600, color: complianceScore === 100 ? '#4ade80' : complianceScore >= 80 ? '#fbbf24' : '#f87171' }}>{complianceScore}%</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Compliance score</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>
              {avgTenureMonths < 12 ? `${avgTenureMonths}mo` : `${Math.floor(avgTenureMonths / 12)}yr ${avgTenureMonths % 12}mo`}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Avg. tenure</div>
          </div>
          {totalPayroll > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9' }}>{fmtMoney(totalPayroll)}</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Total payroll</div>
            </div>
          )}
        </div>

        {/* Compliance detail */}
        {active.some(e => e.w4_status !== 'complete' || e.i9_status !== 'complete' || e.direct_deposit_status !== 'complete') && (
          <div style={{ ...cardStyle, marginBottom: '1rem', border: '1px solid rgba(239,68,68,0.28)' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem', color: '#f87171' }}>Incomplete paperwork</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {active.filter(e => e.w4_status !== 'complete' || e.i9_status !== 'complete' || e.direct_deposit_status !== 'complete').map(e => {
                const missing = [e.w4_status !== 'complete' && 'W-4', e.i9_status !== 'complete' && 'I-9', e.direct_deposit_status !== 'complete' && 'Direct deposit'].filter(Boolean)
                return (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '6px 0', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                    <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{e.name}</span>
                    <span style={{ color: '#f87171' }}>{missing.join(', ')} pending</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Charts grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '1rem' }}>Headcount (6 months)</div>
            <BarChart data={monthlyHeadcount} color="#3b82f6" />
          </div>
          {totalPayroll > 0 ? (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '1rem' }}>Payroll cost (6 months)</div>
              <BarChart data={monthlyPayroll} color="#4ade80" prefix="$" />
            </div>
          ) : (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '0.5rem' }}>Payroll cost</div>
              <div style={emptyState}>No payroll data yet.</div>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          {hoursData.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '1rem' }}>Hours worked per employee</div>
              <HBarChart data={hoursData} />
            </div>
          )}
          {roleData.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '1rem' }}>Team by role</div>
              <HBarChart data={roleData} />
            </div>
          )}
        </div>

        {ptoData.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '1rem' }}>PTO days used (12 months)</div>
            <HBarChart data={ptoData.map(d => ({ ...d, color: '#fbbf24' }))} />
          </div>
        )}

      </div>
    </div>
  )
}
