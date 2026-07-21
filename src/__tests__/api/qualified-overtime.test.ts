jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/reports/qualified-overtime/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('GET /api/reports/qualified-overtime', () => {
  it('returns 401 without a token', async () => {
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns the JSON summary with premium-only dollars, not full OT pay', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1 }], error: null }, // payroll_runs (non-voided, in-year)
      { data: [{ employee_name: 'Jordan T.', pay_rate: 20, overtime_hours: 5 }], error: null }, // payroll_run_items
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { year: '2026' } }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.year).toBe(2026)
    expect(body.totalOtHours).toBe(5)
    expect(body.totalPremiumDollars).toBe(50) // 5 * 20 * 0.5, not 150 (full 1.5x pay)
    expect(body.employeeCount).toBe(1)
    expect(body.perEmployee).toEqual([{ employeeName: 'Jordan T.', otHours: 5, premiumDollars: 50 }])
  })

  it('excludes voided runs by never querying items when no non-voided runs exist', async () => {
    mockOwner({ id: 'owner-1' })
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: [], error: null }, // payroll_runs — none non-voided this year
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { year: '2026' } }) as never)
    const body = await res.json()
    expect(body.employeeCount).toBe(0)
    expect(body.totalPremiumDollars).toBe(0)
    // Only the payroll_runs query should have run — no payroll_run_items call
    // when there are no run ids to scope it to.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('returns CSV when format=csv', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1 }], error: null },
      { data: [{ employee_name: 'Jordan T.', pay_rate: 20, overtime_hours: 5 }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good', searchParams: { year: '2026', format: 'csv' } }) as never)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('qualified-overtime-2026.csv')
    const text = await res.text()
    expect(text.startsWith('{')).toBe(false)
    const lines = text.split('\n')
    expect(lines[0]).toBe('"Employee","OT Hours","Qualified Overtime Premium ($)"')
    expect(lines[1]).toBe('"Jordan T.","5","50.00"')
  })
})
