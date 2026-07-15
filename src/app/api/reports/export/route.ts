import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// Real per-employee CSV export for the Reports page — scoped to the same
// "last 12 months" window and metrics already shown on screen (hours, PTO
// days used, gross pay), not a raw whole-database dump. See JAY-23: the
// Reports page's "Export data" button was calling /api/settings/export,
// which returns JSON of the entire employees/payroll_entries/shifts tables.
// That route is left as-is (Settings page uses it as a real full-data
// backup) — this is a separate, report-scoped CSV export.
function csvEscape(v: string | number) {
  return `"${String(v).replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)
  const sinceIso = since.toISOString()

  const [{ data: emps }, { data: entries }, { data: timeOff }, { data: payroll }] = await Promise.all([
    supabaseAdmin.from('employees').select('id, name, role, status').eq('user_id', user.id),
    supabaseAdmin.from('time_entries').select('employee_id, total_minutes, clock_in').eq('user_id', user.id).gte('clock_in', sinceIso).not('total_minutes', 'is', null),
    supabaseAdmin.from('time_off_requests').select('employee_id, start_date, end_date, status').eq('user_id', user.id).eq('status', 'approved').gte('start_date', sinceIso.slice(0, 10)),
    supabaseAdmin.from('payroll_entries').select('employee_id, gross_pay, period_start, period_end').eq('user_id', user.id).gte('created_at', sinceIso),
  ])

  const active = (emps ?? []).filter(e => e.status === 'active' || !e.status)

  const hoursByEmp = new Map<number, number>()
  for (const e of entries ?? []) hoursByEmp.set(e.employee_id, (hoursByEmp.get(e.employee_id) ?? 0) + Math.round((e.total_minutes ?? 0) / 60))

  const ptoDaysByEmp = new Map<number, number>()
  for (const r of timeOff ?? []) {
    const days = Math.ceil((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1
    ptoDaysByEmp.set(r.employee_id, (ptoDaysByEmp.get(r.employee_id) ?? 0) + days)
  }

  const payrollByEmp = new Map<number, { gross: number; period: string }>()
  for (const p of payroll ?? []) {
    const existing = payrollByEmp.get(p.employee_id) ?? { gross: 0, period: '' }
    existing.gross += p.gross_pay ?? 0
    if (p.period_end && (!existing.period || p.period_end > existing.period)) existing.period = `${p.period_start} – ${p.period_end}`
    payrollByEmp.set(p.employee_id, existing)
  }

  const header = ['Employee', 'Role', 'Hours (last 12mo)', 'PTO Days Used (last 12mo)', 'Most Recent Payroll Period', 'Gross Pay (last 12mo)']
  const rows = active.map(e => {
    const pay = payrollByEmp.get(e.id)
    return [
      e.name,
      e.role || '',
      hoursByEmp.get(e.id) ?? 0,
      ptoDaysByEmp.get(e.id) ?? 0,
      pay?.period ?? '',
      (pay?.gross ?? 0).toFixed(2),
    ]
  })

  const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="helpdesk-hours-report-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
