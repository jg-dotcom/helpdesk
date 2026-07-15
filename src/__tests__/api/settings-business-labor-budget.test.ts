jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/settings/business/route'
import { mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

// JAY-54 (prerequisite step) — labor budget is optional and must not be
// clobbered by unrelated saves (saveAccount/saveHours) that don't send it.
describe('POST /api/settings/business — weekly_labor_budget_cents', () => {
  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: { business_name: 'Acme' } }) as never)
    expect(res.status).toBe(401)
  })

  it('writes weekly_labor_budget_cents when provided', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', weekly_labor_budget_cents: 320000 } }) as never)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ weekly_labor_budget_cents: 320000 }),
      { onConflict: 'user_id' }
    )
  })

  it('does not touch weekly_labor_budget_cents when the field is omitted (e.g. saveHours)', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', business_hours: {} } }) as never)
    expect(res.status).toBe(200)
    const payload = upsert.mock.calls[0][0]
    expect('weekly_labor_budget_cents' in payload).toBe(false)
  })

  it('allows clearing the budget back to null', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', weekly_labor_budget_cents: null } }) as never)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ weekly_labor_budget_cents: null }),
      { onConflict: 'user_id' }
    )
  })
})
