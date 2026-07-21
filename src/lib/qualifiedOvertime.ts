// JAY-171 — OBBBA ("One Big Beautiful Bill Act") added a federal tax
// deduction for the overtime *premium* (the 0.5x portion of time-and-a-half,
// not the full 1.5x pay). Payroll already computes and stores overtime_hours
// + the pay_rate in effect at run time on payroll_run_items, but nothing
// aggregates that into the premium-only figure employers need for filing.
export type QualifiedOvertimeRow = {
  employee_name: string
  pay_rate: number
  overtime_hours: number
}

export type QualifiedOvertimePerEmployee = {
  employeeName: string
  otHours: number
  premiumDollars: number
}

export type QualifiedOvertimeSummary = {
  totalOtHours: number
  totalPremiumDollars: number
  employeeCount: number
  perEmployee: QualifiedOvertimePerEmployee[]
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function aggregateQualifiedOvertime(rows: QualifiedOvertimeRow[]): QualifiedOvertimeSummary {
  const byEmployee = new Map<string, { otHours: number; premiumDollars: number }>()

  for (const row of rows) {
    const premium = row.overtime_hours * row.pay_rate * 0.5
    const existing = byEmployee.get(row.employee_name) ?? { otHours: 0, premiumDollars: 0 }
    existing.otHours += row.overtime_hours
    existing.premiumDollars += premium
    byEmployee.set(row.employee_name, existing)
  }

  const perEmployee = Array.from(byEmployee.entries())
    .map(([employeeName, v]) => ({ employeeName, otHours: round2(v.otHours), premiumDollars: round2(v.premiumDollars) }))
    .sort((a, b) => b.premiumDollars - a.premiumDollars)

  return {
    totalOtHours: round2(perEmployee.reduce((s, e) => s + e.otHours, 0)),
    totalPremiumDollars: round2(perEmployee.reduce((s, e) => s + e.premiumDollars, 0)),
    employeeCount: perEmployee.length,
    perEmployee,
  }
}
