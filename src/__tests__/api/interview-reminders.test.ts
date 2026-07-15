jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/cron/interview-reminders/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

const OLD_ENV = process.env

describe('GET /api/cron/interview-reminders', () => {
  beforeEach(() => {
    sendMock.mockClear()
    process.env = { ...OLD_ENV }
  })
  afterAll(() => { process.env = OLD_ENV })

  it('returns 401 when CRON_SECRET is set but the request does not present it', async () => {
    process.env.CRON_SECRET = 'shh'
    const res = await GET(mockRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns 0 sent when no interviews fall in the 24-25h window', async () => {
    delete process.env.CRON_SECRET
    queueFromResponses(supabaseAdmin, [{ data: [], error: null }])
    const res = await GET(mockRequest() as never)
    const body = await res.json()
    expect(body.sent).toBe(0)
  })

  it('sends a reminder to both the candidate and the interviewer for an interview ~24h out', async () => {
    delete process.env.CRON_SECRET
    const interviewAt = new Date(Date.now() + 24.5 * 3600000).toISOString()
    queueFromResponses(supabaseAdmin, [
      { data: [{ id: 1, name: 'Taylor Reed', email: 'taylor@example.com', user_id: 'owner-1', job_posting_id: 5, interview_at: interviewAt }], error: null },
      { data: { title: 'Line Cook', location: 'Downtown' }, error: null },
      { data: { business_name: "Joe's Diner", contact_email: 'owner@example.com' }, error: null },
    ])
    const res = await GET(mockRequest() as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(2)
    const recipients = sendMock.mock.calls.map(c => c[0].to)
    expect(recipients).toContain('taylor@example.com')
    expect(recipients).toContain('owner@example.com')
  })
})
