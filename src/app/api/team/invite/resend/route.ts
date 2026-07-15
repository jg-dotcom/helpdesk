import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../../lib/apiAuth'
import { sendSetupInviteEmail } from '../../../../../lib/teamInvite'

// JAY-28 — the original invite's magic link expires in 1 hour with no way to get a
// new one short of the owner re-typing the invite (which only updates access_role,
// it doesn't re-send anything). This just re-runs the same generateLink+email logic
// for an employee who already exists, no new employee record, no role change.
export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { employeeId } = await req.json()
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required.' }, { status: 400 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, email, access_role')
    .eq('id', employeeId)
    .eq('user_id', user.id)
    .single()

  if (!employee?.email) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', user.id)
    .single()
  const bizName = biz?.business_name ?? 'Your team'

  try {
    await sendSetupInviteEmail(employee.email, employee.access_role ?? 'employee', bizName)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not send invite.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
