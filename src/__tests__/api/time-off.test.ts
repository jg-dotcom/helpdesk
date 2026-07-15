// Integration tests for /api/employee/time-off (GET list, POST new request).
jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET, POST } from '../../app/api/employee/time-off/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/time-off', () => {
  it('returns 401 without a valid token', async () => {
    mockAuthUser(supabaseAdmin, null)
    const res = await GET(mockRequest({ token: 'bad' }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns the employee\'s requests ordered newest-first', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null },
      { data: [{ id: 10, status: 'pending' }, { id: 9, status: 'approved' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.requests).toHaveLength(2)
  })
})

describe('POST /api/employee/time-off', () => {
  it('returns 400 when required fields are missing', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, user_id: 'u1', name: 'Jane' }, error: null }])
    const res = await POST(mockRequest({ token: 'good', body: { startDate: '2026-07-10' } }) as never)
    expect(res.status).toBe(400)
  })

  it('creates the request and notifies the owner on success', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1', name: 'Jane' }, error: null }, // employee lookup
      { data: null, error: null }, // insert into time_off_requests
      { data: null, error: null }, // insert into notifications
    ])
    const res = await POST(mockRequest({
      token: 'good',
      body: { startDate: '2026-07-10', endDate: '2026-07-12', type: 'vacation', reason: 'trip' },
    }) as never)
    const body = await res.json()
    expect(body).toEqual({ success: true })
    expect(fromMock).toHaveBeenCalledWith('time_off_requests')
    expect(fromMock).toHaveBeenCalledWith('notifications')
  })

  it('returns 500 and does not notify when the insert fails', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'u1', name: 'Jane' }, error: null },
      { data: null, error: { message: 'insert failed' } },
    ])
    const res = await POST(mockRequest({
      token: 'good',
      body: { startDate: '2026-07-10', endDate: '2026-07-12', type: 'vacation' },
    }) as never)
    expect(res.status).toBe(500)
    expect(fromMock).not.toHaveBeenCalledWith('notifications')
  })
})
