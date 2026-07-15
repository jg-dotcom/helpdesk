jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/employee/coworker-shifts/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/coworker-shifts', () => {
  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns an empty list when there are no active coworkers', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: [], error: null }, // no coworkers
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.shifts).toEqual([])
  })

  it('enriches shifts with the coworker\'s name', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: [{ id: 2, name: 'Sam' }], error: null },
      { data: [{ id: 100, employee_id: 2, shift_date: '2026-07-10', start_time: '09:00', end_time: '17:00' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.shifts[0].employee_name).toBe('Sam')
  })
})
