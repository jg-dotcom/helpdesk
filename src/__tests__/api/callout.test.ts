jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/callout/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

describe('POST /api/callout', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 401 without a token', async () => {
    const res = await POST(mockRequest({ body: {} }) as never)
    expect(res.status).toBe(401)
  })

  it('marks the shift called_out AND opens it into the claim pool (is_open_shift=true, employee_id=null)', async () => {
    ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null })
    const updateMock = jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) })) }))
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') return { update: updateMock }
      if (table === 'employees') return { select: () => ({ eq: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [{ id: 1, name: 'Jordan Taylor', email: 'jordan@example.com' }] }) }) }) }) }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }
    })

    const res = await POST(mockRequest({
      token: 'good',
      body: { shiftId: 42, shiftDate: '2026-07-16', startTime: '09:00', endTime: '17:00', eligibleEmployeeIds: [1] },
    }) as never)

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ status: 'called_out', is_open_shift: true, employee_id: null })
  })

  it('email includes a "Claim this shift" link instead of "reply to this email"', async () => {
    ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null })
    const updateMock = jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) })) }))
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') return { update: updateMock }
      if (table === 'employees') return { select: () => ({ eq: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [{ id: 1, name: 'Jordan Taylor', email: 'jordan@example.com' }] }) }) }) }) }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }
    })

    await POST(mockRequest({
      token: 'good',
      body: { shiftId: 42, shiftDate: '2026-07-16', startTime: '09:00', endTime: '17:00', eligibleEmployeeIds: [1] },
    }) as never)

    expect(sendMock).toHaveBeenCalledTimes(1)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain('Claim this shift')
    expect(html).not.toContain('reply to this email')
    expect(html).toContain('/portal')
  })
})
