import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  refreshAccessToken, getCompanyEmployees, createEmployee, getPayrolls,
} from '../../../../lib/gusto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function getValidToken(userId: string) {
  const { data: conn } = await supabase
    .from('gusto_connections')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!conn) throw new Error('No Gusto connection found.')

  // Refresh if expired
  if (new Date(conn.access_token_expires_at) <= new Date()) {
    const tokens = await refreshAccessToken(conn.refresh_token)
    const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
    await supabase.from('gusto_connections').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: expiresAt,
    }).eq('user_id', userId)
    return { accessToken: tokens.access_token, companyUuid: conn.company_uuid }
  }

  return { accessToken: conn.access_token, companyUuid: conn.company_uuid }
}

// JAY-46 — persist the outcome of a sync so it's visible after a page refresh,
// not just in the one-time toast. `last_sync_summary` shape matches the other
// two integrations (google, quickbooks) for a consistent Settings UI.
async function recordSyncResult(userId: string, summary: { count: number; errors: number; label: string }) {
  await supabase
    .from('gusto_connections')
    .update({ last_synced_at: new Date().toISOString(), last_sync_summary: summary })
    .eq('user_id', userId)
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json() // 'push_employees' | 'pull_payrolls'

  try {
    const { accessToken, companyUuid } = await getValidToken(user.id)
    if (!companyUuid) return NextResponse.json({ error: 'No Gusto company linked.' }, { status: 400 })

    if (action === 'push_employees') {
      // Get helpdesk employees
      const { data: employees } = await supabase
        .from('employees')
        .select('id, name, email, start')
        .eq('user_id', user.id)
        .eq('status', 'active')

      if (!employees?.length) return NextResponse.json({ synced: 0 })

      // Get existing Gusto employees to avoid duplicates
      const gustoEmps = await getCompanyEmployees(companyUuid, accessToken)
      const gustoEmails = new Set(
        (gustoEmps as any[]).map((e: any) => e.email?.toLowerCase()).filter(Boolean)
      )

      let synced = 0
      const errors: string[] = []

      for (const emp of employees) {
        // Skip if already in Gusto by email
        if (emp.email && gustoEmails.has(emp.email.toLowerCase())) continue

        const [firstName, ...rest] = (emp.name || '').trim().split(' ')
        const lastName = rest.join(' ') || '.'

        try {
          await createEmployee(companyUuid, accessToken, {
            first_name: firstName,
            last_name: lastName,
            email: emp.email || undefined,
            start_date: emp.start || undefined,
          })
          synced++
        } catch (e: any) {
          errors.push(`${emp.name}: ${e.message}`)
        }
      }

      await recordSyncResult(user.id, { count: synced, errors: errors.length, label: 'pushed' })
      return NextResponse.json({ synced, errors })
    }

    if (action === 'pull_payrolls') {
      const payrolls = await getPayrolls(companyUuid, accessToken)
      const runs = Array.isArray(payrolls) ? payrolls : (payrolls.payrolls ?? [])

      let imported = 0
      for (const run of runs as any[]) {
        if (!run.processed) continue
        for (const emp of run.employee_compensations ?? []) {
          const gross = parseFloat(emp.gross_pay?.amount ?? '0')
          if (!gross) continue

          // Try to match by Gusto UUID stored on our employee
          const { data: localEmp } = await supabase
            .from('employees')
            .select('id')
            .eq('user_id', user.id)
            .eq('gusto_uuid', emp.employee_uuid)
            .single()

          if (!localEmp) continue

          // Upsert payroll entry (avoid duplication by period+employee)
          await supabase.from('payroll_entries').upsert({
            user_id: user.id,
            employee_id: localEmp.id,
            period_start: run.pay_period?.start_date,
            period_end: run.pay_period?.end_date,
            hours_worked: parseFloat(emp.hours ?? '0') || null,
            gross_pay: gross,
            notes: 'Imported from Gusto',
          }, { onConflict: 'employee_id,period_start,period_end' })
          imported++
        }
      }

      await recordSyncResult(user.id, { count: imported, errors: 0, label: 'imported' })
      return NextResponse.json({ imported })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err: any) {
    console.error('Gusto sync error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
