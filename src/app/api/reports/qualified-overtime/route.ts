import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { aggregateQualifiedOvertime } from '../../../../lib/qualifiedOvertime'

// JAY-171 — Qualified Overtime Report: aggregates the OBBBA-deductible
// overtime premium (0.5x portion only) per tax year. Payroll already
// calculates and stores the inputs (JAY-57); this route just reads and
// re-derives a display figure, no write path.
function csvEscape(v: string | number) {
  return `"${String(v).replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const yearParam = req.nextUrl.searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const { data: runs } = await supabaseAdmin
    .from('payroll_runs')
    .select('id')
    .eq('user_id', user.id)
    .neq('status', 'voided')
    .gte('period_start', yearStart)
    .lte('period_end', yearEnd)

  const runIds = (runs ?? []).map(r => r.id)

  let rows: { employee_name: string; pay_rate: number; overtime_hours: number }[] = []
  if (runIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('payroll_run_items')
      .select('employee_name, pay_rate, overtime_hours')
      .in('run_id', runIds)
      .gt('overtime_hours', 0)
    rows = items ?? []
  }

  const summary = aggregateQualifiedOvertime(rows)

  const format = req.nextUrl.searchParams.get('format')
  if (format === 'csv') {
    const header = ['Employee', 'OT Hours', 'Qualified Overtime Premium ($)']
    const csvRows = summary.perEmployee.map(e => [e.employeeName, e.otHours, e.premiumDollars.toFixed(2)])
    const csv = [header, ...csvRows].map(row => row.map(csvEscape).join(',')).join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="qualified-overtime-${year}.csv"`,
      },
    })
  }

  return NextResponse.json({ year, ...summary })
}
