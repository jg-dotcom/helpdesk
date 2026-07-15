jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/payroll/confidence-check/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('GET /api/payroll/confidence-check', () => {
  it('returns 401 without a token', async () => {
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when periodStart/periodEnd are missing', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(400)
  })

  it('returns empty results when there are no active employees', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: [], error: null }])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.hoursAnomalies).toEqual([])
    expect(body.overlaps).toEqual([])
  })

  it('flags an employee whose hours this period are well above their trailing average', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, name: 'Jordan T.' }], error: null },
      {
        data: [
          { employee_id: 1, clock_in: '2026-07-01T09:00:00Z', clock_out: '2026-07-04T21:00:00Z', total_minutes: 3600 },
        ],
        error: null,
      },
      {
        data: [
          { employee_id: 1, hours_worked: 32, payroll_runs: { period_start: '2026-06-01', user_id: 'owner-1' } },
          { employee_id: 1, hours_worked: 30, payroll_runs: { period_start: '2026-06-15', user_id: 'owner-1' } },
        ],
        error: null,
      },
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.hoursAnomalies).toHaveLength(1)
    expect(body.hoursAnomalies[0].employeeName).toBe('Jordan T.')
    expect(body.hoursAnomalies[0].hoursThisPeriod).toBe(60)
  })

  it('does not flag an employee with fewer than two past periods to compare against', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, name: 'New Hire' }], error: null },
      {
        data: [{ employee_id: 1, clock_in: '2026-07-01T09:00:00Z', clock_out: '2026-07-01T21:00:00Z', total_minutes: 720 }],
        error: null,
      },
      {
        data: [{ employee_id: 1, hours_worked: 32, payroll_runs: { period_start: '2026-06-01', user_id: 'owner-1' } }],
        error: null,
      },
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.hoursAnomalies).toEqual([])
  })

  it('flags overlapping clock-in/out entries for the same employee', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 2, name: 'Casey R.' }], error: null },
      {
        data: [
          { employee_id: 2, clock_in: '2026-07-08T09:00:00Z', clock_out: '2026-07-08T17:00:00Z', total_minutes: 480 },
          { employee_id: 2, clock_in: '2026-07-08T13:00:00Z', clock_out: '2026-07-08T21:00:00Z', total_minutes: 480 },
        ],
        error: null,
      },
      { data: [], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.overlaps).toHaveLength(1)
    expect(body.overlaps[0].employeeName).toBe('Casey R.')
    expect(body.overlaps[0].count).toBe(1)
  })

  it('flags a time entry that has been open for 10+ hours with no clock-out', async () => {
    mockOwner({ id: 'owner-1' })
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600000).toISOString()
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 3, name: 'Jordan T.' }], error: null }, // employees
      { data: [], error: null }, // time entries this period (none closed)
      { data: [], error: null }, // past payroll_run_items
      { data: [{ employee_id: 3, clock_in: twelveHoursAgo }], error: null }, // open entries
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.openTimeEntries).toHaveLength(1)
    expect(body.openTimeEntries[0].employeeName).toBe('Jordan T.')
    expect(body.openTimeEntries[0].hoursOpen).toBeGreaterThanOrEqual(10)
  })

  it('does not flag an entry open for less than the threshold', async () => {
    mockOwner({ id: 'owner-1' })
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 3, name: 'Jordan T.' }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ employee_id: 3, clock_in: twoHoursAgo }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { periodStart: '2026-07-01', periodEnd: '2026-07-14' } }) as never)
    const body = await res.json()
    expect(body.openTimeEntries).toEqual([])
  })
})
