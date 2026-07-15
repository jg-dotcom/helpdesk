jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/announcements/[id]/seen/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('GET /api/announcements/[id]/seen', () => {
  it('returns 401 without a token', async () => {
    const res = await GET(mockRequest() as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the announcement does not belong to this owner', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never, params('1'))
    expect(res.status).toBe(404)
  })

  it('returns seenCount and totalEmployees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null }, // announcement lookup
      { data: null, error: null, count: 9 } as never, // totalEmployees
      { data: null, error: null, count: 6 } as never, // seenCount
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.totalEmployees).toBe(9)
    expect(body.seenCount).toBe(6)
  })
})
