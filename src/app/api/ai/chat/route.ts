import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { computeAccruedPtoDays } from '../../../lib/ptoAccrual'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Determine if user is an owner (has a business profile) or employee
export async function getUserRole(userId: string, userEmail: string) {
  const [{ data: biz }, { data: emp }] = await Promise.all([
    supabaseAdmin.from('business_profiles').select('id, business_name').eq('user_id', userId).maybeSingle(),
    // JAY-91 / JAY-43 — block terminated employees from the AI tool-execution
    // layer the same way claim-shift/pay-stubs already do for their REST
    // routes; without this, a terminated employee's still-valid Supabase Auth
    // session lets them keep using employee-scoped AI tools (clock_in,
    // get_pto_balance, etc.) indefinitely.
    supabaseAdmin.from('employees').select('id, name, user_id').eq('email', userEmail).eq('status', 'active').maybeSingle(),
  ])
  return {
    isOwner: !!biz,
    isEmployee: !!emp,
    businessName: biz?.business_name ?? null,
    employeeId: emp?.id ?? null,
    employeeName: emp?.name ?? null,
    ownerId: biz ? userId : emp?.user_id ?? null,
  }
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const OWNER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_employees',
    description: 'List all employees for the business',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_analytics_summary',
    description: 'Get a summary of payroll, hours worked, and headcount for the last 8 weeks',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_applicants',
    description: 'List job applicants, optionally filtered by job title or stage',
    input_schema: {
      type: 'object',
      properties: {
        job_title: { type: 'string', description: 'Filter by job title (optional)' },
        stage: { type: 'string', enum: ['applied', 'interviewing', 'offer', 'hired', 'rejected'], description: 'Filter by stage (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'move_applicant_stage',
    description: 'Move an applicant to a different stage in the hiring pipeline',
    input_schema: {
      type: 'object',
      properties: {
        applicant_name: { type: 'string', description: 'Name of the applicant' },
        new_stage: { type: 'string', enum: ['applied', 'interviewing', 'offer', 'hired', 'rejected'] },
      },
      required: ['applicant_name', 'new_stage'],
    },
  },
  {
    name: 'list_time_off_requests',
    description: 'List pending or recent time off requests from employees',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'denied'], description: 'Filter by status (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'approve_time_off',
    description: 'Approve or deny an employee time off request',
    input_schema: {
      type: 'object',
      properties: {
        employee_name: { type: 'string', description: 'Name of the employee' },
        decision: { type: 'string', enum: ['approved', 'denied'] },
        dates: { type: 'string', description: 'The dates of the request if known, to identify the right one' },
      },
      required: ['employee_name', 'decision'],
    },
  },
  {
    name: 'generate_job_description',
    description: 'Generate a professional job description for a role',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Job title' },
        details: { type: 'string', description: 'Any extra context about the role, pay, location, or requirements' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_job_posting',
    description: 'Create and publish a new job posting',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        employment_type: { type: 'string', enum: ['Full-time', 'Part-time', 'Contract', 'Seasonal', 'Internship'] },
        location: { type: 'string' },
        pay_min: { type: 'number' },
        pay_max: { type: 'number' },
        pay_period: { type: 'string', enum: ['hourly', 'yearly'] },
      },
      required: ['title'],
    },
  },
]

const EMPLOYEE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pto_balance',
    description: 'Get the current employee PTO balance — total days, used, and remaining',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'request_time_off',
    description: 'Submit a time off request for the employee',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        reason: { type: 'string', description: 'Reason for the time off (optional)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'clock_in',
    description: 'Clock the employee in to start their shift',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'clock_out',
    description: 'Clock the employee out to end their shift',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_schedule',
    description: 'Get the employee\'s upcoming scheduled shifts',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_time_off_requests',
    description: 'List the employee\'s time off requests and their status',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

// ─── Action transcript (JAY-37) ────────────────────────────────────────────────
// The chat response previously discarded which tools actually ran — the client
// could only render plain text, so the owner had to trust the prose summary
// with no structured confirmation. Staged to the 2 highest-value mutating
// tools first (approve_time_off, create_job_posting); expand only if this
// measurably reduces "did that work?" follow-ups.
export type ChatAction = { tool: string; title: string; detail: string }

function buildAction(name: string, input: Record<string, unknown>, result: string): ChatAction | null {
  if (name === 'approve_time_off' && !/^error|^could not find|^no pending/i.test(result)) {
    const decision = String(input.decision ?? 'approved')
    return {
      tool: name,
      title: decision === 'denied' ? 'Denied time off' : 'Approved time off',
      detail: `${input.employee_name ?? 'Employee'}${input.dates ? ` — ${input.dates}` : ''}`,
    }
  }
  if (name === 'create_job_posting' && !/^error/i.test(result)) {
    return {
      tool: name,
      title: 'Job posting created',
      detail: String(input.title ?? 'New role'),
    }
  }
  return null
}

// ─── Tool execution ───────────────────────────────────────────────────────────

function localTime(timezone: string): string {
  return new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })
}

function localDate(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
}

// JAY-91 — the employee-status filter in getUserRole() alone isn't a full
// fix: every employee-scoped case below falls back to `role.employeeId ?? 0`
// (or passes `null` straight into an insert) rather than refusing to run, so
// without this guard a terminated employee (employeeId: null, isEmployee:
// false) would still silently "clock in" against employee_id 0/null instead
// of being blocked, and the tool set exposed to the model isn't gated on
// isEmployee at all (POST only branches on isOwner). Block here, the single
// choke point every employee tool call passes through.
const EMPLOYEE_SCOPED_TOOLS = new Set([
  'get_pto_balance', 'request_time_off', 'clock_in', 'clock_out',
  'get_my_schedule', 'get_my_time_off_requests',
])

export async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
  userId: string,
  role: Awaited<ReturnType<typeof getUserRole>>,
  timezone: string,
): Promise<string> {
  const ownerId = role.ownerId ?? userId

  if (EMPLOYEE_SCOPED_TOOLS.has(name) && !role.isEmployee) {
    return 'Access revoked. Your employee record is no longer active, so this action is unavailable.'
  }

  switch (name) {

    // ── Employee tools ──

    case 'get_pto_balance': {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('pto_days_per_year, start').eq('email', role.employeeName ? undefined : undefined).eq('id', role.employeeId ?? 0).maybeSingle()
      // JAY-123 — same accrual policy as /api/employee/pto-balance; defaults
      // to the flat grant (unchanged behavior) if no policy is configured.
      const { data: policy } = await supabaseAdmin
        .from('business_profiles').select('pto_accrual_method, pto_accrual_rate').eq('user_id', ownerId).maybeSingle()
      const empRow = emp as { pto_days_per_year?: number; start?: string } | null
      const ptoDays = computeAccruedPtoDays(
        { method: policy?.pto_accrual_method, rate: policy?.pto_accrual_rate },
        empRow?.pto_days_per_year ?? 0,
        empRow?.start,
      )
      const year = new Date().getFullYear()
      const { data: requests } = await supabaseAdmin
        .from('time_off_requests').select('start_date, end_date').eq('employee_id', role.employeeId ?? 0).eq('status', 'approved')
      let used = 0
      for (const r of requests ?? []) {
        const s = new Date(r.start_date); const e = new Date(r.end_date)
        if (s.getFullYear() === year || e.getFullYear() === year) {
          used += Math.ceil((e.getTime() - s.getTime()) / 86400000) + 1
        }
      }
      return JSON.stringify({ total: ptoDays, used, remaining: Math.max(0, ptoDays - used) })
    }

    case 'request_time_off': {
      const { error } = await supabaseAdmin.from('time_off_requests').insert({
        employee_id: role.employeeId,
        user_id: ownerId,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason ?? null,
        status: 'pending',
      })
      if (error) return `Error: ${error.message}`
      return 'Time off request submitted successfully and is pending approval.'
    }

    case 'clock_in': {
      const { data: open } = await supabaseAdmin
        .from('time_entries').select('id').eq('employee_id', role.employeeId ?? 0).is('clock_out', null).maybeSingle()
      if (open) return 'You are already clocked in.'

      // Check for a scheduled shift today in the user's timezone
      const today = localDate(timezone)
      const { data: shift } = await supabaseAdmin
        .from('shifts').select('start_time, end_time')
        .eq('employee_id', role.employeeId ?? 0).eq('shift_date', today).maybeSingle()

      const { error } = await supabaseAdmin.from('time_entries').insert({
        employee_id: role.employeeId,
        user_id: ownerId,
        clock_in: new Date().toISOString(),
      })
      if (error) return `Error: ${error.message}`

      const timeStr = localTime(timezone)
      if (!shift) {
        return `Clocked in at ${timeStr}. ⚠️ No shift is scheduled for you today — heads up, your manager will see this.`
      }
      return `Clocked in at ${timeStr}. Your scheduled shift is ${shift.start_time}–${shift.end_time}.`
    }

    case 'clock_out': {
      const { data: entry } = await supabaseAdmin
        .from('time_entries').select('id, clock_in').eq('employee_id', role.employeeId ?? 0).is('clock_out', null).maybeSingle()
      if (!entry) return 'You are not currently clocked in.'
      const clockIn = new Date(entry.clock_in)
      const now = new Date()
      const mins = Math.round((now.getTime() - clockIn.getTime()) / 60000)
      await supabaseAdmin.from('time_entries').update({ clock_out: now.toISOString(), total_minutes: mins }).eq('id', entry.id)
      return `Clocked out at ${localTime(timezone)}. Shift duration: ${Math.floor(mins / 60)}h ${mins % 60}m.`
    }

    case 'get_my_schedule': {
      const today = localDate(timezone)
      const { data } = await supabaseAdmin
        .from('shifts').select('shift_date, start_time, end_time, notes')
        .eq('employee_id', role.employeeId ?? 0).gte('shift_date', today).order('shift_date').limit(14)
      if (!data?.length) return 'No upcoming shifts scheduled.'
      return data.map(s => `${s.shift_date}: ${s.start_time}–${s.end_time}${s.notes ? ` (${s.notes})` : ''}`).join('\n')
    }

    case 'get_my_time_off_requests': {
      const { data } = await supabaseAdmin
        .from('time_off_requests').select('start_date, end_date, reason, status').eq('employee_id', role.employeeId ?? 0).order('created_at', { ascending: false }).limit(10)
      if (!data?.length) return 'No time off requests found.'
      return data.map(r => `${r.start_date} to ${r.end_date} — ${r.status}${r.reason ? ` (${r.reason})` : ''}`).join('\n')
    }

    // ── Owner tools ──

    case 'list_employees': {
      const { data } = await supabaseAdmin.from('employees').select('name, role, status, pay_type, pay_rate').eq('user_id', ownerId).order('name')
      if (!data?.length) return 'No employees found.'
      return data.map(e => `${e.name} — ${e.role ?? 'No role'} (${e.status})`).join('\n')
    }

    case 'get_analytics_summary': {
      const since = new Date(); since.setDate(since.getDate() - 56)
      // JAY-92 — "Run Payroll" writes to payroll_run_items, not payroll_entries;
      // merge both ledgers so this doesn't disagree with the Reports page total.
      const [{ data: payroll }, { data: runItems }, { data: time }, { data: emps }] = await Promise.all([
        supabaseAdmin.from('payroll_entries').select('gross_pay').eq('user_id', ownerId).gte('created_at', since.toISOString()),
        supabaseAdmin.from('payroll_run_items').select('gross_pay').eq('user_id', ownerId).gte('created_at', since.toISOString()),
        supabaseAdmin.from('time_entries').select('total_minutes').eq('user_id', ownerId).not('total_minutes', 'is', null).gte('clock_in', since.toISOString()),
        supabaseAdmin.from('employees').select('id').eq('user_id', ownerId).eq('status', 'active'),
      ])
      const totalPay = (payroll ?? []).reduce((s, p) => s + p.gross_pay, 0) + (runItems ?? []).reduce((s, p) => s + p.gross_pay, 0)
      const totalHours = Math.round((time ?? []).reduce((s, t) => s + (t.total_minutes ?? 0), 0) / 60)
      return `Last 8 weeks: $${totalPay.toLocaleString()} total payroll, ${totalHours} hours worked, ${emps?.length ?? 0} active employees.`
    }

    case 'list_applicants': {
      let query = supabaseAdmin.from('job_applications').select('name, email, status, created_at, job_postings(title)').eq('user_id', ownerId)
      if (input.stage) query = query.eq('status', input.stage)
      const { data } = await query.order('created_at', { ascending: false }).limit(20)
      if (!data?.length) return 'No applicants found.'
      return data.map(a => {
        // @ts-expect-error join
        const title = a.job_postings?.title ?? 'Unknown role'
        return `${a.name} — ${title} (${a.status})`
      }).join('\n')
    }

    case 'move_applicant_stage': {
      const { data: apps } = await supabaseAdmin.from('job_applications').select('id, name').eq('user_id', ownerId).ilike('name', `%${input.applicant_name}%`).limit(1)
      if (!apps?.length) return `Could not find an applicant named "${input.applicant_name}".`
      await supabaseAdmin.from('job_applications').update({ status: input.new_stage }).eq('id', apps[0].id)
      return `Moved ${apps[0].name} to "${input.new_stage}".`
    }

    case 'list_time_off_requests': {
      let query = supabaseAdmin.from('time_off_requests').select('start_date, end_date, reason, status, employees(name)').eq('user_id', ownerId)
      if (input.status) query = query.eq('status', input.status)
      const { data } = await query.order('created_at', { ascending: false }).limit(20)
      if (!data?.length) return 'No time off requests found.'
      return data.map(r => {
        // @ts-expect-error join
        const empName = r.employees?.name ?? 'Unknown'
        return `${empName}: ${r.start_date} to ${r.end_date} — ${r.status}${r.reason ? ` (${r.reason})` : ''}`
      }).join('\n')
    }

    case 'approve_time_off': {
      const { data: emps } = await supabaseAdmin.from('employees').select('id').eq('user_id', ownerId).ilike('name', `%${input.employee_name}%`).limit(1)
      if (!emps?.length) return `Could not find employee "${input.employee_name}".`
      let query = supabaseAdmin.from('time_off_requests').select('id').eq('employee_id', emps[0].id).eq('status', 'pending')
      if (input.dates) query = query.ilike('start_date', `%${input.dates}%`)
      const { data: req } = await query.limit(1)
      if (!req?.length) return `No pending time off request found for ${input.employee_name}.`
      await supabaseAdmin.from('time_off_requests').update({ status: input.decision }).eq('id', req[0].id)
      return `Time off request for ${input.employee_name} has been ${input.decision}.`
    }

    case 'generate_job_description': {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Write a concise, professional job description for: ${input.title}${input.details ? `. Additional context: ${input.details}` : ''}. Include: a 2-sentence overview, 4-5 responsibilities, and 3-4 requirements. Keep it under 250 words.`,
        }],
      })
      return (msg.content[0] as Anthropic.TextBlock).text
    }

    case 'create_job_posting': {
      const { error } = await supabaseAdmin.from('job_postings').insert({
        user_id: ownerId,
        title: input.title,
        description: input.description ?? null,
        employment_type: input.employment_type ?? 'Full-time',
        location: input.location ?? null,
        pay_min: input.pay_min ?? null,
        pay_max: input.pay_max ?? null,
        pay_period: input.pay_period ?? 'hourly',
        status: 'open',
      })
      if (error) return `Error creating job posting: ${error.message}`
      return `Job posting for "${input.title}" created and published.`
    }

    default:
      return 'Unknown tool.'
  }
}

// ─── Chat route ───────────────────────────────────────────────────────────────

// JAY-42 — restore-only chat history. GET returns the last 20 messages for
// the caller (scoped by their own auth id — this is a personal assistant
// thread, not a shared channel), oldest-first so the client can render it
// directly into the message list.
export async function GET(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('ai_chat_messages')
    .select('role, content, actions, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ messages: (data ?? []).reverse() })
}

// "+ New" in the widget — clears this user's stored history so the next
// restore is genuinely empty. Thread management (multiple named threads,
// rename) is deliberately out of scope per the ticket's own validation
// gut-check — this is a single-thread reset, not a new thread alongside
// the old one.
export async function DELETE(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabaseAdmin.from('ai_chat_messages').delete().eq('user_id', user.id)
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, timezone: tz } = await req.json()
  if (!messages?.length) return NextResponse.json({ error: 'No messages' }, { status: 400 })
  const timezone = tz ?? 'UTC'

  // JAY-42 — persist only the newest user turn from the incoming array (the
  // client sends the full conversation-so-far on every call, so re-inserting
  // earlier turns here would duplicate them). The assistant's reply is
  // persisted once it's computed, below.
  const latestUserMessage = messages[messages.length - 1]
  if (latestUserMessage?.role === 'user' && typeof latestUserMessage.content === 'string') {
    await supabaseAdmin.from('ai_chat_messages').insert({
      user_id: user.id, role: 'user', content: latestUserMessage.content,
    })
  }

  const role = await getUserRole(user.id, user.email ?? '')

  // Owners never get employee tools — even if they're also in the employees table
  const tools = [
    ...(role.isOwner ? OWNER_TOOLS : EMPLOYEE_TOOLS),
  ]

  const nowStr = new Date().toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  const systemPrompt = role.isOwner
    ? `You are an AI HR assistant for ${role.businessName ?? 'this business'}. You help the owner manage their team. You can list employees, check analytics, manage applicants, approve time off, generate job descriptions, and create job postings. Be concise and action-oriented. When you take an action, confirm what you did clearly. The current date and time is: ${nowStr}. Do not use asterisks or markdown bold/italic. You may use plain bullet points (- item) when listing multiple things, but keep responses conversational otherwise.`
    : `You are an AI HR assistant for ${role.employeeName ?? 'this employee'}. You help them with their work — clocking in/out, checking PTO, requesting time off, and viewing their schedule. Be friendly and concise. Always confirm actions clearly. The current date and time is: ${nowStr}. Do not use asterisks or markdown bold/italic. You may use plain bullet points (- item) when listing multiple things, but keep responses conversational otherwise.`

  // Agentic loop — keep calling until no more tool calls
  let currentMessages: Anthropic.MessageParam[] = messages
  let finalText = ''
  const actions: ChatAction[] = []

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages: currentMessages,
    })

    if (response.stop_reason === 'end_turn') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finalText = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      break
    }

    if (response.stop_reason === 'tool_use') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tb of toolUseBlocks) {
        const input = tb.input as Record<string, unknown>
        const result = await executeTool(tb.name, input, user.id, role, timezone)
        toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result })
        const action = buildAction(tb.name, input, result)
        if (action) actions.push(action)
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ]
      continue
    }

    break
  }

  // JAY-36: when the tool loop caps out with nothing to say, don't leave the
  // person at a dead end — point them to a person instead of just apologizing.
  const fallback = role.isOwner
    ? "Sorry, I couldn't complete that. You can make this change directly from the dashboard, or try rephrasing."
    : "Sorry, I couldn't complete that. Your manager can help if this doesn't work here."

  const replyText = finalText || fallback
  await supabaseAdmin.from('ai_chat_messages').insert({
    user_id: user.id, role: 'assistant', content: replyText, actions: actions.length ? actions : null,
  })

  return NextResponse.json({ reply: replyText, actions })
}
