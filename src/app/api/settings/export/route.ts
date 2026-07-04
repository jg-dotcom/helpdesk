import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [empRes, payRes, shiftsRes] = await Promise.all([
    supabaseAdmin.from('employees').select('*').eq('user_id', user.id),
    supabaseAdmin.from('payroll_entries').select('*').eq('user_id', user.id),
    supabaseAdmin.from('shifts').select('*').eq('user_id', user.id),
  ])

  const data = {
    exported_at: new Date().toISOString(),
    employees: empRes.data ?? [],
    payroll_entries: payRes.data ?? [],
    shifts: shiftsRes.data ?? [],
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="helpdesk-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
