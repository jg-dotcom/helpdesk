// Pure shift scheduling utilities — used by /time page and tested in __tests__/shifts.test.ts

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export type DayHours = { open: string; close: string; closed: boolean }
export type BusinessHours = Record<DayKey, DayHours>

/**
 * Generate ISO date strings for a recurring shift.
 * @param startDate  ISO date string for the first occurrence (e.g. '2026-07-07')
 * @param weeks      Total number of occurrences (1 = just the start date)
 */
export function generateRecurringDates(startDate: string, weeks: number): string[] {
  const base = new Date(startDate + 'T00:00:00')
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

/**
 * Clamp a shift's start/end times to business hours.
 * Returns null if the clamped shift would be zero-length or negative.
 */
export function clampToBusinessHours(
  start: string,
  end: string,
  hours: DayHours,
): { start: string; end: string } | null {
  if (hours.closed) return null
  const clampedStart = start < hours.open ? hours.open : start
  const clampedEnd = end > hours.close ? hours.close : end
  if (clampedStart >= clampedEnd) return null
  return { start: clampedStart, end: clampedEnd }
}

/**
 * Calculate scheduled hours for a shift given start and end time strings (HH:MM).
 */
export function shiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60
}

/**
 * Return the DayKey for a given ISO date string.
 */
export function dayKeyFromDate(isoDate: string): DayKey {
  return DAY_KEYS[new Date(isoDate + 'T00:00:00').getDay()]
}

/**
 * Filter shifts to only unclaimed open shifts.
 */
export function openShifts<T extends { is_open_shift?: boolean; employee_id: number | null }>(
  shifts: T[],
): T[] {
  return shifts.filter(s => s.is_open_shift && s.employee_id == null)
}

/**
 * Filter unclaimed open shifts that are past a given date (overdue).
 */
export function overdueOpenShifts<T extends { is_open_shift?: boolean; employee_id: number | null; shift_date: string }>(
  shifts: T[],
  today: string,
): T[] {
  return openShifts(shifts).filter(s => s.shift_date < today)
}

/**
 * Filter shifts still assigned to an employee (not open) on or after a given date —
 * used to warn before terminating someone with future shifts still on the schedule.
 */
export function upcomingAssignedShifts<T extends { is_open_shift?: boolean; employee_id: number | null; shift_date: string }>(
  shifts: T[],
  today: string,
): T[] {
  return shifts.filter(s => !s.is_open_shift && s.employee_id != null && s.shift_date >= today)
}

/**
 * Format a "HH:MM" or "HH:MM:SS" time string for display, ignoring anything
 * past minutes (so "17:00" and "17:00:00" render identically).
 */
export function fmtTimeDisplay(t: string): string {
  const [h, m] = t.split(':'); const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`
}

/**
 * JAY-165: an out-of-hours flagged shift can be a false positive when the
 * flag comes from a precision mismatch (e.g. "17:00" vs "17:00:00") rather
 * than an actual time difference — the raw string comparison in the caller
 * flags it, but the displayed (fmtTimeDisplay-formatted) values are
 * identical. Suppress those from the warning banner rather than showing a
 * range next to an identical-looking "outside" range. Only suppresses when
 * every flagged boundary is display-identical; a shift genuinely outside
 * hours on either side still renders.
 */
export function shouldSuppressOutOfHoursEntry(
  shift: { start_time: string; end_time: string },
  dayHours: DayHours,
): boolean {
  if (dayHours.closed) return false
  const startFlagged = shift.start_time < dayHours.open
  const endFlagged = shift.end_time > dayHours.close
  if (startFlagged && fmtTimeDisplay(shift.start_time) !== fmtTimeDisplay(dayHours.open)) return false
  if (endFlagged && fmtTimeDisplay(shift.end_time) !== fmtTimeDisplay(dayHours.close)) return false
  return true
}

/**
 * JAY-166 — split each of an employee's shifts for a week into regular vs.
 * overtime hours, walking shifts in chronological order (by shift_date, then
 * start_time for same-day shifts — the schedule page deals in individual
 * shifts rather than payroll's aggregated daily hours, so ordering same-day
 * shifts by start_time is the more defensible convention here) and crossing
 * into OT only once the running weekly total exceeds 40h. Mirrors the
 * chronological-walk convention already used by payroll/run/route.ts (JAY-57),
 * just applied per-shift instead of per-day.
 */
export type ShiftForOvertime = { employee_id: number | null; shift_date: string; start_time: string; end_time: string }

export function splitWeeklyOvertime<S extends ShiftForOvertime>(
  shifts: S[],
  employeeId: number,
): Map<S, { regHrs: number; otHrs: number }> {
  const result = new Map<S, { regHrs: number; otHrs: number }>()
  const empShifts = shifts
    .filter(s => s.employee_id === employeeId)
    .sort((a, b) => (a.shift_date === b.shift_date
      ? a.start_time.localeCompare(b.start_time)
      : a.shift_date.localeCompare(b.shift_date)))
  let running = 0
  for (const s of empShifts) {
    const hrs = shiftHours(s.start_time, s.end_time)
    const after = running + hrs
    const otHrs = after > 40 ? Math.min(hrs, after - 40) : 0
    result.set(s, { regHrs: hrs - otHrs, otHrs })
    running = after
  }
  return result
}

/**
 * JAY-166 — per-shift labor cost given its regular/overtime hour split.
 * Salary employees use the existing implied-hourly convention (annual / 52 /
 * 40) and are never OT-split (no premium applied even if `otHrs` is nonzero),
 * matching payroll's `pay_type === 'salary'` branch.
 */
export type EmployeeForLaborCost = { pay_type: string; pay_rate: number | null }

export function shiftLaborCost(
  regHrs: number,
  otHrs: number,
  emp: EmployeeForLaborCost | undefined | null,
): number | null {
  if (!emp?.pay_rate) return null
  if (emp.pay_type === 'salary') return (emp.pay_rate / 52 / 40) * (regHrs + otHrs)
  return regHrs * emp.pay_rate + otHrs * emp.pay_rate * 1.5
}

/**
 * JAY-168 — age (in whole years) an employee will be on a given date, from
 * their date of birth. Standard "has the birthday happened yet this year"
 * calculation, so a birthday falling exactly on `onDate` already counts.
 */
export function employeeAgeOnDate(dateOfBirth: string, onDate: string): number {
  const dob = new Date(dateOfBirth + 'T00:00:00')
  const on = new Date(onDate + 'T00:00:00')
  let age = on.getFullYear() - dob.getFullYear()
  const monthDiff = on.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < dob.getDate())) age--
  return age
}

/**
 * JAY-168 — minor-labor compliance check for a single shift: whether it runs
 * past a configured curfew hour, and/or whether the employee's total hours
 * across all their shifts that day exceed a configured daily max. Both
 * checks are flag-only (no hard block, matching the ticket's conservative
 * scope) and only apply to employees under 18 as of the shift date — the age
 * threshold itself is the legal standard and isn't a configurable setting.
 * Returns null when the employee isn't a minor, has no DOB on file, or both
 * settings are unset (feature off).
 */
export function isMinorLaborViolation(
  shift: { shift_date: string; start_time: string; end_time: string },
  dateOfBirth: string | null,
  config: { curfewHour: number | null; maxDailyHours: number | null },
  allDayShiftsForEmployee: { start_time: string; end_time: string }[],
): { curfew: boolean; overDailyMax: boolean } | null {
  if (!dateOfBirth) return null
  if (config.curfewHour == null && config.maxDailyHours == null) return null
  if (employeeAgeOnDate(dateOfBirth, shift.shift_date) >= 18) return null

  const curfew = config.curfewHour != null && parseInt(shift.end_time.slice(0, 2)) >= config.curfewHour
  const totalHours = allDayShiftsForEmployee.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0)
  const overDailyMax = config.maxDailyHours != null && totalHours > config.maxDailyHours

  if (!curfew && !overDailyMax) return null
  return { curfew, overDailyMax }
}

/**
 * A shift is a "no-show" when its scheduled end has already passed, it wasn't
 * marked as a callout, and no matching clock-in exists for that employee on
 * that date. Read-time classification only — nothing is persisted, so a wrong
 * call is just a wrong badge, not a bad write.
 */
export function isNoShowShift<
  S extends { status?: string; is_open_shift?: boolean; employee_id: number | null; shift_date: string; end_time: string },
  E extends { employee_id: number; clock_in: string },
>(shift: S, entries: E[], now: Date): boolean {
  if (shift.status === 'called_out' || shift.is_open_shift || shift.employee_id == null) return false
  const shiftEnd = new Date(`${shift.shift_date}T${shift.end_time}`)
  if (shiftEnd >= now) return false
  return !entries.some(e => e.employee_id === shift.employee_id && e.clock_in.slice(0, 10) === shift.shift_date)
}
