jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/settings/export/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('GET /api/settings/export', () => {
  it('returns 401 without a Bearer token', async () => {
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('ignores a token passed via query string — only the Authorization header counts', async () => {
    const res = await GET(mockRequest({ searchParams: { token: 'good' } }) as never)
    expect(res.status).toBe(401)
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled()
  })

  it('exports the caller\'s data as a JSON download', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, name: 'Jane' }], error: null },
      { data: [{ id: 2, gross_pay: 500 }], error: null },
      { data: [{ id: 3, start: '2026-01-01' }], error: null },
      { data: [{ id: 4, pay_period: '2026-01' }], error: null },
      { data: [{ id: 5, gross_pay: 600 }], error: null },
      { data: [{ id: 6, status: 'approved' }], error: null },
      { data: [{ id: 7, clock_in: '2026-01-01T09:00:00Z' }], error: null },
    ])
    const res = await GET(mockRequest({ token: 'good' }) as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const body = JSON.parse(await res.text())
    expect(body.employees).toEqual([{ id: 1, name: 'Jane' }])
    expect(body.payroll_entries).toEqual([{ id: 2, gross_pay: 500 }])
    expect(body.shifts).toEqual([{ id: 3, start: '2026-01-01' }])
    expect(body.payroll_runs).toEqual([{ id: 4, pay_period: '2026-01' }])
    expect(body.payroll_run_items).toEqual([{ id: 5, gross_pay: 600 }])
    expect(body.time_off_requests).toEqual([{ id: 6, status: 'approved' }])
    expect(body.time_entries).toEqual([{ id: 7, clock_in: '2026-01-01T09:00:00Z' }])
  })
})
