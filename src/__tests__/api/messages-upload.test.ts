jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}))
jest.mock('../../app/lib/apiAuth', () => ({ getBearerUser: jest.fn() }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { getBearerUser } from '../../app/lib/apiAuth'
import { POST } from '../../app/api/messages/upload/route'
import { queueFromResponses } from '../helpers/supabaseMock'

function mockUploadRequest(opts: { token?: string; file?: File | null; businessId?: string }) {
  const form = new Map<string, unknown>()
  if (opts.file !== undefined) form.set('file', opts.file)
  if (opts.businessId !== undefined) form.set('businessId', opts.businessId)
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && opts.token ? `Bearer ${opts.token}` : null),
    },
    formData: async () => ({ get: (key: string) => form.get(key) ?? null }),
  }
}

function mockStorage(pathSeen: { path?: string }) {
  const upload = jest.fn((path: string) => {
    pathSeen.path = path
    return Promise.resolve({ error: null })
  })
  const getPublicUrl = jest.fn(() => ({ data: { publicUrl: 'https://example.com/file' } }))
  ;(supabaseAdmin.storage.from as jest.Mock) = jest.fn(() => ({ upload, getPublicUrl }))
}

// JAY-112 — the upload route must derive businessId server-side instead of
// trusting the client-supplied form field, which let a caller upload into
// another business's storage prefix.
describe('POST /api/messages/upload', () => {
  it('returns 401 without a token', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue(null)
    const res = await POST(mockUploadRequest({ file: new File(['x'], 'a.png') }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 with no file', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue({ id: 'user-5', email: 'jordan@example.com' })
    const res = await POST(mockUploadRequest({ token: 'good', file: null }) as never)
    expect(res.status).toBe(400)
  })

  it('stores the file under the caller-owner business prefix, ignoring a foreign client-supplied businessId', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue({ id: 'owner-1', email: 'owner@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: { user_id: 'owner-1' }, error: null }, // business_profiles — is the owner
    ])
    const pathSeen: { path?: string } = {}
    mockStorage(pathSeen)

    const res = await POST(mockUploadRequest({ token: 'good', file: new File(['x'], 'a.png'), businessId: 'someone-elses-biz' }) as never)
    expect(res.status).toBe(200)
    expect(pathSeen.path?.startsWith('owner-1/')).toBe(true)
  })

  it('stores an employee upload under their employer business prefix, ignoring a foreign client-supplied businessId', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue({ id: 'user-5', email: 'jordan@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // business_profiles — not an owner
      { data: { user_id: 'owner-9' }, error: null }, // employees record — real employer
    ])
    const pathSeen: { path?: string } = {}
    mockStorage(pathSeen)

    const res = await POST(mockUploadRequest({ token: 'good', file: new File(['x'], 'a.png'), businessId: 'someone-elses-biz' }) as never)
    expect(res.status).toBe(200)
    expect(pathSeen.path?.startsWith('owner-9/')).toBe(true)
  })

  it('returns 404 when the caller is neither an owner nor a known employee', async () => {
    ;(getBearerUser as jest.Mock).mockResolvedValue({ id: 'user-5', email: 'jordan@example.com' })
    queueFromResponses(supabaseAdmin, [
      { data: null, error: null }, // business_profiles — not an owner
      { data: null, error: null }, // employees — not found
    ])
    const res = await POST(mockUploadRequest({ token: 'good', file: new File(['x'], 'a.png') }) as never)
    expect(res.status).toBe(404)
  })
})
