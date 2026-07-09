import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { weekStart } = await req.json()
  if (!weekStart) return NextResponse.json({ error: 'Missing weekStart' }, { status: 400 })

  // Calculate week end (Sun–Sat)
  const end = new Date(weekStart + 'T00:00:00')
  end.setDate(end.getDate() + 6)
  const weekEnd = end.toISOString().slice(0, 10)

  // Human-readable week label
  const startDate = new Date(weekStart + 'T00:00:00')
  const weekLabel = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  // Get business name
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', user.id)
    .maybeSingle()
  const bizName = biz?.business_name ?? 'Management'

  // Find all shifts this week with assigned employees
  const { data: shifts } = await supabaseAdmin
    .from('shifts')
    .select('employee_id')
    .eq('user_id', user.id)
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd)
    .not('employee_id', 'is', null)
    .neq('status', 'called_out')

  if (!shifts || shifts.length === 0) {
    return NextResponse.json({ notified: 0 })
  }

  // Unique employee IDs only
  const empIds = [...new Set(shifts.map(s => s.employee_id as number))]

  // Insert a DM to each employee's channel
  const messages = empIds.map(empId => ({
    user_id: user.id,
    channel: `dm_emp_${empId}`,
    sender_id: user.id,
    sender_name: bizName,
    content: `Your schedule for ${weekLabel} has been published. Log in to the portal to view your shifts.`,
    parent_id: null,
  }))

  const { error } = await supabaseAdmin.from('chat_messages').insert(messages)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notified: empIds.length })
}
