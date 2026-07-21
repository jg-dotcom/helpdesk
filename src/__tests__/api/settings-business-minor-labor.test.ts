jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/settings/business/route'
import { mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

// JAY-168 — minor-labor curfew/daily-hour settings are optional and must not
// be clobbered by unrelated saves (saveAccount/saveHours) that don't send them.
describe('POST /api/settings/business — minor_curfew_hour / minor_max_daily_hours', () => {
  it('writes both fields when provided', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', minor_curfew_hour: 22, minor_max_daily_hours: 8 } }) as never)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ minor_curfew_hour: 22, minor_max_daily_hours: 8 }),
      { onConflict: 'user_id' }
    )
  })

  it('does not touch either field when omitted (e.g. saveHours)', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', business_hours: {} } }) as never)
    expect(res.status).toBe(200)
    const payload = upsert.mock.calls[0][0]
    expect('minor_curfew_hour' in payload).toBe(false)
    expect('minor_max_daily_hours' in payload).toBe(false)
  })

  it('allows clearing both fields back to null', async () => {
    mockOwner({ id: 'owner-1' })
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert })

    const res = await POST(mockRequest({ token: 'good', body: { business_name: 'Acme', minor_curfew_hour: null, minor_max_daily_hours: null } }) as never)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ minor_curfew_hour: null, minor_max_daily_hours: null }),
      { onConflict: 'user_id' }
    )
  })
})
