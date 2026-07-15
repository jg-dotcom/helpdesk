jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/employee/open-shifts/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/open-shifts', () => {
  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns the list of unclaimed open shifts', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: [{ id: 5, shift_date: '2026-07-11', start_time: '09:00', end_time: '17:00' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.shifts).toHaveLength(1)
  })

  it('defaults to an empty array when the query returns null', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: null, error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.shifts).toEqual([])
  })
})
