import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id
  const today = new Date().toISOString().slice(0, 10)
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // ── 1. Employees ─────────────────────────────────────────────────────────────
  const employeeData = [
    { name: 'Jamie Rodriguez', role: 'Cashier',         start: '2023-03-15', type: 'Full-time',  phone: '(555) 201-4432', email: 'jamie.rodriguez@demo.com',  access_role: 'employee', pay_type: 'hourly', pay_rate: 16.50, pay_period: 'biweekly' },
    { name: 'Alex Lee',        role: 'Cashier',         start: '2023-07-01', type: 'Part-time',  phone: '(555) 308-7721', email: 'alex.lee@demo.com',         access_role: 'employee', pay_type: 'hourly', pay_rate: 15.00, pay_period: 'biweekly' },
    { name: 'Marcus Thompson', role: 'Floor Associate', start: '2022-11-10', type: 'Full-time',  phone: '(555) 412-9903', email: 'marcus.thompson@demo.com',   access_role: 'employee', pay_type: 'hourly', pay_rate: 17.00, pay_period: 'biweekly' },
    { name: 'Sarah Kim',       role: 'Floor Associate', start: '2023-01-22', type: 'Full-time',  phone: '(555) 519-3347', email: 'sarah.kim@demo.com',         access_role: 'employee', pay_type: 'hourly', pay_rate: 17.00, pay_period: 'biweekly' },
    { name: 'Dana Patel',      role: 'Lead',            start: '2021-08-05', type: 'Full-time',  phone: '(555) 623-0088', email: 'dana.patel@demo.com',        access_role: 'manager',  pay_type: 'hourly', pay_rate: 22.00, pay_period: 'biweekly' },
    { name: 'Chris Evans',     role: 'Stock',           start: '2024-02-14', type: 'Part-time',  phone: '(555) 730-5561', email: 'chris.evans@demo.com',       access_role: 'employee', pay_type: 'hourly', pay_rate: 14.50, pay_period: 'biweekly' },
    { name: 'Mia Torres',      role: 'Cashier',         start: '2023-09-30', type: 'Full-time',  phone: '(555) 814-2239', email: 'mia.torres@demo.com',        access_role: 'employee', pay_type: 'hourly', pay_rate: 16.00, pay_period: 'biweekly' },
    { name: 'Tyler Washington', role: 'Stock',          start: '2024-05-01', type: 'Part-time',  phone: '(555) 922-7714', email: 'tyler.washington@demo.com',  access_role: 'employee', pay_type: 'hourly', pay_rate: 14.50, pay_period: 'biweekly' },
  ]

  const { data: insertedEmps, error: empErr } = await supabaseAdmin
    .from('employees')
    .insert(employeeData.map(e => ({
      ...e,
      user_id: uid,
      status: 'active',
      address: '123 Main St, Anytown, USA',
      emergency_contact: 'Contact Name — (555) 000-0000',
      ssn_last4: '0000',
      date_of_birth: '1995-01-01',
      i9_status: 'complete',
      w4_status: 'complete',
      direct_deposit_status: 'active',
    })))
    .select()

  if (empErr || !insertedEmps) {
    return NextResponse.json({ error: empErr?.message ?? 'Failed to insert employees' }, { status: 500 })
  }

  const [jamie, alex, marcus, sarah, dana, chris, mia, tyler] = insertedEmps

  // ── 2. Shifts for today ───────────────────────────────────────────────────────
  const shiftsToday = [
    { employee_id: jamie.id,   start_time: '09:00', end_time: '17:00', status: 'scheduled' },
    { employee_id: alex.id,    start_time: '09:00', end_time: '17:00', status: 'called_out' }, // callout
    { employee_id: marcus.id,  start_time: '14:00', end_time: '22:00', status: 'scheduled' },
    { employee_id: dana.id,    start_time: '08:00', end_time: '16:00', status: 'scheduled' },
    { employee_id: mia.id,     start_time: '10:00', end_time: '18:00', status: 'scheduled' },
    { employee_id: chris.id,   start_time: '12:00', end_time: '20:00', status: 'scheduled' },
  ]

  const { data: insertedShifts } = await supabaseAdmin
    .from('shifts')
    .insert(shiftsToday.map(s => ({ ...s, user_id: uid, shift_date: today, notes: null })))
    .select()

  // ── 3. Clock-ins for today (Jamie, Dana, Mia clocked in) ─────────────────────
  const clockInNow = new Date()
  clockInNow.setHours(9, 7, 0, 0)

  const clockIns = [
    { employee_id: jamie.id, clock_in: new Date(new Date().setHours(9,  7, 0, 0)).toISOString() },
    { employee_id: dana.id,  clock_in: new Date(new Date().setHours(8,  2, 0, 0)).toISOString() },
    { employee_id: mia.id,   clock_in: new Date(new Date().setHours(10, 3, 0, 0)).toISOString() },
  ]
  await supabaseAdmin.from('time_entries').insert(clockIns.map(c => ({ ...c, user_id: uid, clock_out: null, total_minutes: null })))

  // ── 4. PTO request (pending — Sarah) ─────────────────────────────────────────
  const ptoDates = { start: nextWeek, end: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }
  await supabaseAdmin.from('time_off_requests').insert({
    user_id: uid,
    employee_id: sarah.id,
    start_date: ptoDates.start,
    end_date: ptoDates.end,
    type: 'PTO',
    reason: 'Family vacation',
    status: 'pending',
  })

  // ── 5. Shift swap request (Marcus → Sarah, pending) ──────────────────────────
  if (insertedShifts && insertedShifts.length > 0) {
    const marcusShift = insertedShifts.find((s: { employee_id: number }) => s.employee_id === marcus.id)
    if (marcusShift) {
      await supabaseAdmin.from('shift_swaps').insert({
        user_id: uid,
        requester_id: marcus.id,
        target_id: sarah.id,
        requester_shift_id: marcusShift.id,
        target_shift_id: null,
        status: 'pending',
        notes: 'Have a class that afternoon',
      })
    }
  }

  // ── 6. Recent announcement ───────────────────────────────────────────────────
  await supabaseAdmin.from('announcements').insert({
    user_id: uid,
    title: 'July schedule is posted',
    message: 'The schedule for the rest of July is now live. Please review your shifts and let Dana know if you have any conflicts.',
    sent_count: insertedEmps.length,
  })

  return NextResponse.json({
    ok: true,
    employees: insertedEmps.length,
    message: 'Demo data loaded successfully',
  })
}
