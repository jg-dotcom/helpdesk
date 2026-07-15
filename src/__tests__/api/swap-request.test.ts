jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/employee/swap-request/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('POST /api/employee/swap-request', () => {
  it('returns 400 when requesterShiftId is missing', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const res = await POST(mockRequest({ token: 'good', body: {} }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockRequest({ token: 'good', body: { requesterShiftId: 5 } }) as never)
    expect(res.status).toBe(403)
  })

  it('returns 404 when the shift is not the requester\'s own', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { requesterShiftId: 5 } }) as never)
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not yours/i)
  })

  it('creates a pending swap request', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: { id: 5, employee_id: 1 }, error: null },
      { data: { id: 10, status: 'pending' }, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { requesterShiftId: 5, notes: 'need Friday off' } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.swap.status).toBe('pending')
  })
})
