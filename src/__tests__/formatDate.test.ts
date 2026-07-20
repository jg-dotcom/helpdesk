import { formatDate } from '../lib/formatDate'

describe('formatDate', () => {
  it('formats the "short" style', () => {
    expect(formatDate('2026-07-19', 'short')).toBe('Jul 19, 2026')
  })

  it('formats the "shortNoYear" style', () => {
    expect(formatDate('2026-07-19', 'shortNoYear')).toBe('Jul 19')
  })

  it('formats the "weekdayShort" style', () => {
    expect(formatDate('2026-07-19', 'weekdayShort')).toBe('Sunday, Jul 19')
  })

  it('formats the "longFull" style', () => {
    expect(formatDate('2026-07-19', 'longFull')).toBe('July 19, 2026')
  })

  it('treats a date-only string and its midnight-appended equivalent the same', () => {
    expect(formatDate('2026-07-19', 'short')).toBe(formatDate('2026-07-19T00:00:00', 'short'))
  })

  it('parses a full ISO timestamp as-is without shifting the calendar date', () => {
    expect(formatDate('2026-07-19T15:30:00.000Z', 'short')).toBe(
      new Date('2026-07-19T15:30:00.000Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    )
  })

  it('avoids the UTC off-by-one-day shift for date-only strings', () => {
    // Without the T00:00:00 append, `new Date('2026-07-19')` parses as UTC
    // midnight, which renders as Jul 18 in negative-UTC-offset timezones.
    expect(formatDate('2026-07-19', 'short')).toBe('Jul 19, 2026')
  })
})
