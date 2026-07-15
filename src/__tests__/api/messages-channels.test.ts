jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))
jest.mock('../../app/lib/apiAuth', () => ({ getBearerUser: jest.fn() }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { getBearerUser } from '../../app/lib/apiAuth'
import { GET } from '../../app/api/messages/channels/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/messages/channels', () => {
  it('returns 401 without a token', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue(null)
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('flags a channel as mentioned only when an unread message actually contains "@MyName"', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue({ id: 'user-5', email: 'jordan@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // business_profiles lookup — not an owner
      { data: { id: 5, user_id: 'owner-1', name: 'Jordan Taylor' }, error: null }, // employee record (this is "me")
      { data: null, error: null }, // last message: general
      { data: null, error: null }, // last message: dm_emp_5
      { data: null, error: null }, // read receipt: general
      { data: null, error: null }, // read receipt: dm_emp_5
      { data: null, error: null, count: 2 } as never, // unread count: general
      { data: null, error: null, count: 0 } as never, // unread count: dm_emp_5
      { data: null, error: null, count: 1 } as never, // mention count: general — has one
      { data: null, error: null, count: 0 } as never, // mention count: dm_emp_5 — none
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    const general = body.channels.find((c: { id: string }) => c.id === 'general')
    const dm = body.channels.find((c: { id: string }) => c.id === 'dm_emp_5')
    expect(general.mentioned).toBe(true)
    expect(general.unreadCount).toBe(2)
    expect(dm.mentioned).toBe(false)
    expect(dm.unreadCount).toBe(0)
  })
})
