import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { createClient } from '@supabase/supabase-js'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await req.json()

  if (!['approved', 'denied'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }

  // Auth check
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  // Fetch the request to verify ownership
  const { data: req_ } = await supabaseAdmin
    .from('time_off_requests')
    .select('id, user_id, employee_id, start_date, end_date, type')
    .eq('id', id)
    .single()

  if (!req_ || req_.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('time_off_requests')
    .update({ status })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Could not update.' }, { status: 500 })

  // Notify owner (for their own log)
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('name, email')
    .eq('id', req_.employee_id)
    .single()

  const label = status === 'approved' ? 'Approved' : 'Denied'
  await supabaseAdmin.from('notifications').insert([{
    user_id: user.id,
    message: `${label} time-off request for ${emp?.name || 'employee'} (${req_.type}) ${req_.start_date} – ${req_.end_date}.`,
    read: false,
    link: '/time', // JAY-60
  }])

  // JAY-120 — also notify the employee themself, in their own portal bell.
  // employees.user_id is the owning business's account id, not the employee's
  // own login, so their personal auth id has to be resolved by email (same
  // lookup pattern as src/lib/teamInvite.ts's hasNeverSignedIn).
  if (emp?.email) {
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers()
    const employeeUser = authData?.users.find(u => u.email?.toLowerCase() === emp.email.toLowerCase())
    if (employeeUser) {
      const outcome = status === 'approved' ? 'approved' : 'denied'
      await supabaseAdmin.from('notifications').insert([{
        user_id: employeeUser.id,
        message: `Your time off request (${req_.type}) for ${req_.start_date} – ${req_.end_date} was ${outcome}.`,
        read: false,
      }])
    }
  }

  return NextResponse.json({ success: true })
}
