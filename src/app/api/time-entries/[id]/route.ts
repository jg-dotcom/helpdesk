import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

// PATCH /api/time-entries/[id]
//
// JAY-32 — owner-side correction of an existing time entry, scoped narrowly
// to adding an optional unpaid break_minutes deduction (plus letting the
// owner fix clock_in/clock_out while they're at it, since those are the
// fields the ticket's mockup edit modal shows together). total_minutes is
// recalculated here so downstream payroll/reporting code — which reads
// total_minutes directly and never recomputes from timestamps — picks up
// the deduction with no other changes required.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = Number(id)
  if (!Number.isFinite(entryId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .from('time_entries')
    .select('id, clock_in, clock_out, break_minutes')
    .eq('id', entryId)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  const clockIn: string = typeof body?.clock_in === 'string' ? body.clock_in : existing.clock_in
  const clockOut: string | null = typeof body?.clock_out === 'string' ? body.clock_out : existing.clock_out

  let breakMinutes = existing.break_minutes ?? 0
  if (body?.break_minutes !== undefined) {
    const n = Number(body.break_minutes)
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'break_minutes must be a non-negative number' }, { status: 400 })
    breakMinutes = Math.round(n)
  }

  let totalMinutes: number | null = null
  if (clockOut) {
    const rawMinutes = Math.round((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000)
    totalMinutes = Math.max(0, rawMinutes - breakMinutes)
  }

  const { data: entry, error } = await supabaseAdmin
    .from('time_entries')
    .update({ clock_in: clockIn, clock_out: clockOut, break_minutes: breakMinutes, total_minutes: totalMinutes })
    .eq('id', entryId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entry })
}
