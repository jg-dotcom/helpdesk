jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: {}, from: jest.fn() } }))

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { POST } from '../../app/api/sign/[token]/submit-form/route'
import { queueFromResponses, mockRequest } from '../helpers/supabaseMock'
import { decryptField } from '../../app/lib/fieldEncryption'

function params() {
  return { params: Promise.resolve({ token: 'tok-1' }) }
}

describe('POST /api/sign/[token]/submit-form', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await POST(mockRequest({ body: { formType: 'i9' } }) as never, params())
    expect(res.status).toBe(400)
  })

  it('returns 404 for an invalid token', async () => {
    queueFromResponses(supabaseAdmin, [{ data: null, error: null }])
    const res = await POST(mockRequest({ body: { formType: 'i9', formData: { a: '1' }, employeeId: 1, userId: 'owner-1' } }) as never, params())
    expect(res.status).toBe(404)
  })

  // JAY-63 — bank routing/account numbers must never reach the database as
  // plaintext. This is the core regression test for the fix.
  it('encrypts routingNumber and accountNumber before inserting, stores only last4 unencrypted', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: { employee_id: 1, user_id: 'owner-1' }, error: null }, // onboarding_links lookup
      { data: null, error: null }, // employee_forms — no existing row (new submission)
      { data: null, error: null }, // employee_forms insert
      { data: null, error: null }, // employees update — direct_deposit_status
      { data: { name: 'Jordan T.' }, error: null }, // employees select name
      { data: null, error: null }, // notifications insert
    ])
    const res = await POST(mockRequest({
      body: {
        formType: 'direct_deposit',
        formData: {
          bankName: 'Chase',
          accountType: 'checking',
          routingNumber: '021000021',
          accountNumber: '123456789',
          confirmAccountNumber: '123456789',
        },
        employeeId: 1,
        userId: 'owner-1',
      },
    }) as never, params())
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const insertCall = fromMock.mock.results[2].value // 3rd .from() call = employee_forms insert
    const insertedRows = insertCall.insert.mock.calls[0][0]
    const formData = insertedRows[0].form_data

    // No plaintext routing/account numbers anywhere in what got stored.
    expect(formData.routingNumber).toBeUndefined()
    expect(formData.accountNumber).toBeUndefined()
    expect(formData.confirmAccountNumber).toBeUndefined()

    // Only last-4 is stored unencrypted.
    expect(formData.routingNumber_last4).toBe('0021')
    expect(formData.accountNumber_last4).toBe('6789')

    // The encrypted blobs decrypt back to the real values (proves it's
    // actually encrypted, not just renamed).
    expect(decryptField(formData.routingNumber_encrypted)).toBe('021000021')
    expect(decryptField(formData.accountNumber_encrypted)).toBe('123456789')

    // Non-sensitive fields pass through untouched.
    expect(formData.bankName).toBe('Chase')
    expect(formData.accountType).toBe('checking')
  })

  // JAY-65 — server-side re-validation: the client check can't be trusted
  // alone, so a 9-digit number that fails the ABA checksum must be rejected
  // here too, before ever reaching encryption/persistence.
  it('rejects a 9-digit routing number that fails the ABA checksum', async () => {
    const fromMock = queueFromResponses(supabaseAdmin, [])
    const res = await POST(mockRequest({
      body: {
        formType: 'direct_deposit',
        formData: {
          bankName: 'Chase',
          accountType: 'checking',
          routingNumber: '021000029', // one digit off from the valid 021000021
          accountNumber: '123456789',
        },
        employeeId: 1,
        userId: 'owner-1',
      },
    }) as never, params())
    expect(res.status).toBe(400)
    // No supabase calls should have happened — rejected before any lookup/insert.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('does not touch form_data for non-direct_deposit form types', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: { employee_id: 1, user_id: 'owner-1' }, error: null },
      { data: { id: 5 }, error: null }, // existing row — update path
      { data: null, error: null }, // employee_forms update
      { data: null, error: null }, // employees update — i9_status
      { data: { name: 'Jordan T.' }, error: null },
      { data: null, error: null },
    ])
    const res = await POST(mockRequest({
      body: { formType: 'i9', formData: { citizenship: 'US Citizen' }, employeeId: 1, userId: 'owner-1' },
    }) as never, params())
    expect(res.status).toBe(200)

    const fromMock = supabaseAdmin.from as jest.Mock
    const updateCall = fromMock.mock.results[2].value
    const updatedData = updateCall.update.mock.calls[0][0].form_data
    expect(updatedData).toEqual({ citizenship: 'US Citizen' })
  })
})
