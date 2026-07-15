import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function POST(req: NextRequest) {
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

  // Find open entry
  const { data: open } = await supabaseAdmin
    .from('time_entries')
    .select('id, clock_in')
    .eq('employee_id', employee.id)
    .is('clock_out', null)
    .single()

  if (!open) return NextResponse.json({ error: 'Not clocked in.' }, { status: 400 })

  // JAY-33 — optional shift note left at clock-out. Body is optional (existing
  // callers send none), so parse defensively rather than requiring JSON.
  let notes: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.notes === 'string' && body.notes.trim()) notes = body.notes.trim().slice(0, 500)
  } catch { /* no body sent — notes stays null, same as today's behavior */ }

  const clockOut = new Date()
  const clockIn = new Date(open.clock_in)
  const totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)

  const { data: entry, error } = await supabaseAdmin
    .from('time_entries')
    .update({
      clock_out: clockOut.toISOString(),
      total_minutes: totalMinutes,
      ...(notes ? { notes } : {}),
    })
    .eq('id', open.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entry, totalMinutes })
}
