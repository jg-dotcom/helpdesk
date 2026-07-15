jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))
jest.mock('../../lib/googleCalendar', () => ({
  refreshAccessToken: jest.fn(),
  createCalendarEvent: jest.fn(),
}))
const sendMock = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { refreshAccessToken, createCalendarEvent } from '../../lib/googleCalendar'
import { PATCH, DELETE } from '../../app/api/applications/[id]/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('PATCH /api/applications/[id]', () => {
  beforeEach(() => sendMock.mockClear())

  it('returns 401 without a token', async () => {
    const res = await PATCH(mockRequest({ body: { status: 'hired' } }) as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid status', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'ghosted' } }) as never, params('1'))
    expect(res.status).toBe(400)
  })

  it('updates the application status', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'interviewing' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 400 when neither status nor interview_at is given', async () => {
    mockOwner({ id: 'owner-1' })
    const res = await PATCH(mockRequest({ token: 'good', body: {} }) as never, params('1'))
    expect(res.status).toBe(400)
  })

  it('clears an interview time without touching the calendar', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { interview_at: null } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.calendarSynced).toBe(false)
    expect(createCalendarEvent).not.toHaveBeenCalled()
  })

  it('saves an interview time when the owner has no Google Calendar connected', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null }, // candidate lookup
      { data: null, error: null }, // application update
      { data: null, error: null }, // no google_connections row
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { interview_at: '2026-07-20T14:00:00.000Z' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.calendarSynced).toBe(false)
    expect(createCalendarEvent).not.toHaveBeenCalled()
  })

  it('creates a calendar event when the owner has an active Google Calendar connection', async () => {
    mockOwner({ id: 'owner-1' })
    ;(createCalendarEvent as jest.Mock).mockResolvedValue({})
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null },
      { data: null, error: null },
      { data: { access_token: 'tok', refresh_token: 'rtok', access_token_expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { interview_at: '2026-07-20T14:00:00.000Z', jobTitle: 'Sales associate' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.calendarSynced).toBe(true)
    expect(createCalendarEvent).toHaveBeenCalledWith(
      'tok', 'Interview: Jamie Tran', 'Interview for Sales associate',
      '2026-07-20', '14:00:00', '14:30:00', 'America/New_York', ['jamie@example.com'],
    )
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('refreshes an expired Google token before creating the calendar event', async () => {
    mockOwner({ id: 'owner-1' })
    ;(refreshAccessToken as jest.Mock).mockResolvedValue({ access_token: 'new-tok', expires_in: 3600 })
    ;(createCalendarEvent as jest.Mock).mockResolvedValue({})
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null },
      { data: null, error: null },
      { data: { access_token: 'old-tok', refresh_token: 'rtok', access_token_expires_at: new Date(Date.now() - 1000).toISOString() }, error: null },
      { data: null, error: null }, // token refresh persisted
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { interview_at: '2026-07-20T14:00:00.000Z' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.calendarSynced).toBe(true)
    expect(refreshAccessToken).toHaveBeenCalledWith('rtok')
    expect(createCalendarEvent).toHaveBeenCalledWith(
      'new-tok', 'Interview: Jamie Tran', 'Interview',
      '2026-07-20', '14:00:00', '14:30:00', 'America/New_York', ['jamie@example.com'],
    )
  })

  it('still saves the interview time if the calendar sync throws', async () => {
    mockOwner({ id: 'owner-1' })
    ;(createCalendarEvent as jest.Mock).mockRejectedValue(new Error('Google API error'))
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null },
      { data: null, error: null },
      { data: { access_token: 'tok', refresh_token: 'rtok', access_token_expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { interview_at: '2026-07-20T14:00:00.000Z' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.calendarSynced).toBe(false)
  })

  it('does not send an email on a plain decline (no notify flag)', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'rejected' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.notified).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends a decline email when status=rejected and notify=true', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null }, // candidate lookup
      { data: null, error: null }, // application update
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'rejected', notify: true, jobTitle: 'Line Cook' } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.notified).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'jamie@example.com', subject: expect.stringContaining('Line Cook') })
  })

  it('still reports success if the decline email fails to send', async () => {
    mockOwner({ id: 'owner-1' })
    sendMock.mockRejectedValueOnce(new Error('resend down'))
    queueFromResponses(supabaseAdmin, [
      { data: { name: 'Jamie Tran', email: 'jamie@example.com' }, error: null },
      { data: null, error: null },
    ])
    const res = await PATCH(mockRequest({ token: 'good', body: { status: 'rejected', notify: true } }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.notified).toBe(false)
  })
})

describe('DELETE /api/applications/[id]', () => {
  it('returns 401 without a token', async () => {
    const res = await DELETE(mockRequest() as never, params('1'))
    expect(res.status).toBe(401)
  })

  it('deletes the application', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await DELETE(mockRequest({ token: 'good' }) as never, params('1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 500 when the delete fails', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: { message: 'delete failed' } }])
    const res = await DELETE(mockRequest({ token: 'good' }) as never, params('1'))
    expect(res.status).toBe(500)
  })
})
