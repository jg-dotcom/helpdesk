import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { stripe, PLANS, PlanKey } from '../../../lib/stripe'

export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json()
  const planConfig = PLANS[plan as PlanKey]
  if (!planConfig) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status, business_name')
    .eq('user_id', user.id)
    .single()

  if (!biz) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // JAY-45 — this route used to always create a brand-new Checkout session,
  // even for a business already on an active/trialing paid subscription.
  // Stripe Checkout has no idea an existing subscription exists, so a plan
  // switch could leave the customer with two live subscriptions, both
  // billing. If there's already a live subscription, update it in place
  // (with proration) instead of starting a second one.
  const hasLiveSubscription = !!biz.stripe_subscription_id
    && biz.subscription_status !== 'canceled'
    && biz.subscription_status !== null

  if (hasLiveSubscription) {
    const existingSub = await stripe.subscriptions.retrieve(biz.stripe_subscription_id!)
    const existingItem = existingSub.items.data[0]
    if (!existingItem) return NextResponse.json({ error: 'Could not read the existing subscription.' }, { status: 500 })

    const updatedSub = await stripe.subscriptions.update(biz.stripe_subscription_id!, {
      items: [{ id: existingItem.id, price: planConfig.priceId }],
      proration_behavior: 'create_prorations',
    })

    // Best-effort immediate reflect — the webhook (customer.subscription.updated)
    // will also fire and update this again; doing it here too means the UI
    // doesn't have to wait on the webhook round-trip to show the new plan.
    const updatedPeriodEnd = updatedSub.items.data[0]?.current_period_end
    await supabaseAdmin
      .from('business_profiles')
      .update({
        plan,
        subscription_status: updatedSub.status,
        ...(updatedPeriodEnd ? { current_period_end: new Date(updatedPeriodEnd * 1000).toISOString() } : {}),
      })
      .eq('user_id', user.id)

    return NextResponse.json({ switched: true, plan })
  }

  // Create or reuse Stripe customer
  let customerId = biz.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: biz.business_name ?? user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabaseAdmin
      .from('business_profiles')
      .update({ stripe_customer_id: customerId })
      .eq('user_id', user.id)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://helpdesk.vercel.app'

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { supabase_user_id: user.id, plan },
    },
    success_url: `${appUrl}/settings?tab=billing&success=1`,
    cancel_url: `${appUrl}/settings?tab=billing`,
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
