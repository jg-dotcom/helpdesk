'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Summary = { totalPayroll: number; totalHours: number; activeEmployees: number }
type WeekData = { week: string; cost: number }
type HourData = { name: string; hours: number }
type HeadData = { month: string; count: number }

function fmtMoney(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

function BarChart({ data, valueKey, labelKey, color, unit = '' }: {
  data: Record<string, unknown>[]
  valueKey: string
  labelKey: string
  color: string
  unit?: string
}) {
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '140px', padding: '0 4px' }}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0
        const pct = val / max
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: '10px', color: '#888', whiteSpace: 'nowrap' }}>
              {unit === '$' ? fmtMoney(val) : val}
            </div>
            <div
              title={`${String(d[labelKey])}: ${unit === '$' ? fmtMoney(val) : val}${unit !== '$' ? unit : ''}`}
              style={{
                width: '100%', background: color, borderRadius: '4px 4px 0 0',
                height: `${Math.max(pct * 100, val > 0 ? 4 : 0)}%`,
                minHeight: val > 0 ? '4px' : 0,
                transition: 'height 0.3s',
              }}
            />
            <div style={{ fontSize: '10px', color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>
              {String(d[labelKey])}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HBarChart({ data }: { data: HourData[] }) {
  const max = Math.max(...data.map(d => d.hours), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '100px', fontSize: '13px', color: '#333', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
          <div style={{ flex: 1, height: '20px', background: '#f0f2f5', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${(d.hours / max) * 100}%`, height: '100%', background: '#185fa5', borderRadius: '4px', transition: 'width 0.4s' }} />
          </div>
          <div style={{ width: '44px', fontSize: '13px', color: '#555', textAlign: 'right', flexShrink: 0 }}>{d.hours}h</div>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [laborByWeek, setLaborByWeek] = useState<WeekData[]>([])
  const [hoursData, setHoursData] = useState<HourData[]>([])
  const [headcountData, setHeadData] = useState<HeadData[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const res = await fetch('/api/analytics', { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) { setLoading(false); return }
      const d = await res.json()
      setSummary(d.summary)
      setLaborByWeek(d.laborByWeek)
      setHoursData(d.hoursData)
      setHeadData(d.headcountData)
      setLoading(false)
    })
  }, [])

  return (
    <div className="dash-wrap">
      <Nav active="analytics" />
      <div className="dash-content">

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>Analytics</div>
          <div style={{ fontSize: '13px', color: '#6b6b6b', marginTop: '4px' }}>Last 8 weeks</div>
        </div>

        {loading ? (
          <div className="card"><div className="loading-state">Loading...</div></div>
        ) : (
          <>
            {/* Summary stat cards */}
            <div className="dash-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '1.5rem' }}>
              <div className="stat-card">
                <div className="stat-label">Total payroll (8 wks)</div>
                <div className="stat-value" style={{ color: '#185fa5' }}>{summary ? fmtMoney(summary.totalPayroll) : '—'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Hours worked (8 wks)</div>
                <div className="stat-value" style={{ color: '#15803d' }}>{summary ? `${summary.totalHours}h` : '—'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Active employees</div>
                <div className="stat-value" style={{ color: '#b45309' }}>{summary ? String(summary.activeEmployees) : '—'}</div>
              </div>
            </div>

            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div className="card">
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '1rem' }}>Labor cost by week</div>
                {laborByWeek.every(w => w.cost === 0) ? (
                  <div className="empty-state">No payroll data yet.</div>
                ) : (
                  <BarChart data={laborByWeek as unknown as Record<string, unknown>[]} valueKey="cost" labelKey="week" color="#185fa5" unit="$" />
                )}
              </div>

              <div className="card">
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '1rem' }}>Headcount growth</div>
                {headcountData.length === 0 ? (
                  <div className="empty-state">No employee data yet.</div>
                ) : (
                  <BarChart data={headcountData as unknown as Record<string, unknown>[]} valueKey="count" labelKey="month" color="#15803d" unit="" />
                )}
              </div>
            </div>

            {/* Hours per employee */}
            <div className="card">
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '1rem' }}>Hours worked per employee (8 wks)</div>
              {hoursData.length === 0 ? (
                <div className="empty-state">No time-tracking data yet.</div>
              ) : (
                <HBarChart data={hoursData} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
