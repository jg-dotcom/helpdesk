import { computeAccruedPtoDays, nextAccrualDate } from '../app/lib/ptoAccrual'

describe('computeAccruedPtoDays', () => {
  it('returns the flat annual total when method is flat', () => {
    const total = computeAccruedPtoDays({ method: 'flat', rate: 1.25 }, 15, '2020-01-01', new Date('2026-07-18'))
    expect(total).toBe(15)
  })

  it('returns the flat annual total when method/rate are unset (default, backward-compatible)', () => {
    const total = computeAccruedPtoDays({ method: undefined, rate: undefined }, 15, '2020-01-01', new Date('2026-07-18'))
    expect(total).toBe(15)
  })

  it('returns the flat annual total when hire date is missing, even on a monthly policy', () => {
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1.25 }, 15, null, new Date('2026-07-18'))
    expect(total).toBe(15)
  })

  it('prorates from Jan 1 for an employee hired in a prior year, capped at rate * 12', () => {
    // Hired well before this year — by July (7th month), should have accrued
    // 7 months' worth, capped at 15 (rate*12 = 1.25*12 = 15).
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1.25 }, 15, '2020-03-01', new Date('2026-07-18'))
    expect(total).toBe(8.75) // 1.25 * 7 (Jan..Jul inclusive)
  })

  it('prorates from hire date for an employee hired mid-year', () => {
    // Hired March 15 2026 — March counts as month 1, so by July (5 months: Mar-Jul).
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1.25 }, 15, '2026-03-15', new Date('2026-07-18'))
    expect(total).toBe(6.25) // 1.25 * 5
  })

  it('returns 0 for an employee hired after the reference date', () => {
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1.25 }, 15, '2026-12-01', new Date('2026-07-18'))
    expect(total).toBe(0)
  })

  it('never exceeds rate * 12 even if annualDays is set higher', () => {
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1 }, 20, '2019-01-01', new Date('2026-12-31'))
    expect(total).toBe(12)
  })

  it('treats an invalid hire date string as missing (falls back to flat)', () => {
    const total = computeAccruedPtoDays({ method: 'monthly', rate: 1.25 }, 15, 'not-a-date', new Date('2026-07-18'))
    expect(total).toBe(15)
  })
})

describe('nextAccrualDate', () => {
  it('returns null for a flat policy', () => {
    expect(nextAccrualDate({ method: 'flat', rate: 1.25 }, new Date('2026-07-18'))).toBeNull()
  })

  it('returns the 1st of next month for a monthly policy', () => {
    expect(nextAccrualDate({ method: 'monthly', rate: 1.25 }, new Date('2026-07-18'))).toBe('2026-08-01')
  })

  it('rolls over to next year in December', () => {
    expect(nextAccrualDate({ method: 'monthly', rate: 1.25 }, new Date('2026-12-15'))).toBe('2027-01-01')
  })
})
