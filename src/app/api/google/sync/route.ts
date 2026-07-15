import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshAccessToken, createCalendarEvent } from '../../../../lib/googleCalendar'

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
  const userId = user.id

  const { weekStart, timeZone = 'America/New_York' } = await req.json()

  // Load Google connection
  const { data: conn } = await supabase
    .from('google_connections')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!conn) return NextResponse.json({ error: 'Google Calendar not connected.' }, { status: 400 })

  // Refresh token if expired
  let accessToken = conn.access_token
  if (new Date(conn.access_token_expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(conn.refresh_token)
    accessToken = refreshed.access_token
    const expiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString()
    await supabase
      .from('google_connections')
      .update({ access_token: accessToken, access_token_expires_at: expiresAt })
      .eq('user_id', user.id)
  }

  // Determine date range: weekStart to weekStart+6, or next 7 days if not provided
  const start = weekStart
    ? new Date(weekStart + 'T00:00:00')
    : (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d })()
  const end = new Date(start)
  end.setDate(end.getDate() + 6)

  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)

  // Fetch shifts in range
  const { data: shifts, error: shiftErr } = await supabase
    .from('shifts')
    .select('id, employee_id, shift_date, start_time, end_time, notes')
    .eq('user_id', user.id)
    .gte('shift_date', startStr)
    .lte('shift_date', endStr)

  if (shiftErr) return NextResponse.json({ error: 'Could not load shifts.' }, { status: 500 })

  // JAY-46 — persist the outcome so it's visible after a page refresh, not
  // just in the one-time toast.
  async function recordSyncResult(count: number, errCount: number) {
    await supabase
      .from('google_connections')
      .update({ last_synced_at: new Date().toISOString(), last_sync_summary: { count, errors: errCount, label: 'pushed' } })
      .eq('user_id', userId)
  }

  if (!shifts || shifts.length === 0) {
    await recordSyncResult(0, 0)
    return NextResponse.json({ pushed: 0, message: 'No shifts found in that range.' })
  }

  // Fetch employee names and emails
  const empIds = [...new Set(shifts.map(s => s.employee_id))]
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name, role, email')
    .in('id', empIds)

  const empMap = new Map((employees ?? []).map(e => [e.id, e]))

  // Push each shift to Google Calendar
  let pushed = 0
  const errors: string[] = []

  for (const shift of shifts) {
    const emp = empMap.get(shift.employee_id)
    const name = emp?.name ?? 'Employee'
    const role = emp?.role ?? ''
    const notes = shift.notes ? `\n${shift.notes}` : ''
    const description = [role, notes].filter(Boolean).join('\n')
    const attendees = emp?.email ? [emp.email] : []

    try {
      await createCalendarEvent(
        accessToken,
        `Shift: ${name}`,
        description,
        shift.shift_date,
        shift.start_time,
        shift.end_time,
        timeZone,
        attendees,
      )
      pushed++
    } catch (err) {
      errors.push(`${name} on ${shift.shift_date}: ${err}`)
    }
  }

  await recordSyncResult(pushed, errors.length)
  return NextResponse.json({ pushed, errors: errors.length ? errors : undefined })
}
