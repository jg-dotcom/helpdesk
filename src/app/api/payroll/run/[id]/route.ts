import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'

// GET — fetch run + items
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: run } = await supabaseAdmin
    .from('payroll_runs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await supabaseAdmin
    .from('payroll_run_items')
    .select('*')
    .eq('run_id', run.id)
    .order('employee_name')

  return NextResponse.json({ run, items: items ?? [] })
}

// PATCH — update item deductions or finalize run
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Finalize the run
  if (body.action === 'finalize') {
    await supabaseAdmin
      .from('payroll_runs')
      .update({ status: 'finalized' })
      .eq('id', params.id)
      .eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  // JAY-147 — void a finalized run (fat-fingered amount, wrong employee
  // subset, etc.). Only reachable from `finalized`, requires a reason for
  // the audit trail (mirroring JAY-118's deduction-audit pattern), and
  // never deletes anything — voided runs stay visible in history but get
  // excluded from pay-stub/reporting sums (see reports/page.tsx,
  // sendToAccountant/exportRunCSV in payroll/page.tsx). No schema change:
  // `status` has no CHECK constraint, and the reason is appended to the
  // existing free-text `notes` column rather than adding a new one.
  if (body.action === 'void') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required to void a payroll run.' }, { status: 400 })
    }

    const { data: run } = await supabaseAdmin
      .from('payroll_runs')
      .select('id, status, notes')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (run.status !== 'finalized') {
      return NextResponse.json({ error: 'Only a finalized run can be voided.' }, { status: 400 })
    }

    const voidNote = `Voided ${new Date().toISOString().slice(0, 10)}: ${reason}`
    const newNotes = run.notes ? `${run.notes}\n${voidNote}` : voidNote

    await supabaseAdmin
      .from('payroll_runs')
      .update({ status: 'voided', notes: newNotes })
      .eq('id', params.id)
      .eq('user_id', user.id)

    return NextResponse.json({ ok: true })
  }

  // Update deductions for a specific item
  if (body.itemId && body.deductions !== undefined) {
    // JAY-76 — this branch previously had no tenant/ownership check at all,
    // unlike the `finalize` and DELETE branches above/below it in this same
    // file, which both scope by `.eq('user_id', user.id)`. Any authenticated
    // owner could PATCH any payroll_run_items.id in the whole database. Fix:
    // confirm the item both belongs to the run named in the URL (params.id)
    // and that run belongs to the caller, before touching it.
    const { data: item } = await supabaseAdmin
      .from('payroll_run_items')
      .select('gross_pay, run_id, deductions, net_pay')
      .eq('id', body.itemId)
      .eq('run_id', params.id)
      .single()

    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const { data: run } = await supabaseAdmin
      .from('payroll_runs')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const totalDeductions = Object.values(body.deductions as Record<string, number>).reduce((s, v) => s + (v ?? 0), 0)
    const netPay = Math.round((item.gross_pay - totalDeductions) * 100) / 100

    await supabaseAdmin
      .from('payroll_run_items')
      .update({ deductions: body.deductions, net_pay: netPay })
      .eq('id', body.itemId)

    // JAY-118 — audit trail for manual deduction edits. Best-effort: an audit
    // insert failure shouldn't roll back or block the actual payroll update.
    await supabaseAdmin.from('payroll_deduction_audit').insert({
      payroll_run_item_id: body.itemId,
      user_id: user.id,
      edited_by: user.id,
      old_deductions: item.deductions ?? null,
      new_deductions: body.deductions,
      old_net_pay: item.net_pay ?? null,
      new_net_pay: netPay,
    })

    return NextResponse.json({ ok: true, netPay })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// DELETE — delete a draft run
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabaseAdmin
    .from('payroll_runs')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .eq('status', 'draft')

  return NextResponse.json({ ok: true })
}
