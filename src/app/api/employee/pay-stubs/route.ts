import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

  const { data: stubs } = await supabaseAdmin
    .from('payroll_entries')
    .select('id, gross_pay, hours_worked, pay_type, period_start, period_end, notes, created_at')
    .eq('employee_id', employee.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ stubs: stubs ?? [] })
}
