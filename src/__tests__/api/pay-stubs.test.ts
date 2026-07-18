jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/employee/pay-stubs/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('GET /api/employee/pay-stubs', () => {
  it('returns 403 when no employee record matches the email (or the employee is terminated)', async () => {
    mockAuthUser(supabaseAdmin, { email: 'ghost@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(403)
  })

  it('returns the most recent 20 stubs', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null },
      { data: [{ id: 1, gross_pay: 800 }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.stubs).toHaveLength(1)
  })

  // JAY-92 — "Run Payroll" writes to payroll_run_items, not payroll_entries;
  // pay stubs must merge both ledgers or employees paid that way see nothing.
  it('merges payroll_run_items alongside payroll_entries', async () => {
    mockAuthUser(supabaseAdmin, { email: 'jane@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 1 }, error: null }, // employees lookup
      { data: [{ id: 1, gross_pay: 800, hours_worked: 80, pay_type: 'hourly', period_start: '2026-06-01', period_end: '2026-06-15', notes: null, created_at: '2026-06-16T00:00:00Z' }], error: null }, // payroll_entries
      { data: [{ id: 5, run_id: 9, gross_pay: 1200, hours_worked: 40, pay_type: 'salary', notes: null, created_at: '2026-07-01T00:00:00Z' }], error: null }, // payroll_run_items
      { data: [{ id: 9, period_start: '2026-06-16', period_end: '2026-06-30' }], error: null }, // payroll_runs
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    const body = await res.json()
    expect(body.stubs).toHaveLength(2)
    expect(body.stubs[0].id).toBe(-5) // most recent, from payroll_run_items
    expect(body.stubs[0].period_start).toBe('2026-06-16')
    expect(body.stubs[1].id).toBe(1)
  })
})
