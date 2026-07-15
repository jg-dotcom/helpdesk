jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/payroll/run/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('POST /api/payroll/run', () => {
  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when periodStart/periodEnd are missing', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await POST(mockRequest({ token: 'good', body: {} }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 400 when there are no active employees with pay rates', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: [], error: null }])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(400)
  })

  // JAY-44: approved PTO/Sick/Personal adds paid hours; Unpaid does not.
  it('adds paid hours for an approved PTO request but not an approved Unpaid one, for hourly employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }, { id: 2, name: 'Casey R.', pay_type: 'hourly', pay_rate: 15 }], error: null }, // employees
      { data: [{ employee_id: 1, total_minutes: 4800 }], error: null }, // time_entries — 80 hrs worked for Jordan
      // time_off_requests — the route's own `.in('type', PAID_TIME_OFF_TYPES)` filter means an
      // Unpaid row for Casey would never come back from the real query at all; the mock returns
      // exactly what Supabase would return post-filter, so only Jordan's PTO row appears here.
      { data: [{ employee_id: 1, start_date: '2026-07-05', end_date: '2026-07-06', type: 'PTO' }], error: null },
      { data: [], error: null }, // shifts — no scheduled shifts, so PTO falls back to the 8h/day default
      { data: { id: 99, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null }, // payroll_runs insert
      { data: null, error: null }, // payroll_run_items insert
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    // Verify the items inserted into payroll_run_items reflect the PTO bump.
    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[5].value // 6th .from() call = payroll_run_items insert
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    const jordan = insertedItems.find((i: { employee_id: number }) => i.employee_id === 1)
    const casey = insertedItems.find((i: { employee_id: number }) => i.employee_id === 2)

    // Jordan: 80 worked hrs + 2 days PTO * 8h default = 96 hrs, $20/hr = $1920
    expect(jordan.hours_worked).toBe(96)
    expect(jordan.gross_pay).toBe(1920)
    expect(jordan.notes).toBe('+16.0 hrs PTO')

    // Casey: 0 worked hrs, Unpaid excluded entirely — no PTO bump, no notes
    expect(casey.hours_worked).toBe(0)
    expect(casey.gross_pay).toBe(0)
    expect(casey.notes).toBeNull()
  })

  it('does not add PTO hours for salaried employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 3, name: 'Sam K.', pay_type: 'salary', pay_rate: 52000 }], error: null },
      { data: [], error: null },
      { data: [{ employee_id: 3, start_date: '2026-07-05', end_date: '2026-07-05', type: 'PTO' }], error: null },
      { data: [], error: null },
      { data: { id: 100, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[5].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    expect(insertedItems[0].hours_worked).toBeNull()
    expect(insertedItems[0].gross_pay).toBe(Math.round((52000 / 26) * 100) / 100)
    expect(insertedItems[0].notes).toBeNull()
  })
})
