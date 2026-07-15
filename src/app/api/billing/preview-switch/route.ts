import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getBearerUser } from '../../../lib/apiAuth'
import { stripe, PLANS, PlanKey } from '../../../lib/stripe'

// JAY-45 — read-only proration preview shown in a confirm modal before the
// owner commits to a plan switch, so "what does this cost right now, and
// what does my next invoice look like" is visible before Stripe is touched,
// not discovered after the fact. Pairs with the create-checkout route's new
// stripe.subscriptions.update(...) path — this route never mutates anything.
export async function POST(req: NextRequest) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json()
  const planConfig = PLANS[plan as PlanKey]
  if (!planConfig) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const { data: biz } = await supabaseAdmin
    .from('business_profiles')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('user_id', user.id)
    .single()

  if (!biz) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hasLiveSubscription = !!biz.stripe_subscription_id
    && biz.subscription_status !== 'canceled'
    && biz.subscription_status !== null

  if (!hasLiveSubscription) {
    // No existing subscription to prorate against — this switch will start a
    // brand-new subscription (with its own trial), so there's nothing to preview.
    return NextResponse.json({ isNewSubscription: true })
  }

  const existingSub = await stripe.subscriptions.retrieve(biz.stripe_subscription_id!)
  const existingItem = existingSub.items.data[0]
  if (!existingItem) return NextResponse.json({ error: 'Could not read the existing subscription.' }, { status: 500 })

  const preview = await stripe.invoices.createPreview({
    customer: biz.stripe_customer_id!,
    subscription: biz.stripe_subscription_id!,
    subscription_details: {
      items: [{ id: existingItem.id, price: planConfig.priceId }],
      proration_behavior: 'create_prorations',
    },
  })

  const currentPeriodEnd = existingSub.items.data[0]?.current_period_end

  return NextResponse.json({
    isNewSubscription: false,
    dueTodayCents: preview.amount_due,
    nextChargeCents: planConfig.price * 100,
    nextChargeDate: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
  })
}
