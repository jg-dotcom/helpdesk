import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { status } = await req.json()
  if (!['approved', 'denied'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Verify swap belongs to this owner
  const { data: swap } = await supabaseAdmin
    .from('shift_swaps')
    .select('id, requester_employee_id, requester_shift_id, target_employee_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!swap) return NextResponse.json({ error: 'Swap not found.' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('shift_swaps')
    .update({ status })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Email both parties on the outcome — not a `notifications` table insert, because
  // (unlike the owner-facing bell in Nav.tsx) the employee portal's notification bell
  // (portal/page.tsx) is static UI with no data source at all today; inserting rows
  // there wouldn't actually reach anyone. Resend is already used for this same
  // "employee needs to know something happened" pattern (callout, onboarding).
  // Best-effort — a failed send never blocks the status change, which already succeeded.
  try {
    const employeeIds = [swap.requester_employee_id, swap.target_employee_id].filter((v): v is number => v != null)
    const [{ data: employees }, { data: shift }] = await Promise.all([
      supabaseAdmin.from('employees').select('id, name, email').in('id', employeeIds),
      supabaseAdmin.from('shifts').select('shift_date, start_time, end_time').eq('id', swap.requester_shift_id).single(),
    ])

    const requester = employees?.find(e => e.id === swap.requester_employee_id)
    const target = employees?.find(e => e.id === swap.target_employee_id)
    const shiftLabel = shift ? `${new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}` : 'the shift'
    const outcome = status === 'approved' ? 'approved' : 'denied'

    const resend = new Resend(process.env.RESEND_API_KEY)
    const sends = []
    if (requester?.email) {
      sends.push(resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: requester.email,
        subject: `Your shift swap request was ${outcome}`,
        html: `<p>Hi ${requester.name.split(' ')[0]},</p><p>Your swap request for <strong>${shiftLabel}</strong> was ${outcome}.</p>`,
      }))
    }
    if (target?.email && target.id !== requester?.id) {
      sends.push(resend.emails.send({
        from: 'Helpdesk <onboarding@resend.dev>',
        to: target.email,
        subject: `Shift swap update — ${shiftLabel}`,
        html: `<p>Hi ${target.name.split(' ')[0]},</p><p>The swap involving <strong>${shiftLabel}</strong> (${requester?.name ?? 'a coworker'}'s shift) was ${outcome}.</p>`,
      }))
    }
    await Promise.allSettled(sends)
  } catch {
    // Non-fatal — the status change already succeeded.
  }

  return NextResponse.json({ success: true })
}
