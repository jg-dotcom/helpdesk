jest.mock('../../app/lib/supabaseAdmin', () => ({ supabaseAdmin: { auth: { getUser: jest.fn() }, from: jest.fn() } }))
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({})) }), { virtual: true })

import { supabaseAdmin } from '../../app/lib/supabaseAdmin'
import { executeTool } from '../../app/api/ai/chat/route'
import { queueFromResponses } from '../helpers/supabaseMock'

const role = {
  isOwner: true,
  isEmployee: false,
  businessName: 'Acme',
  employeeId: null,
  employeeName: null,
  ownerId: 'owner-1',
} as never

afterEach(() => {
  jest.resetAllMocks()
})

describe('AI assistant get_analytics_summary', () => {
  // JAY-92 — "Run Payroll" writes to payroll_run_items, not payroll_entries;
  // the summary must merge both ledgers or it disagrees with the Reports page.
  it('sums gross pay from both payroll_entries and payroll_run_items', async () => {
    queueFromResponses(supabaseAdmin, [
      { data: [{ gross_pay: 500 }], error: null }, // payroll_entries
      { data: [{ gross_pay: 1200 }], error: null }, // payroll_run_items
      { data: [{ total_minutes: 120 }], error: null }, // time_entries
      { data: [{ id: 1 }], error: null }, // employees
    ])
    const result = await executeTool('get_analytics_summary', {}, 'user-1', role, 'America/New_York')
    expect(result).toContain('$1,700 total payroll')
  })
})
