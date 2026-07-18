jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/employee/swap-requests/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/swap-requests', () => {
  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns the employee\'s own swap requests', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null },
      { data: [{ id: 10, status: 'pending' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.swaps).toHaveLength(1)
  })

  // JAY-86 — "seen by owner" read receipt, reusing chat_read_receipts via a
  // pseudo-channel (`swap:<id>`).
  it('marks a swap request seen when a matching chat_read_receipts row exists', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'owner1' }, error: null },
      { data: [{ id: 10, status: 'pending' }], error: null },
      { data: [{ channel: 'swap:10', last_read_at: '2026-07-17T12:00:00Z' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.swaps[0].seen).toBe(true)
    expect(body.swaps[0].seenAt).toBe('2026-07-17T12:00:00Z')
  })
})
