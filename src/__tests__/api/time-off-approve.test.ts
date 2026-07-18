// PATCH /api/time-off/[id] — owner approves/denies a request. This route
// creates its own Supabase client inline (via createClient) for the auth
// check instead of reusing supabaseAdmin, so @supabase/supabase-js itself
// needs mocking here, in addition to supabaseAdmin for the data queries.
jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: { auth: { admin: { listUsers: jest.fn() } }, from: jest.fn() },
}))

const mockGetUser = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { PATCH } from '../../app/api/time-off/[id]/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('PATCH /api/time-off/[id]', () => {
  beforeEach(() => {
    ;(supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValue({ data: { users: [] }, error: null })
  })

  it('returns 400 for an invalid status', async () => {
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'maybe' } }) as never, params('1'))
    expect(res.status).toBe(400)
  })

  it('returns 401 without a token', async () => {
    const res = await PATCH(mockRequest({ body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token has no matching user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await PATCH(mockRequest({ token: 'bad', body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the request does not belong to this owner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, user_id: 'owner-2' }, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(404)
  })

  it('approves the request and notifies the owner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'owner-1', employee_id: 5, start_date: '2026-07-10', end_date: '2026-07-12', type: 'vacation' }, error: null },
      { data: null, error: null }, // update
      { data: { name: 'Jane', email: 'jane@example.com' }, error: null }, // employee name/email lookup
      { data: null, error: null }, // owner notification insert
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(fromMock).toHaveBeenCalledWith('notifications')
  })

  // JAY-120 — the employee themself should also get a notification, in
  // their own portal bell, resolved by matching their auth account's email.
  it('also notifies the employee at their own auth id when the email matches', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    ;(supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValue({
      data: { users: [{ id: 'employee-auth-1', email: 'jane@example.com' }] },
      error: null,
    })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'owner-1', employee_id: 5, start_date: '2026-07-10', end_date: '2026-07-12', type: 'vacation' }, error: null },
      { data: null, error: null }, // update
      { data: { name: 'Jane', email: 'jane@example.com' }, error: null }, // employee name/email lookup
      { data: null, error: null }, // owner notification insert
      { data: null, error: null }, // employee notification insert
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(200)
    const notifCalls = (fromMock.mock.calls as unknown[][]).filter(call => call[0] === 'notifications')
    expect(notifCalls).toHaveLength(2)
  })

  it('does not notify the employee when no auth account matches their email', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    ;(supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValue({ data: { users: [] }, error: null })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'owner-1', employee_id: 5, start_date: '2026-07-10', end_date: '2026-07-12', type: 'vacation' }, error: null },
      { data: null, error: null }, // update
      { data: { name: 'Jane', email: 'jane@example.com' }, error: null }, // employee name/email lookup
      { data: null, error: null }, // owner notification insert
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(200)
    const notifCalls = (fromMock.mock.calls as unknown[][]).filter(call => call[0] === 'notifications')
    expect(notifCalls).toHaveLength(1)
  })

  it('returns 500 when the update fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, user_id: 'owner-1', employee_id: 5, start_date: '2026-07-10', end_date: '2026-07-12', type: 'vacation' }, error: null },
      { data: null, error: { message: 'update failed' } },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'denied' } }) as never, params('1'))
    expect(res.status).toBe(500)
  })
})
