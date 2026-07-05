import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, name, role, email, phone, pay_type, pay_rate, user_id, w4_status, i9_status, direct_deposit_status, access_role')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ error: 'No employee record found for this email.' }, { status: 404 })

  return NextResponse.json({ employee })
}
