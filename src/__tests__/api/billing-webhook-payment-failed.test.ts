jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

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
  sendMock.mockClear()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  process.env.RESEND_API_KEY = 'test_key'
})

describe('POST /api/billing/webhook — invoice.payment_failed notifications (JAY-167)', () => {
  it('sets past_due, inserts a notification, and emails the owner when contact_email is present', async () => {
    const dedupeInsert = jest.fn().mockResolvedValue({ error: null })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
    const businessSingle = jest.fn().mockResolvedValue({
      data: { user_id: 'user-1', business_name: "Joe's Diner", contact_email: 'owner@example.com' },
      error: null,
    })
    const notificationsInsert = jest.fn().mockResolvedValue({ error: null })

    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') return { insert: dedupeInsert }
      if (table === 'business_profiles') {
        return {
          update,
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: businessSingle }) }),
        }
      }
      if (table === 'notifications') return { insert: notificationsInsert }
      return {}
    })

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_pf_1',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    })

    const res = await POST(mockNextRequest('{}'))
    expect(res.status).toBe(200)

    expect(update).toHaveBeenCalledWith({ subscription_status: 'past_due' })
    expect(notificationsInsert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'user-1', read: false, link: '/settings' }),
    ])
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }))
  })

  it('still returns 200 and does not error when contact_email is null', async () => {
    const dedupeInsert = jest.fn().mockResolvedValue({ error: null })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
    const businessSingle = jest.fn().mockResolvedValue({
      data: { user_id: 'user-2', business_name: null, contact_email: null },
      error: null,
    })
    const notificationsInsert = jest.fn().mockResolvedValue({ error: null })

    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') return { insert: dedupeInsert }
      if (table === 'business_profiles') {
        return {
          update,
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: businessSingle }) }),
        }
      }
      if (table === 'notifications') return { insert: notificationsInsert }
      return {}
    })

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_pf_2',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_2' } },
    })

    const res = await POST(mockNextRequest('{}'))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ subscription_status: 'past_due' })
    expect(notificationsInsert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'user-2' }),
    ])
    expect(sendMock).not.toHaveBeenCalled()
  })
})
