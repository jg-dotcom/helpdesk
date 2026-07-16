jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))
jest.mock('../../lib/teamInvite', () => ({ sendSetupInviteEmail: jest.fn().mockResolvedValue(undefined) }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/team/invite/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('POST /api/team/invite', () => {
  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: { email: 'a@b.com', role: 'manager' } }) as never)
    expect(res.status).toBe(401)
  })

  // JAY-77 — `role` (job title) and `access_role` (permission level) are two
  // distinct columns. Inviting someone as "manager" must not leave their job
  // title set to the literal string "manager" — it should stay blank until
  // the owner fills in a real title, same as a manually-added employee.
  it('does NOT write the access level into the role (job title) column for a newly-invited employee', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { business_name: 'Acme Co' }, error: null }, // business_profiles lookup
      { data: null, error: null },                          // existing employee check — none found
      { data: { id: 5 }, error: null },                      // insert
    ])
    const res = await POST(mockRequest({ token: 'good', body: { email: 'new.manager@example.com', role: 'manager' } }) as never)
    expect(res.status).toBe(200)

    const insertCall = fromMock.mock.results[2].value
    const insertedRow = insertCall.insert.mock.calls[0][0][0]
    expect(insertedRow.role).toBeNull()
    expect(insertedRow.access_role).toBe('manager')
  })

  it('updates only access_role (not role) when the email matches an existing employee', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { business_name: 'Acme Co' }, error: null },
      { data: { id: 7 }, error: null }, // existing employee found
      { data: null, error: null },       // update
    ])
    const res = await POST(mockRequest({ token: 'good', body: { email: 'existing@example.com', role: 'admin' } }) as never)
    expect(res.status).toBe(200)

    const updateCall = fromMock.mock.results[2].value
    const updatePayload = updateCall.update.mock.calls[0][0]
    expect(updatePayload).toEqual({ access_role: 'admin' })
    expect(updatePayload.role).toBeUndefined()
  })
})
