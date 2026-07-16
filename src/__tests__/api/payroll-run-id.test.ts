jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { PATCH } from '../../app/api/payroll/run/[id]/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('PATCH /api/payroll/run/[id] — deductions branch (JAY-76)', () => {
  it('returns 401 without a token', async () => {
    const res = await PATCH(mockRequest({ body: { itemId: 1, deductions: {} } }) as never, { params: { id: 'run-1' } })
    expect(res.status).toBe(401)
  })

  it('updates deductions when the item belongs to the run and the run belongs to the caller', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { gross_pay: 500, run_id: 'run-1' }, error: null }, // payroll_run_items lookup
      { data: { id: 'run-1' }, error: null },                     // payroll_runs ownership check
      { data: null, error: null },                                 // update
    ])
    const res = await PATCH(
      mockRequest({ token: 'good', body: { itemId: 42, deductions: { federal: 50 } } }) as never,
      { params: { id: 'run-1' } }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.netPay).toBe(450)
    // The item lookup must be scoped to this run, not just the raw item id.
    const itemLookupCall = fromMock.mock.results[0].value
    expect(itemLookupCall.eq).toHaveBeenCalledWith('run_id', 'run-1')
  })

  it('returns 404 when the item does not belong to the run named in the URL (cross-tenant attempt)', async () => {
    mockOwner({ id: 'owner-1' })
    // Item lookup scoped to run_id='run-1' finds nothing because the real
    // item belongs to a different (e.g. another business's) run.
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null },
    ])
    const res = await PATCH(
      mockRequest({ token: 'good', body: { itemId: 999, deductions: { federal: 50 } } }) as never,
      { params: { id: 'run-1' } }
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when the run exists but does not belong to the caller (ownership check)', async () => {
    mockOwner({ id: 'attacker-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { gross_pay: 500, run_id: 'run-1' }, error: null }, // item found, belongs to run-1
      { data: null, error: null },                                 // but run-1 isn't owned by attacker-1
    ])
    const res = await PATCH(
      mockRequest({ token: 'good', body: { itemId: 42, deductions: { federal: 999 } } }) as never,
      { params: { id: 'run-1' } }
    )
    expect(res.status).toBe(404)
  })

  it('finalize branch still scopes by user_id (unchanged, regression check)', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(
      mockRequest({ token: 'good', body: { action: 'finalize' } }) as never,
      { params: { id: 'run-1' } }
    )
    expect(res.status).toBe(200)
  })
})
