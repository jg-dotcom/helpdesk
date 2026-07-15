const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })) }))

jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn(), admin: { generateLink: jest.fn(), listUsers: jest.fn() } },
    from: jest.fn(),
  },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/team/invite/resend/route'
import { GET as pendingGET } from '../../app/api/team/invite/pending/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('POST /api/team/invite/resend', () => {
  beforeEach(() => {
    sendMock.mockClear()
    ;(supabaseAdmin.auth.admin.generateLink as jest.Mock).mockResolvedValue({
      data: { properties: { action_link: 'https://example.com/magic' } },
    })
  })

  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: { employeeId: 1 } }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the employee is not found', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockRequest({ token: 'good', body: { employeeId: 99 } }) as never)
    expect(res.status).toBe(404)
  })

  it('sends a fresh setup invite email for an existing employee', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, email: 'e@x.com', access_role: 'employee' }, error: null },
      { data: { business_name: 'Acme' }, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { employeeId: 1 } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].to).toBe('e@x.com')
  })

  it('returns 500 with a message when the email send fails', async () => {
    mockOwner({ id: 'owner-1' })
    sendMock.mockRejectedValueOnce(new Error('resend down'))
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1, email: 'e@x.com', access_role: 'employee' }, error: null },
      { data: { business_name: 'Acme' }, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { employeeId: 1 } }) as never)
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('resend down')
  })
})

describe('GET /api/team/invite/pending', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 401 without a token', async () => {
    const res = await pendingGET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns employee ids who have never signed in', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, email: 'a@x.com' }, { id: 2, email: 'b@x.com' }], error: null },
    ])
    ;(supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValue({
      data: {
        users: [
          { email: 'a@x.com', last_sign_in_at: null },
          { email: 'b@x.com', last_sign_in_at: '2026-01-01T00:00:00Z' },
        ],
      },
      error: null,
    })
    const res = await pendingGET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.pendingIds).toEqual([1])
  })

  it('returns an empty list when there are no employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: [], error: null }])
    const res = await pendingGET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.pendingIds).toEqual([])
  })
})
