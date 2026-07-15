jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: jest.fn() } }))

const stripeMock = {
  webhooks: { constructEvent: jest.fn() },
  subscriptions: { retrieve: jest.fn() },
}
jest.mock('../../app/lib/stripe', () => ({
  stripe: stripeMock,
  PLANS: {
    starter: { name: 'Starter', price: 29, employeeLimit: 10, priceId: 'price_starter' },
    growth: { name: 'Growth', price: 69, employeeLimit: 30, priceId: 'price_growth' },
  },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/billing/webhook/route'

function mockNextRequest(body: string) {
  return {
    text: async () => body,
    headers: { get: () => 'sig_test' },
  } as never
}

beforeEach(() => {
  stripeMock.webhooks.constructEvent.mockReset()
  stripeMock.subscriptions.retrieve.mockReset()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

// JAY-49: Stripe retries webhook delivery at-least-once; the handler must not
// re-apply an event it has already recorded as processed.
describe('POST /api/billing/webhook — event idempotency', () => {
  it('records a new event and processes it normally', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') return { insert }
      if (table === 'business_profiles') return { update }
      return {}
    })

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_new_1',
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1' } },
    })

    const res = await POST(mockNextRequest('{}'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.deduped).toBeUndefined()
    expect(insert).toHaveBeenCalledWith({ id: 'evt_new_1', event_type: 'customer.subscription.deleted' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ subscription_status: 'canceled' }))
  })

  it('skips processing and returns 200 without re-applying a duplicate event', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    const update = jest.fn()
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') return { insert }
      if (table === 'business_profiles') return { update }
      return {}
    })

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_dup_1',
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1' } },
    })

    const res = await POST(mockNextRequest('{}'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.deduped).toBe(true)
    // The actual handler logic (business_profiles update) must NOT have run.
    expect(update).not.toHaveBeenCalled()
  })

  it('fails open (still processes) if the dedupe insert fails for a non-duplicate reason', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '500', message: 'connection reset' } })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') return { insert }
      if (table === 'business_profiles') return { update }
      return {}
    })

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_transient_1',
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1' } },
    })

    const res = await POST(mockNextRequest('{}'))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalled()
  })

  it('returns 400 on an invalid signature', async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig') })
    const res = await POST(mockNextRequest('{}'))
    expect(res.status).toBe(400)
  })
})
