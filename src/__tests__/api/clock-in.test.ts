// Integration tests for POST /api/employee/clock-in.
jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/employee/clock-in/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('POST /api/employee/clock-in', () => {
  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns 400 when there is already an open time entry', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: { id: 55 }, error: null }, // existing open entry found
    ])
    const res = await POST(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/already clocked in/i)
  })

  it('creates a new time entry when not already clocked in', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1' }, error: null },
      { data: null, error: null }, // no open entry
      { data: { id: 99, clock_in: '2026-07-09T09:00:00.000Z' }, error: null }, // inserted entry
    ])
    const res = await POST(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entry.id).toBe(99)
  })
})
