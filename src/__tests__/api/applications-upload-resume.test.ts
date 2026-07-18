// JAY-133 — public resume upload for the careers apply form. Uses the
// service role to write to the private 'resumes' bucket, so no storage RLS
// policy is required; this test exercises the route's own validation
// (posting lookup, extension, size) plus the happy path.
jest.mock('../../app/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/applications/upload-resume/route'
import { queueFromResponses } from '../helpers/supabaseMock'

function makeFile(name: string, sizeBytes: number, type = 'application/pdf'): File {
  const content = new Uint8Array(sizeBytes)
  return new File([content], name, { type })
}

function mockFormRequest(fields: Record<string, unknown>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v as string | Blob)
  }
  return { formData: async () => fd } as never
}

describe('POST /api/applications/upload-resume', () => {
  it('returns 400 when file or job_posting_id is missing', async () => {
    const res = await POST(mockFormRequest({ job_posting_id: '1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the job posting does not exist or is closed', async () => {
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockFormRequest({ file: makeFile('resume.pdf', 1000), job_posting_id: '1' }))
    expect(res.status).toBe(400)
  })

  it('rejects a disallowed file extension', async () => {
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, status: 'open' }, error: null }])
    const res = await POST(mockFormRequest({ file: makeFile('resume.exe', 1000), job_posting_id: '1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/PDF, DOC, or DOCX/i)
  })

  it('rejects a file over 10MB', async () => {
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, status: 'open' }, error: null }])
    const res = await POST(mockFormRequest({ file: makeFile('resume.pdf', 11 * 1024 * 1024), job_posting_id: '1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/over 10MB/i)
  })

  it('uploads a valid resume and returns its storage path', async () => {
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, status: 'open' }, error: null }])
    const uploadMock = jest.fn().mockResolvedValue({ error: null })
    ;(supabaseAdmin.storage.from as jest.Mock).mockReturnValue({ upload: uploadMock })

    const res = await POST(mockFormRequest({ file: makeFile('resume.pdf', 5000), job_posting_id: '1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fileName).toBe('resume.pdf')
    expect(body.path).toMatch(/^1\//)
    expect(uploadMock).toHaveBeenCalled()
  })

  it('returns 500 when the storage upload fails', async () => {
    queueFromResponses(supabaseAdmin, [{ data: { id: 1, status: 'open' }, error: null }])
    const uploadMock = jest.fn().mockResolvedValue({ error: { message: 'storage down' } })
    ;(supabaseAdmin.storage.from as jest.Mock).mockReturnValue({ upload: uploadMock })

    const res = await POST(mockFormRequest({ file: makeFile('resume.pdf', 5000), job_posting_id: '1' }))
    expect(res.status).toBe(500)
  })
})
