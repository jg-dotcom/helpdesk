jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/announcements/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user }, error: null })
}

describe('POST /api/announcements', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: { title: 'Hi', message: 'Hello' } }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when title or message is missing', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await POST(mockRequest({ token: 'good', body: { title: '  ' } }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 500 when the announcement fails to save', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: { message: 'insert failed' } }])
    const res = await POST(mockRequest({ token: 'good', body: { title: 'Hi', message: 'Hello team' } }) as never)
    expect(res.status).toBe(500)
  })

  it('saves the announcement and emails active employees with an email', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 42 }, error: null }, // insert, returns id for JAY-27 seen-tracking lookup
      { data: [{ name: 'Jane', email: 'jane@example.com' }, { name: 'No Email', email: '' }], error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { title: 'Hi', message: 'Hello team' } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sent).toBe(1) // only the one with an email
    expect(body.id).toBe(42)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
