jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET, POST } from '../../app/api/applications/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('POST /api/applications (public)', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(mockRequest({ body: { name: 'Jane' } }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 500 when the insert fails', async () => {
    queueFromResponses(supabaseAdmin, [{ data: null, error: { message: 'insert failed' } }])
    const res = await POST(mockRequest({
      body: { job_posting_id: 1, owner_id: 'owner-1', name: 'Jane', email: 'jane@example.com' },
    }) as never)
    expect(res.status).toBe(500)
  })

  it('creates the application, notifies the owner, and confirms receipt by email', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // insert application
      { data: { title: 'Cashier' }, error: null }, // job posting title lookup
      { data: { business_name: 'Joe\'s Diner' }, error: null }, // business profile lookup
      { data: null, error: null }, // notification insert
    ])
    const res = await POST(mockRequest({
      body: { job_posting_id: 1, owner_id: 'owner-1', name: 'Jane', email: 'jane@example.com' },
    }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'jane@example.com', subject: expect.stringContaining('Cashier') })
  })

  it('still succeeds if the confirmation email fails to send', async () => {
    sendMock.mockRejectedValueOnce(new Error('resend down'))
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null },
      { data: { title: 'Cashier' }, error: null },
      { data: { business_name: 'Joe\'s Diner' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({
      body: { job_posting_id: 1, owner_id: 'owner-1', name: 'Jane', email: 'jane@example.com' },
    }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})

describe('GET /api/applications (owner)', () => {
  it('returns 401 without a token', async () => {
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns the owner\'s applications', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: [{ id: 1, name: 'Jane' }], error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.applications).toHaveLength(1)
  })
})
