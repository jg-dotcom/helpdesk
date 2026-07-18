// Integration tests for /api/employee/notifications (GET list, PATCH mark-read) — JAY-120.
jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET, PATCH } from '../../app/api/employee/notifications/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/notifications', () => {
  it('returns 401 without a valid token', async () => {
    mockAuthUser(supabaseAdmin, null)
    const res = await GET(mockRequest({ token: 'bad' }) as never)
    expect(res.status).toBe(401)
  })

  it('returns the notifications for the logged-in employee, newest-first', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 2, message: 'Approved', link: null, read: false, created_at: '2026-07-18T00:00:00Z' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
  })
})

describe('PATCH /api/employee/notifications', () => {
  it('returns 401 without a valid token', async () => {
    mockAuthUser(supabaseAdmin, null)
    const res = await PATCH(mockRequest({ token: 'bad', body: { id: 1 } }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when id is missing', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const res = await PATCH(mockRequest({ token: 'good', body: {} }) as never)
    expect(res.status).toBe(400)
  })

  it('marks the notification read, scoped to the current user', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    const fromMock = queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { id: 2 } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(fromMock).toHaveBeenCalledWith('notifications')
  })

  it('returns 500 when the update fails', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: { message: 'update failed' } }])
    const res = await PATCH(mockRequest({ token: 'good', body: { id: 2 } }) as never)
    expect(res.status).toBe(500)
  })
})
