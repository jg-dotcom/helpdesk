// JAY-123 — PTO balance previously had no accrual model: every employee's
// total was a flat `employees.pto_days_per_year`, regardless of hire date or
// how far into the year we are. This adds an optional monthly-accrual mode,
// business-configurable in Settings, while defaulting to the old flat
// behavior so existing accounts see no change unless they opt in.
//
// Deliberately NOT implemented here: true year-end rollover (carrying unused
// days from a prior year into the next). That needs a year-end snapshot job
// to know what "last year's balance" actually was, which doesn't exist yet.
// `pto_rollover_cap` is stored now so that job has somewhere to write to
// later, but it has no effect on the number this function returns today.

export type PtoAccrualMethod = 'flat' | 'monthly'

export interface PtoAccrualPolicy {
  method: PtoAccrualMethod | null | undefined
  rate: number | null | undefined // days accrued per month, only used when method === 'monthly'
}

/**
 * Total PTO days an employee has earned so far this year.
 *
 * - method 'flat' (or unset/unrecognized): returns `annualDays` unchanged —
 *   the pre-JAY-123 behavior.
 * - method 'monthly': prorates from the later of Jan 1 or the employee's
 *   hire date (`startDate`), accruing `rate` days per elapsed calendar month
 *   (the hire month itself counts as accrued), capped at `rate * 12` so it
 *   never exceeds a full year's worth even if `annualDays` and `rate * 12`
 *   disagree.
 */
export function computeAccruedPtoDays(
  policy: PtoAccrualPolicy,
  annualDays: number,
  startDate: string | null | undefined,
  now: Date = new Date(),
): number {
  if (policy.method !== 'monthly' || !policy.rate || policy.rate <= 0 || !startDate) {
    return annualDays
  }

  const start = new Date(startDate)
  if (isNaN(start.getTime())) return annualDays

  const yearStart = new Date(now.getFullYear(), 0, 1)
  const effectiveStart = start > yearStart ? start : yearStart
  if (effectiveStart > now) return 0

  const monthsAccrued = Math.min(
    12,
    (now.getFullYear() - effectiveStart.getFullYear()) * 12 + (now.getMonth() - effectiveStart.getMonth()) + 1,
  )

  const accrued = policy.rate * monthsAccrued
  return Math.round(Math.min(accrued, policy.rate * 12) * 100) / 100
}

/** The date the next monthly accrual will land, or null if not on a monthly policy. */
export function nextAccrualDate(policy: PtoAccrualPolicy, now: Date = new Date()): string | null {
  if (policy.method !== 'monthly' || !policy.rate || policy.rate <= 0) return null
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return next.toISOString().slice(0, 10)
}
