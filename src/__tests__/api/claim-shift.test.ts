jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/employee/claim-shift/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('POST /api/employee/claim-shift', () => {
  it('returns 400 when shiftId is missing', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const res = await POST(mockRequest({ token: 'good', body: {} }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockRequest({ token: 'good', body: { shiftId: 5 } }) as never)
    expect(res.status).toBe(403)
  })

  it('returns 404 when the shift does not exist or belongs to a different business', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { shiftId: 5 } }) as never)
    expect(res.status).toBe(404)
  })

  it('returns 409 when the shift is already claimed', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: { id: 5, is_open_shift: true, employee_id: 9 }, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { shiftId: 5 } }) as never)
    expect(res.status).toBe(409)
  })

  it('claims the shift when it is genuinely open', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: { id: 5, is_open_shift: true, employee_id: null }, error: null },
      { data: { id: 5, employee_id: 1, is_open_shift: false }, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { shiftId: 5 } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.shift.employee_id).toBe(1)
  })
})
