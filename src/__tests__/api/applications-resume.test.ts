// JAY-133 — authenticated, ownership-checked signed-URL generation for a
// candidate's resume in the private 'resumes' bucket.
jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { GET } from '../../app/api/applications/[id]/resume/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'

function mockOwner(user: { id: string } | null) {
  ;(supabaseAdmin.auth.getUser as jest.Mock).mockResolvedValue({ data: { user } })
}

describe('GET /api/applications/[id]/resume', () => {
  it('returns 401 without a token', async () => {
    const res = await GET(mockRequest() as never, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the application does not belong to the caller', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when the application has no resume on file', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: { resume_path: null }, error: null }])
    const res = await GET(mockRequest({ token: 'good' }) as never, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(404)
  })

  it('returns a signed URL when the resume exists and the caller owns the application', async () => {
    mockOwner({ id: 'owner-1' })
    queueFromResponses(supabaseAdmin, [{ data: { resume_path: '1/abc.pdf' }, error: null }])
    const createSignedUrlMock = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/abc.pdf' }, error: null })
    ;(supabaseAdmin.storage.from as jest.Mock).mockReturnValue({ createSignedUrl: createSignedUrlMock })

    const res = await GET(mockRequest({ token: 'good' }) as never, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://signed.example/abc.pdf')
    expect(createSignedUrlMock).toHaveBeenCalledWith('1/abc.pdf', 60)
  })
})
