jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { PATCH } from '../../app/api/employees/[id]/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('PATCH /api/employees/[id]', () => {
  it('returns 401 without a token', async () => {
    const res = await PATCH(mockRequest({ body: { role: 'Manager' } }) as never, params('5'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when no valid fields are provided', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await PATCH(mockRequest({ token: 'good', body: {} }) as never, params('5'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the employee does not belong to this owner', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { role: 'Manager' } }) as never, params('5'))
    expect(res.status).toBe(404)
  })

  it('updates the role for an owned employee', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 5 }, error: null }, // ownership check
      { data: { id: 5, role: 'Manager' }, error: null }, // update
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { role: 'Manager' } }) as never, params('5'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.employee).toEqual({ id: 5, role: 'Manager' })
    expect(fromMock.mock.calls.map(c => c[0])).toEqual(['employees', 'employees'])
  })

  it('updates status to deactivate an employee', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 5 }, error: null },
      { data: { id: 5, status: 'terminated' }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'terminated' } }) as never, params('5'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.employee.status).toBe('terminated')
  })

  it('returns 500 when the update fails', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 5 }, error: null },
      { data: null, error: { message: 'update failed' } },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { role: 'Manager' } }) as never, params('5'))
    expect(res.status).toBe(500)
  })
})
