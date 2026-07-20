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
