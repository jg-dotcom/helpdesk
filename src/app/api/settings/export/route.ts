import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [empRes, payRes, shiftsRes, payrollRunsRes, payrollRunItemsRes, timeOffRes, timeEntriesRes] = await Promise.all([
    supabaseAdmin.from('employees').select('*').eq('user_id', user.id),
    supabaseAdmin.from('payroll_entries').select('*').eq('user_id', user.id),
    supabaseAdmin.from('shifts').select('*').eq('user_id', user.id),
    supabaseAdmin.from('payroll_runs').select('*').eq('user_id', user.id),
    supabaseAdmin.from('payroll_run_items').select('*').eq('user_id', user.id),
    supabaseAdmin.from('time_off_requests').select('*').eq('user_id', user.id),
    supabaseAdmin.from('time_entries').select('*').eq('user_id', user.id),
  ])

  // employee_forms/employee_documents (I-9/W-4/direct deposit PII) are intentionally
  // excluded from this business-level export pending a separate decision on their
  // privacy tradeoffs (see JAY-63/64).
  const data = {
    exported_at: new Date().toISOString(),
    employees: empRes.data ?? [],
    payroll_entries: payRes.data ?? [],
    shifts: shiftsRes.data ?? [],
    payroll_runs: payrollRunsRes.data ?? [],
    payroll_run_items: payrollRunItemsRes.data ?? [],
    time_off_requests: timeOffRes.data ?? [],
    time_entries: timeEntriesRes.data ?? [],
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="helpdesk-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
