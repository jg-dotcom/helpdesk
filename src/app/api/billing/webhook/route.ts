import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '../../../lib/stripe'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { PLANS, PlanKey } from '../../../lib/stripe'
import Stripe from 'stripe'
import { Resend } from 'resend'

export const config = { api: { bodyParser: false } }

async function updateBilling(customerId: string, updates: Record<string, unknown>) {
  await supabaseAdmin
    .from('business_profiles')
    .update(updates)
    .eq('stripe_customer_id', customerId)
}

function planFromPriceId(priceId: string): PlanKey {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.priceId === priceId) return key as PlanKey
  }
  return 'starter'
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Webhook signature invalid' }, { status: 400 })
  }

  // JAY-49 — Stripe retries webhook delivery at-least-once on any non-200
  // response (including transient timeouts on our end). Record this event id
  // before processing, using the table's UNIQUE primary key as the atomic
  // check-and-insert: if this exact event was already processed, the insert
  // fails with a unique-violation and we skip straight to returning 200
  // (telling Stripe not to retry) without re-running the handler below.
  const { error: dedupeError } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({ id: event.id, event_type: event.type })

  if (dedupeError) {
    // Postgres unique-violation code — this exact event.id was already
    // recorded, meaning it was already processed (or is being processed
    // concurrently). Don't re-apply it.
    if (dedupeError.code === '23505') {
      return NextResponse.json({ received: true, deduped: true })
    }
    // Any other error (e.g. transient DB issue) — fail open rather than drop
    // a billing event. Idempotency is best-effort insurance here, not a hard
    // gate; a rare duplicate is a much smaller risk than silently losing a
    // real subscription/payment update.
    console.error('processed_stripe_events insert failed, processing anyway:', dedupeError.message)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.CheckoutSession
      if (session.mode !== 'subscription') break
      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const priceId = sub.items.data[0]?.price.id
      const plan = planFromPriceId(priceId)
      const periodEnd = sub.items.data[0]?.current_period_end
      await updateBilling(session.customer as string, {
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        plan,
        ...(periodEnd ? { current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
      })
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const priceId = sub.items.data[0]?.price.id
      const plan = planFromPriceId(priceId)
      const periodEnd = sub.items.data[0]?.current_period_end
      await updateBilling(sub.customer as string, {
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        plan,
        ...(periodEnd ? { current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await updateBilling(sub.customer as string, {
        subscription_status: 'canceled',
        stripe_subscription_id: null,
        current_period_end: null,
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      await updateBilling(invoice.customer as string, {
        subscription_status: 'past_due',
      })

      // JAY-167 — the owner was never told their card was declined; the
      // subscription silently went past_due until access was cut off. Notify
      // via the in-app bell and (best-effort) email.
      const { data: business } = await supabaseAdmin
        .from('business_profiles')
        .select('user_id, business_name, contact_email')
        .eq('stripe_customer_id', invoice.customer as string)
        .single()

      if (business?.user_id) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await Promise.allSettled([
          supabaseAdmin.from('notifications').insert([{
            user_id: business.user_id,
            message: 'Your payment failed — update your card to avoid losing access.',
            read: false,
            link: '/settings',
          }]),
          ...(business.contact_email
            ? [resend.emails.send({
                from: 'Helpdesk <onboarding@resend.dev>',
                to: business.contact_email,
                subject: 'Action needed: your Helpdesk payment failed',
                html: `
                  <p>Hi${business.business_name ? ` ${business.business_name}` : ''},</p>
                  <p>We weren't able to process your latest Helpdesk payment. Please update your card to avoid losing access.</p>
                `,
              })]
            : []),
        ])
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.billing_reason === 'subscription_cycle') {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
        const periodEnd = sub.items.data[0]?.current_period_end
        await updateBilling(invoice.customer as string, {
          subscription_status: 'active',
          ...(periodEnd ? { current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
        })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
