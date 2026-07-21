import { aggregateQualifiedOvertime } from '../lib/qualifiedOvertime'

describe('aggregateQualifiedOvertime', () => {
  it('computes premium as hours * rate * 0.5, not full OT pay', () => {
    const summary = aggregateQualifiedOvertime([
      { employee_name: 'Jordan T.', pay_rate: 20, overtime_hours: 5 },
    ])
    // 5 hours * $20 * 0.5 = $50 (premium-only, not the $150 full OT pay)
    expect(summary.totalPremiumDollars).toBe(50)
    expect(summary.totalOtHours).toBe(5)
    expect(summary.employeeCount).toBe(1)
  })

  it('groups and sums multiple rows for the same employee', () => {
    const summary = aggregateQualifiedOvertime([
      { employee_name: 'Jordan T.', pay_rate: 20, overtime_hours: 5 },
      { employee_name: 'Jordan T.', pay_rate: 22, overtime_hours: 3 }, // mid-year raise, different run
      { employee_name: 'Sam R.', pay_rate: 18, overtime_hours: 2 },
    ])
    expect(summary.employeeCount).toBe(2)
    const jordan = summary.perEmployee.find(e => e.employeeName === 'Jordan T.')!
    expect(jordan.otHours).toBe(8)
    expect(jordan.premiumDollars).toBe(5 * 20 * 0.5 + 3 * 22 * 0.5) // 50 + 33 = 83
    const sam = summary.perEmployee.find(e => e.employeeName === 'Sam R.')!
    expect(sam.otHours).toBe(2)
    expect(sam.premiumDollars).toBe(18)
    expect(summary.totalOtHours).toBe(10)
    expect(summary.totalPremiumDollars).toBe(101)
  })

  it('rounds to two decimal places', () => {
    const summary = aggregateQualifiedOvertime([
      { employee_name: 'A', pay_rate: 19.335, overtime_hours: 1.3333 },
    ])
    expect(summary.perEmployee[0].premiumDollars).toBe(Math.round(19.335 * 1.3333 * 0.5 * 100) / 100)
  })

  it('returns an empty summary for no rows', () => {
    const summary = aggregateQualifiedOvertime([])
    expect(summary).toEqual({ totalOtHours: 0, totalPremiumDollars: 0, employeeCount: 0, perEmployee: [] })
  })

  it('sorts per-employee rows by premium dollars descending', () => {
    const summary = aggregateQualifiedOvertime([
      { employee_name: 'Low', pay_rate: 10, overtime_hours: 1 },
      { employee_name: 'High', pay_rate: 50, overtime_hours: 4 },
    ])
    expect(summary.perEmployee.map(e => e.employeeName)).toEqual(['High', 'Low'])
  })
})
