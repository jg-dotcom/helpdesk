jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const stripeMock = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
  invoices: { createPreview: jest.fn() },
}
jest.mock('../../app/lib/stripe', () => ({
  stripe: stripeMock,
  PLANS: {
    starter: { name: 'Starter', price: 29, employeeLimit: 10, priceId: 'price_starter' },
    growth: { name: 'Growth', price: 69, employeeLimit: 30, priceId: 'price_growth' },
    pro: { name: 'Pro', price: 129, employeeLimit: Infinity, priceId: 'price_pro' },
  },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST as createCheckout } from '../../app/api/billing/create-checkout/route'
import { POST as previewSwitch } from '../../app/api/billing/preview-switch/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string; email?: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

beforeEach(() => {
  stripeMock.customers.create.mockReset()
  stripeMock.checkout.sessions.create.mockReset()
  stripeMock.subscriptions.retrieve.mockReset()
  stripeMock.subscriptions.update.mockReset()
  stripeMock.invoices.createPreview.mockReset()
})

describe('POST /api/billing/create-checkout', () => {
  it('returns 401 without a token', async () => {
    const res = await createCheckout(mockRequest({ body: { plan: 'growth' } }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid plan', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await createCheckout(mockRequest({ token: 'good', body: { plan: 'not-a-plan' } }) as never)
    expect(res.status).toBe(400)
  })

  it('creates a new Checkout session when there is no live subscription', async () => {
    mockOwner({ id: 'owner-1', email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { stripe_customer_id: 'cus_1', stripe_subscription_id: null, subscription_status: null, business_name: 'Acme' }, error: null },
    ])
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/xyz' })
    const res = await createCheckout(mockRequest({ token: 'good', body: { plan: 'growth' } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.url).toBe('https://checkout.stripe.com/xyz')
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled()
  })

  // JAY-45 — the actual bug: switching plans while already subscribed must never create
  // a second Checkout/subscription.
  it('updates the existing subscription in place instead of creating a new checkout session', async () => {
    mockOwner({ id: 'owner-1', email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active', business_name: 'Acme' }, error: null },
      { data: null, error: null }, // business_profiles update after switching
    ])
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: 'si_1' }] } })
    stripeMock.subscriptions.update.mockResolvedValue({ status: 'active', items: { data: [{ current_period_end: 1234567890 }] } })

    const res = await createCheckout(mockRequest({ token: 'good', body: { plan: 'growth' } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.switched).toBe(true)
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      items: [{ id: 'si_1', price: 'price_growth' }],
      proration_behavior: 'create_prorations',
    })
  })

  it('treats a canceled subscription as not live, so it starts a fresh checkout', async () => {
    mockOwner({ id: 'owner-1', email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_old', subscription_status: 'canceled', business_name: 'Acme' }, error: null },
    ])
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/xyz' })
    const res = await createCheckout(mockRequest({ token: 'good', body: { plan: 'pro' } }) as never)
    expect(res.status).toBe(200)
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/billing/preview-switch', () => {
  it('returns 401 without a token', async () => {
    const res = await previewSwitch(mockRequest({ body: { plan: 'growth' } }) as never)
    expect(res.status).toBe(401)
  })

  it('reports isNewSubscription when there is no live subscription to prorate', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null }, error: null },
    ])
    const res = await previewSwitch(mockRequest({ token: 'good', body: { plan: 'growth' } }) as never)
    const body = await res.json()
    expect(body.isNewSubscription).toBe(true)
    expect(stripeMock.invoices.createPreview).not.toHaveBeenCalled()
  })

  it('returns the prorated amount due today and the next full charge for a live subscription', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active' }, error: null },
    ])
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: 'si_1', current_period_end: 1234567890 }] } })
    stripeMock.invoices.createPreview.mockResolvedValue({ amount_due: 1234 })

    const res = await previewSwitch(mockRequest({ token: 'good', body: { plan: 'growth' } }) as never)
    const body = await res.json()
    expect(body.isNewSubscription).toBe(false)
    expect(body.dueTodayCents).toBe(1234)
    expect(body.nextChargeCents).toBe(6900)
    expect(stripeMock.invoices.createPreview).toHaveBeenCalledWith({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: { items: [{ id: 'si_1', price: 'price_growth' }], proration_behavior: 'create_prorations' },
    })
  })
})
