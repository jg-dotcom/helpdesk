import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshAccessToken, createPayrollExpense } from '../../../../lib/quickbooks'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const userToken = authHeader?.replace('Bearer ', '')
  if (!userToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(userToken)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodStart, periodEnd } = await req.json()

  // Load QuickBooks connection
  const { data: conn } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!conn) return NextResponse.json({ error: 'QuickBooks not connected.' }, { status: 400 })

  // Refresh token if expired
  let accessToken = conn.access_token
  if (new Date(conn.access_token_expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(conn.refresh_token)
    accessToken = refreshed.access_token
    const expiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString()
    await supabase
      .from('quickbooks_connections')
      .update({ access_token: accessToken, access_token_expires_at: expiresAt })
      .eq('user_id', user.id)
  }

  // Determine date range (default: current month)
  const now = new Date()
  const start = periodStart ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const end = periodEnd ?? now.toISOString().slice(0, 10)

  // Fetch finalized payroll runs in range, with their line items
  const { data: runs, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, period_start, period_end, run_date, status')
    .eq('user_id', user.id)
    .eq('status', 'finalized')
    .gte('period_start', start)
    .lte('period_end', end)

  if (runErr) return NextResponse.json({ error: 'Could not load payroll runs.' }, { status: 500 })

  if (!runs || runs.length === 0) {
    return NextResponse.json({ pushed: 0, message: 'No finalized payroll runs found in that range.' })
  }

  const runIds = runs.map(r => r.id)
  const runMap = new Map(runs.map(r => [r.id, r]))

  const { data: items, error: itemErr } = await supabase
    .from('payroll_run_items')
    .select('id, run_id, employee_name, gross_pay, net_pay, deductions')
    .in('run_id', runIds)

  if (itemErr) return NextResponse.json({ error: 'Could not load payroll items.' }, { status: 500 })
  if (!items || items.length === 0) {
    return NextResponse.json({ pushed: 0, message: 'No payroll line items found.' })
  }

  let pushed = 0
  const errors: string[] = []

  for (const item of items) {
    const run = runMap.get(item.run_id)
    if (!run) continue
    const txnDate = run.period_end
    const memo = `Payroll: ${item.employee_name} (${run.period_start} – ${run.period_end})`

    try {
      await createPayrollExpense(
        conn.realm_id,
        accessToken,
        item.employee_name,
        item.gross_pay,
        txnDate,
        memo,
      )
      pushed++
    } catch (err) {
      errors.push(`${item.employee_name}: ${err}`)
    }
  }

  return NextResponse.json({ pushed, errors: errors.length ? errors : undefined })
}
