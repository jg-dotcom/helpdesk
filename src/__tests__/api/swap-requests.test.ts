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
})
