import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'

export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Determine if owner or employee
  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('user_id, business_name')
    .eq('user_id', user.id)
    .maybeSingle()

  let businessId: string
  let isOwner: boolean
  let myEmployeeId: number | null = null
  let ownerName: string
  let myName: string | null = null

  if (biz) {
    businessId = user.id
    isOwner = true
    ownerName = user.user_metadata?.full_name ?? biz.business_name ?? 'Owner'
    myName = ownerName
  } else {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, user_id, name')
      .eq('email', user.email ?? '')
      .single()
    if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    businessId = emp.user_id
    isOwner = false
    myEmployeeId = emp.id
    ownerName = 'Your employer'
    myName = emp.name
  }

  // For owner: get all active employees to build DM channels
  const employeeMap: Record<number, string> = {}
  let dmEmpIds: number[] = []

  if (isOwner) {
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('user_id', businessId)
      .neq('status', 'terminated')
      .order('name')
    if (employees) {
      for (const e of employees) {
        employeeMap[e.id] = e.name
        dmEmpIds.push(e.id)
      }
    }
  } else {
    dmEmpIds = [myEmployeeId!]
  }

  const channelIds = ['general', ...dmEmpIds.map(id => `dm_emp_${id}`)]

  // Fetch last message for each channel
  const lastMsgResults = await Promise.all(
    channelIds.map(ch =>
      supabaseAdmin
        .from('chat_messages')
        .select('id, sender_name, content, created_at')
        .eq('business_id', businessId)
        .eq('channel', ch)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    )
  )

  // Fetch read receipts for current user
  const receiptResults = await Promise.all(
    channelIds.map(ch =>
      supabaseAdmin
        .from('chat_read_receipts')
        .select('last_read_at')
        .eq('business_id', businessId)
        .eq('channel', ch)
        .eq('user_id', user.id)
        .maybeSingle()
    )
  )

  // Count unread messages per channel
  const unreadCounts = await Promise.all(
    channelIds.map(async (ch, i) => {
      const lastRead = receiptResults[i].data?.last_read_at
      let q = supabaseAdmin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('channel', ch)
        .neq('sender_id', user.id)
      if (lastRead) q = q.gt('created_at', lastRead)
      const { count } = await q
      return count ?? 0
    })
  )

  // Real @mention detection — resolve against the current user's actual name (not just
  // any "@word" pattern), scoped to their own unread messages per channel. No schema
  // change: this is a content search over chat_messages, distinct from the generic
  // unread badge (matches JAY-25's mockup).
  const mentionFlags = await Promise.all(
    channelIds.map(async (ch, i) => {
      if (!myName) return false
      const lastRead = receiptResults[i].data?.last_read_at
      const escaped = myName.replace(/[%_]/g, c => `\\${c}`)
      let q = supabaseAdmin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('channel', ch)
        .neq('sender_id', user.id)
        .ilike('content', `%@${escaped}%`)
      if (lastRead) q = q.gt('created_at', lastRead)
      const { count } = await q
      return (count ?? 0) > 0
    })
  )

  const channels = channelIds.map((ch, i) => {
    let name: string
    let type: 'group' | 'dm'
    let empId: number | null = null

    if (ch === 'general') {
      name = 'General'
      type = 'group'
    } else {
      type = 'dm'
      empId = parseInt(ch.replace('dm_emp_', ''), 10)
      name = isOwner ? (employeeMap[empId] ?? 'Employee') : ownerName
    }

    return {
      id: ch,
      name,
      type,
      employeeId: empId,
      lastMessage: lastMsgResults[i].data ?? null,
      unreadCount: unreadCounts[i],
      mentioned: mentionFlags[i],
    }
  })

  return NextResponse.json({ businessId, channels })
}
