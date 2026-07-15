jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/team/join/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('POST /api/team/join', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await POST(mockRequest({ body: { owner_id: 'owner-1', name: '', email: '' } }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 409 when the email already belongs to an employee', async () => {
    queueFromResponses(supabaseAdmin, [{ data: { id: 5 }, error: null }])
    const res = await POST(mockRequest({ body: { owner_id: 'owner-1', name: 'Jane Smith', email: 'jane@x.com' } }) as never)
    expect(res.status).toBe(409)
  })

  it('creates a pending employee record and succeeds', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // existing check
      { data: null, error: null }, // insert
      { data: null, error: null }, // notification insert
    ])
    const res = await POST(mockRequest({ body: { owner_id: 'owner-1', name: 'Jane Smith', email: 'jane@x.com', phone: '555-1234' } }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 500 when the insert fails', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null },
      { data: null, error: { message: 'insert failed' } },
    ])
    const res = await POST(mockRequest({ body: { owner_id: 'owner-1', name: 'Jane Smith', email: 'jane@x.com' } }) as never)
    expect(res.status).toBe(500)
  })
})
