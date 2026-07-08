const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

export { GOOGLE_AUTH_URL }

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  return res.json() as Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }>
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

async function googleRequest(method: string, path: string, accessToken: string, body?: object) {
  const res = await fetch(`${GOOGLE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text()}`)
  return res.json()
}

export function createCalendarEvent(
  accessToken: string,
  summary: string,
  description: string,
  dateStr: string, // YYYY-MM-DD
  startTime: string, // HH:MM:SS
  endTime: string,
  timeZone = 'America/New_York',
  attendeeEmails: string[] = [],
) {
  return googleRequest('POST', '/calendars/primary/events', accessToken, {
    summary,
    description,
    start: { dateTime: `${dateStr}T${startTime}`, timeZone },
    end: { dateTime: `${dateStr}T${endTime}`, timeZone },
    attendees: attendeeEmails.map(email => ({ email })),
    sendUpdates: attendeeEmails.length > 0 ? 'all' : 'none',
  })
}
