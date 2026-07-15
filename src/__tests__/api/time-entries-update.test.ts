jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { PATCH } from '../../app/api/time-entries/[id]/route'
import { mockAuthUser, queueFromResponses, mockRequest } from '../helpers/supabaseMock'

// JAY-32 — owner-side edit of a time entry, scoped to the optional
// break_minutes deduction (plus clock_in/clock_out correction). total_minutes
// is recalculated here so payroll/reporting, which reads total_minutes
// directly, picks up the deduction automatically.
describe('PATCH /api/time-entries/[id]', () => {
  const params = Promise.resolve({ id: '55' })

  it('returns 401 when unauthenticated', async () => {
    mockAuthUser(supabaseAdmin, null)
    const res = await PATCH(mockRequest({}) as never, { params })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the entry does not belong to the caller', async () => {
    mockAuthUser(supabaseAdmin, { email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { break_minutes: 30 } }) as never, { params })
    expect(res.status).toBe(404)
  })

  it('deducts break_minutes from total_minutes on update', async () => {
    mockAuthUser(supabaseAdmin, { email: 'owner@example.com' })
    const clockIn = '2026-07-14T09:00:00.000Z'
    const clockOut = '2026-07-14T17:00:00.000Z' // 8 hours = 480 minutes
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 55, clock_in: clockIn, clock_out: clockOut, break_minutes: 0 }, error: null },
      { data: { id: 55, clock_in: clockIn, clock_out: clockOut, break_minutes: 30, total_minutes: 450 }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { break_minutes: 30 } }) as never, { params })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entry.total_minutes).toBe(450)

    const updateBuilder = fromMock.mock.results[1].value
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ break_minutes: 30, total_minutes: 450 })
    )
  })

  it('rejects a negative break_minutes value', async () => {
    mockAuthUser(supabaseAdmin, { email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { id: 55, clock_in: '2026-07-14T09:00:00.000Z', clock_out: '2026-07-14T17:00:00.000Z', break_minutes: 0 }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { break_minutes: -5 } }) as never, { params })
    expect(res.status).toBe(400)
  })

  it('leaves break_minutes unchanged and recomputes total_minutes when only clock_out is edited', async () => {
    mockAuthUser(supabaseAdmin, { email: 'owner@example.com' })
    const clockIn = '2026-07-14T09:00:00.000Z'
    const fromMock = queueFromResponses(supabaseAdmin, [
      { data: { id: 55, clock_in: clockIn, clock_out: '2026-07-14T17:00:00.000Z', break_minutes: 30 }, error: null },
      { data: { id: 55, clock_in: clockIn, clock_out: '2026-07-14T16:00:00.000Z', break_minutes: 30, total_minutes: 390 }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { clock_out: '2026-07-14T16:00:00.000Z' } }) as never, { params })
    expect(res.status).toBe(200)
    const updateBuilder = fromMock.mock.results[1].value
    // 09:00 -> 16:00 = 420 minutes, minus the existing 30-minute break = 390
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ break_minutes: 30, total_minutes: 390 })
    )
  })
})
