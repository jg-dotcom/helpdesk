jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { PATCH } from '../../app/api/shifts/swaps/[id]/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('PATCH /api/shifts/swaps/[id]', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 401 without a token', async () => {
    const res = await PATCH(mockRequest({ body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid status', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'whatever' } }) as never, params('1'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the swap does not belong to this owner', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    expect(res.status).toBe(404)
  })

  it('approves the swap', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null },
      { data: null, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 500 when the update fails', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null },
      { data: null, error: { message: 'update failed' } },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'denied' } }) as never, params('1'))
    expect(res.status).toBe(500)
  })

  it('emails both the requester and target employee on approval', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 5, requester_employee_id: 1, requester_shift_id: 10, target_employee_id: 2 }, error: null }, // swap lookup
      { data: null, error: null }, // update
      { data: [{ id: 1, name: 'Jordan Taylor', email: 'jordan@example.com' }, { id: 2, name: 'Casey Reed', email: 'casey@example.com' }], error: null }, // employees
      { data: { shift_date: '2026-07-18', start_time: '09:00', end_time: '17:00' }, error: null }, // shift
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'approved' } }) as never, params('5'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(2)
    const recipients = sendMock.mock.calls.map(c => c[0].to)
    expect(recipients).toContain('jordan@example.com')
    expect(recipients).toContain('casey@example.com')
  })

  it('still succeeds if notification emails fail to send', async () => {
    mockOwner({ id: 'owner-1' })
    sendMock.mockRejectedValueOnce(new Error('resend down'))
    queueFromResponses(supabaseAdmin, [
      { data: { id: 5, requester_employee_id: 1, requester_shift_id: 10, target_employee_id: 2 }, error: null },
      { data: null, error: null },
      { data: [{ id: 1, name: 'Jordan Taylor', email: 'jordan@example.com' }, { id: 2, name: 'Casey Reed', email: 'casey@example.com' }], error: null },
      { data: { shift_date: '2026-07-18', start_time: '09:00', end_time: '17:00' }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'denied' } }) as never, params('5'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})
