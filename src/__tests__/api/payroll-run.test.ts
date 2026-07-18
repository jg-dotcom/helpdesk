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

  // JAY-48: a finalized run already covering this exact period must block a
  // second run outright, before any pay is calculated.
  it('returns 409 when a finalized run already exists for this period', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 42, run_date: '2026-07-16', total_gross: 4230 }, error: null }, // payroll_runs — existing finalized check
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existingRunId).toBe(42)
    expect(body.error).toContain('already exists')
  })

  it('returns 400 when there are no active employees with pay rates', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [], error: null }, // employees
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(400)
  })

  // JAY-44: approved PTO/Sick/Personal adds paid hours; Unpaid does not.
  it('adds paid hours for an approved PTO request but not an approved Unpaid one, for hourly employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }, { id: 2, name: 'Casey R.', pay_type: 'hourly', pay_rate: 15 }], error: null }, // employees
      // 80 hrs worked for Jordan, split across two separate calendar weeks
      // (40h each) so this stays under the JAY-57 overtime threshold — this
      // test is about PTO addition, not overtime, which has its own test below.
      { data: [
        { employee_id: 1, total_minutes: 2400, clock_in: '2026-07-01T09:00:00' },
        { employee_id: 1, total_minutes: 2400, clock_in: '2026-07-08T09:00:00' },
      ], error: null }, // time_entries
      { data: [], error: null }, // pay_rate_history — no logged changes, everyone falls back to current rate
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
    const itemsCall = fromMock.mock.results[7].value // 8th .from() call = payroll_run_items insert
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

  // JAY-9: a single-day PTO request with a half-day portion should only pay
  // half the default (or scheduled) day's hours, not the full day.
  it('halves the default PTO hours for a half-day portion request', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null }, // employees
      { data: [], error: null }, // time_entries — no worked hours
      { data: [], error: null }, // pay_rate_history
      { data: [{ employee_id: 1, start_date: '2026-07-05', end_date: '2026-07-05', type: 'PTO', portion: 'first_half' }], error: null },
      { data: [], error: null }, // shifts — no scheduled shifts, falls back to 8h default → 4h half day
      { data: { id: 101, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    const jordan = insertedItems.find((i: { employee_id: number }) => i.employee_id === 1)

    // 0 worked hrs + 0.5 day PTO * 8h default / 2 = 4 hrs, $20/hr = $80
    expect(jordan.hours_worked).toBe(4)
    expect(jordan.gross_pay).toBe(80)
    expect(jordan.notes).toBe('+4.0 hrs PTO')
  })

  it('does not add PTO hours for salaried employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 3, name: 'Sam K.', pay_type: 'salary', pay_rate: 52000 }], error: null },
      { data: [], error: null },
      { data: [], error: null }, // pay_rate_history
      { data: [{ employee_id: 3, start_date: '2026-07-05', end_date: '2026-07-05', type: 'PTO' }], error: null },
      { data: [], error: null },
      { data: { id: 100, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    expect(insertedItems[0].hours_worked).toBeNull()
    expect(insertedItems[0].gross_pay).toBe(Math.round((52000 / 26) * 100) / 100)
    expect(insertedItems[0].notes).toBeNull()
  })

  // JAY-75: pay_period is a real, per-employee, UI-editable field — a
  // salaried employee set to "weekly" must be paid annual/52, not the
  // hardcoded annual/26 every other salaried employee (implicitly
  // "biweekly") gets. Previously the route never even selected pay_period.
  it('uses the correct divisor for a salaried employee whose pay_period is "weekly", not a hardcoded /26', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 4, name: 'Riley P.', pay_type: 'salary', pay_rate: 52000, pay_period: 'weekly' }], error: null },
      { data: [], error: null },
      { data: [], error: null }, // pay_rate_history
      { data: [], error: null }, // paid time off
      { data: [], error: null }, // shifts
      { data: { id: 102, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    // $52,000 / 52 weeks = $1,000 — NOT $52,000 / 26 = $2,000 (the old bug).
    expect(insertedItems[0].gross_pay).toBe(1000)
  })

  // JAY-51: a mid-period rate change must split gross pay across the old and
  // new rate by which days each hour was actually worked on, instead of
  // applying whichever rate is current at run-time to the whole period.
  it('applies the OLD rate to days before the change and the NEW rate to days after, when both are logged', async () => {
    mockOwner({ id: 1 })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null },
      { data: [
        { employee_id: 1, total_minutes: 480, clock_in: '2026-07-01T09:00:00' },
        { employee_id: 1, total_minutes: 480, clock_in: '2026-07-08T09:00:00' },
      ], error: null },
      // Two logged rates: $18 effective from the start of time (an early date), $20 from 07-08.
      { data: [
        { employee_id: 1, pay_rate: 18, effective_from: '2026-01-01' },
        { employee_id: 1, pay_rate: 20, effective_from: '2026-07-08' },
      ], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: 102, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    const jordan = insertedItems.find((i: { employee_id: number }) => i.employee_id === 1)

    // 8h @ $18 (07-01) + 8h @ $20 (07-08) = 144 + 160 = 304
    expect(jordan.hours_worked).toBe(16)
    expect(jordan.gross_pay).toBe(304)
    expect(jordan.notes).toBe('8h @ $18.00/hr + 8h @ $20.00/hr')
  })

  // JAY-57 — hours worked past 40 in a single calendar week get a 1.5x
  // premium. 48 hours in one week: 40 regular + 8 overtime.
  it('pays 1.5x for hours worked past 40 in a single week', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null },
      { data: [{ employee_id: 1, total_minutes: 2880, clock_in: '2026-07-01T09:00:00' }], error: null }, // 48 hrs, one day, one week
      { data: [], error: null }, // pay_rate_history
      { data: [], error: null }, // time_off_requests
      { data: [], error: null }, // shifts
      { data: { id: 200, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    const jordan = insertedItems.find((i: { employee_id: number }) => i.employee_id === 1)

    // 40h regular @ $20 + 8h OT @ $30 (1.5x) = 800 + 240 = 1040
    expect(jordan.hours_worked).toBe(48)
    expect(jordan.overtime_hours).toBe(8)
    expect(jordan.gross_pay).toBe(1040)
    expect(jordan.notes).toBe('8h OT @ 1.5x')
  })

  // JAY-95: if the payroll_run_items insert fails, the route must not report
  // success — the just-created payroll_runs row (with its already-committed
  // total_gross/employee_count) must be deleted, and a 500 returned.
  it('returns 500 and deletes the run when the payroll_run_items insert fails', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // payroll_runs — no existing finalized run
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null }, // employees
      { data: [], error: null }, // time_entries
      { data: [], error: null }, // pay_rate_history
      { data: [], error: null }, // time_off_requests
      { data: [], error: null }, // shifts
      { data: { id: 300, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null }, // payroll_runs insert
      { data: null, error: { message: 'insert failed' } }, // payroll_run_items insert — fails
      { data: null, error: null }, // payroll_runs delete (cleanup)
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('insert failed')

    // The 9th .from() call is the cleanup delete of the orphaned run.
    const deleteCall = fromMock.mock.results[8].value
    expect(deleteCall.delete).toHaveBeenCalled()
    expect(deleteCall.eq).toHaveBeenCalledWith('id', 300)
  })

  // JAY-57 — PTO hours must never count toward the 40h overtime threshold,
  // even though they're added to the same total hours_worked figure.
  it('does not count PTO hours toward the overtime threshold', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null },
      { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null },
      { data: [{ employee_id: 1, total_minutes: 2400, clock_in: '2026-07-01T09:00:00' }], error: null }, // 40 hrs worked
      { data: [], error: null },
      { data: [{ employee_id: 1, start_date: '2026-07-02', end_date: '2026-07-02', type: 'PTO' }], error: null }, // +8h PTO, same week
      { data: [], error: null }, // shifts — falls back to 8h default
      { data: { id: 201, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const itemsCall = fromMock.mock.results[7].value
    const insertedItems = itemsCall.insert.mock.calls[0][0]
    const jordan = insertedItems.find((i: { employee_id: number }) => i.employee_id === 1)

    // 40h worked + 8h PTO = 48 total hours, but PTO isn't "worked," so no
    // overtime premium applies — all 48 hours pay at the straight rate.
    expect(jordan.hours_worked).toBe(48)
    expect(jordan.overtime_hours).toBeNull()
    expect(jordan.gross_pay).toBe(960)
    expect(jordan.notes).toBe('+8.0 hrs PTO')
  })

  // JAY-115 — off-cycle runs (bonus/correction/one-off pay).
  describe('off-cycle runs', () => {
    it('returns 400 when runType is off_cycle but no employeeIds are given', async () => {
      mockOwner({ id: 'owner-1' })
      const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14', runType: 'off_cycle' } }) as never)
      expect(res.status).toBe(400)
    })

    // The JAY-48 duplicate-finalized-period check must be skipped entirely
    // for off-cycle runs — no payroll_runs lookup should happen first.
    it('skips the duplicate-finalized-period check for an off-cycle run', async () => {
      mockOwner({ id: 'owner-1' })
      const fromMock = queueFromResponses(supabaseAdmin, [
        { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null }, // employees (filtered to employeeIds)
        { data: [], error: null }, // time_entries
        { data: [], error: null }, // pay_rate_history
        { data: [], error: null }, // time_off_requests
        { data: [], error: null }, // shifts
        { data: { id: 500, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null }, // payroll_runs insert
        { data: null, error: null }, // payroll_run_items insert
      ])
      const res = await POST(mockRequest({
        token: 'good',
        body: { periodStart: '2026-07-01', periodEnd: '2026-07-14', runType: 'off_cycle', employeeIds: [1], reason: 'Bonus' },
      }) as never)
      expect(res.status).toBe(200)
      // First .from() call must be 'employees', not 'payroll_runs' (the dup check).
      expect(fromMock.mock.calls[0][0]).toBe('employees')

      const runInsertCall = fromMock.mock.results[5].value
      expect(runInsertCall.insert).toHaveBeenCalledWith(
        expect.objectContaining({ run_type: 'off_cycle', reason: 'Bonus' })
      )
    })

    it('scopes the employees query to the given employeeIds', async () => {
      mockOwner({ id: 'owner-1' })
      const fromMock = queueFromResponses(supabaseAdmin, [
        { data: [{ id: 2, name: 'Casey R.', pay_type: 'hourly', pay_rate: 15 }], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: { id: 501, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
        { data: null, error: null },
      ])
      await POST(mockRequest({
        token: 'good',
        body: { periodStart: '2026-07-01', periodEnd: '2026-07-14', runType: 'off_cycle', employeeIds: [2], reason: 'Correction' },
      }) as never)
      const employeesQueryBuilder = fromMock.mock.results[0].value
      expect(employeesQueryBuilder.in).toHaveBeenCalledWith('id', [2])
    })

    it('a regular run still stores run_type: regular and reason: null', async () => {
      mockOwner({ id: 'owner-1' })
      const fromMock = queueFromResponses(supabaseAdmin, [
        { data: null, error: null }, // payroll_runs — no existing finalized run
        { data: [{ id: 1, name: 'Jordan T.', pay_type: 'hourly', pay_rate: 20 }], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: { id: 502, period_start: '2026-07-01', period_end: '2026-07-14' }, error: null },
        { data: null, error: null },
      ])
      const res = await POST(mockRequest({ token: 'good', body: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
      expect(res.status).toBe(200)
      const runInsertCall = fromMock.mock.results[6].value
      expect(runInsertCall.insert).toHaveBeenCalledWith(
        expect.objectContaining({ run_type: 'regular', reason: null })
      )
    })
  })
})
