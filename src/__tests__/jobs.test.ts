import {
  formatPayRange,
  validateJobPosting,
  statusLabel,
  statusColor,
  formatLinkedInPost,
  formatIndeedPost,
  type JobPosting,
} from '../lib/jobs'

const baseJob: JobPosting = {
  id: 1,
  user_id: 'user-123',
  title: 'Cashier',
  department: 'Retail',
  location: 'New York, NY',
  employment_type: 'Full-time',
  description: 'Handle cash register and assist customers.',
  requirements: 'Must be 18+. Reliable transportation.',
  pay_min: 15,
  pay_max: 18,
  pay_period: 'hourly',
  status: 'open',
  created_at: '2024-01-01T00:00:00Z',
}

// ─── formatPayRange ───────────────────────────────────────────────────────────

describe('formatPayRange', () => {
  it('returns range when both min and max provided (hourly)', () => {
    expect(formatPayRange(15, 18, 'hourly')).toBe('$15 – $18/hr')
  })

  it('returns range when both min and max provided (yearly)', () => {
    expect(formatPayRange(40000, 55000, 'yearly')).toBe('$40,000 – $55,000/yr')
  })

  it('returns "From" when only min provided', () => {
    expect(formatPayRange(15, null, 'hourly')).toBe('From $15/hr')
  })

  it('returns "Up to" when only max provided', () => {
    expect(formatPayRange(null, 20, 'hourly')).toBe('Up to $20/hr')
  })

  it('returns placeholder when both null', () => {
    expect(formatPayRange(null, null, 'hourly')).toBe('Pay not specified')
  })
})

// ─── validateJobPosting ───────────────────────────────────────────────────────

describe('validateJobPosting', () => {
  it('returns no errors for a valid job', () => {
    expect(validateJobPosting(baseJob)).toHaveLength(0)
  })

  it('requires title', () => {
    const errors = validateJobPosting({ ...baseJob, title: '' })
    expect(errors).toContain('Title is required.')
  })

  it('requires employment type', () => {
    const errors = validateJobPosting({ ...baseJob, employment_type: '' })
    expect(errors).toContain('Employment type is required.')
  })

  it('rejects min pay greater than max pay', () => {
    const errors = validateJobPosting({ ...baseJob, pay_min: 30, pay_max: 20 })
    expect(errors).toContain('Minimum pay cannot exceed maximum pay.')
  })

  it('rejects negative pay', () => {
    const errors = validateJobPosting({ ...baseJob, pay_min: -5 })
    expect(errors).toContain('Pay cannot be negative.')
  })

  it('allows null pay values', () => {
    const errors = validateJobPosting({ ...baseJob, pay_min: null, pay_max: null })
    expect(errors).toHaveLength(0)
  })

  it('can return multiple errors', () => {
    const errors = validateJobPosting({ title: '', employment_type: '', pay_min: -1 })
    expect(errors.length).toBeGreaterThan(1)
  })
})

// ─── statusLabel / statusColor ────────────────────────────────────────────────

describe('statusLabel', () => {
  it('labels open correctly', () => expect(statusLabel('open')).toBe('Open'))
  it('labels closed correctly', () => expect(statusLabel('closed')).toBe('Closed'))
  it('labels draft correctly', () => expect(statusLabel('draft')).toBe('Draft'))
  it('falls back to raw value for unknown status', () => expect(statusLabel('archived')).toBe('archived'))
})

describe('statusColor', () => {
  it('is green for open', () => expect(statusColor('open')).toBe('#27ae60'))
  it('is red for closed', () => expect(statusColor('closed')).toBe('#c0392b'))
  it('is gray for draft', () => expect(statusColor('draft')).toBe('#9a9a9a'))
})

// ─── formatLinkedInPost ───────────────────────────────────────────────────────

describe('formatLinkedInPost', () => {
  const url = 'https://helpdesk.app/careers/user-123'

  it('includes job title', () => {
    expect(formatLinkedInPost(baseJob, url)).toContain('Cashier')
  })

  it('includes location', () => {
    expect(formatLinkedInPost(baseJob, url)).toContain('New York, NY')
  })

  it('includes careers URL', () => {
    expect(formatLinkedInPost(baseJob, url)).toContain(url)
  })

  it('includes pay range', () => {
    expect(formatLinkedInPost(baseJob, url)).toContain('$15')
  })

  it('omits location line when not set', () => {
    const post = formatLinkedInPost({ ...baseJob, location: null }, url)
    expect(post).not.toContain('in null')
  })
})

// ─── formatIndeedPost ─────────────────────────────────────────────────────────

describe('formatIndeedPost', () => {
  const url = 'https://helpdesk.app/careers/user-123'

  it('includes job title', () => {
    expect(formatIndeedPost(baseJob, url)).toContain('Cashier')
  })

  it('includes requirements', () => {
    expect(formatIndeedPost(baseJob, url)).toContain('Must be 18+')
  })

  it('includes careers URL', () => {
    expect(formatIndeedPost(baseJob, url)).toContain(url)
  })

  it('shows Remote when no location', () => {
    expect(formatIndeedPost({ ...baseJob, location: null }, url)).toContain('Remote')
  })
})
