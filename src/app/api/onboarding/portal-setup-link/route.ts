import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const { token } = await req.json()
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id')
    .eq('token', token)
    .single()

  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('email')
    .eq('id', link.employee_id)
    .single()

  if (!emp?.email) return NextResponse.json({ error: 'Employee has no email on file.' }, { status: 400 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://helpdesk-iota-five.vercel.app'

  const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: emp.email,
    options: { redirectTo: `${appUrl}/portal` },
  })

  if (error || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: error?.message ?? 'Could not generate link.' }, { status: 500 })
  }

  return NextResponse.json({ url: linkData.properties.action_link })
}
