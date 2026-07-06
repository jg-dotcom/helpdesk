import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ token: null })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user?.email) return NextResponse.json({ token: null })

  // Find employee record
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, w4_status, i9_status')
    .eq('email', user.email)
    .single()

  if (!employee) return NextResponse.json({ token: null })

  // Already completed onboarding
  if (employee.w4_status === 'complete' && employee.i9_status === 'complete') {
    return NextResponse.json({ token: null })
  }

  // Look for a pending onboarding link
  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('token')
    .eq('employee_id', employee.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json({ token: link?.token ?? null })
}
