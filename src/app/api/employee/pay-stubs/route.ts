import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // JAY-43 — block terminated employees; see employee/me/route.ts for context.
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', user.email)
    .eq('status', 'active')
    .single()

  if (!employee) return NextResponse.json({ error: 'Access revoked.' }, { status: 403 })

  // JAY-92 — "Run Payroll" writes to payroll_run_items, not payroll_entries,
  // so employees paid that way saw no stubs at all. Merge both ledgers, same
  // pattern JAY-88 established for the Reports page.
  const [{ data: entryStubs }, { data: runItems }] = await Promise.all([
    supabaseAdmin
      .from('payroll_entries')
      .select('id, gross_pay, hours_worked, pay_type, period_start, period_end, notes, created_at')
      .eq('employee_id', employee.id),
    supabaseAdmin
      .from('payroll_run_items')
      .select('id, run_id, gross_pay, hours_worked, pay_type, notes, created_at')
      .eq('employee_id', employee.id),
  ])

  let runStubs: typeof entryStubs = []
  if (runItems && runItems.length > 0) {
    const runIds = [...new Set(runItems.map(it => it.run_id))]
    const { data: runs } = await supabaseAdmin
      .from('payroll_runs')
      .select('id, period_start, period_end')
      .in('id', runIds)
    const runById = new Map((runs ?? []).map(r => [r.id, r]))
    runStubs = runItems.map(it => {
      const run = runById.get(it.run_id)
      return {
        id: -it.id, // negative to avoid colliding with payroll_entries ids
        gross_pay: it.gross_pay,
        hours_worked: it.hours_worked,
        pay_type: it.pay_type,
        period_start: run?.period_start ?? '',
        period_end: run?.period_end ?? '',
        notes: it.notes,
        created_at: it.created_at,
      }
    })
  }

  const stubs = [...(entryStubs ?? []), ...runStubs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20)

  return NextResponse.json({ stubs })
}
