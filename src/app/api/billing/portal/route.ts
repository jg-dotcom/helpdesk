import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-05-28.basil' })

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/login', req.url))

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  // Get or create Stripe customer
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
    await supabaseAdmin
      .from('business_profiles')
      .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing`,
  })

  return NextResponse.redirect(session.url)
}
