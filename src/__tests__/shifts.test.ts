import {
  generateRecurringDates,
  clampToBusinessHours,
  shiftHours,
  dayKeyFromDate,
  openShifts,
  overdueOpenShifts,
  upcomingAssignedShifts,
  isNoShowShift,
  shouldSuppressOutOfHoursEntry,
  splitWeeklyOvertime,
  shiftLaborCost,
  employeeAgeOnDate,
  isMinorLaborViolation,
  type DayHours,
} from '../lib/shifts'

// ─── generateRecurringDates ───────────────────────────────────────────────────

describe('generateRecurringDates', () => {
  it('returns a single date when weeks = 1', () => {
    expect(generateRecurringDates('2026-07-07', 1)).toEqual(['2026-07-07'])
  })

  it('returns dates 7 days apart', () => {
    const dates = generateRecurringDates('2026-07-07', 3)
    expect(dates).toEqual(['2026-07-07', '2026-07-14', '2026-07-21'])
  })

  it('returns correct count of dates', () => {
    expect(generateRecurringDates('2026-07-07', 12)).toHaveLength(12)
  })

  it('handles month boundary correctly', () => {
    const dates = generateRecurringDates('2026-07-28', 2)
    expect(dates[1]).toBe('2026-08-04')
  })

  it('handles year boundary correctly', () => {
    const dates = generateRecurringDates('2026-12-28', 2)
    expect(dates[1]).toBe('2027-01-04')
  })
})

// ─── clampToBusinessHours ─────────────────────────────────────────────────────

describe('clampToBusinessHours', () => {
  const hours: DayHours = { open: '09:00', close: '17:00', closed: false }

  it('returns original times when within business hours', () => {
    expect(clampToBusinessHours('10:00', '16:00', hours)).toEqual({ start: '10:00', end: '16:00' })
  })

  it('clamps start time up to open', () => {
    expect(clampToBusinessHours('07:00', '16:00', hours)).toEqual({ start: '09:00', end: '16:00' })
  })

  it('clamps end time down to close', () => {
    expect(clampToBusinessHours('10:00', '20:00', hours)).toEqual({ start: '10:00', end: '17:00' })
  })

  it('clamps both start and end', () => {
    expect(clampToBusinessHours('06:00', '22:00', hours)).toEqual({ start: '09:00', end: '17:00' })
  })

  it('returns null when shift falls entirely outside hours', () => {
    expect(clampToBusinessHours('18:00', '20:00', hours)).toBeNull()
  })

  it('returns null for a closed day', () => {
    const closed: DayHours = { open: '09:00', close: '17:00', closed: true }
    expect(clampToBusinessHours('09:00', '17:00', closed)).toBeNull()
  })

  it('returns null when clamped start equals clamped end', () => {
    expect(clampToBusinessHours('17:00', '18:00', hours)).toBeNull()
  })
})

// ─── shiftHours ───────────────────────────────────────────────────────────────

describe('shiftHours', () => {
  it('calculates 8h shift correctly', () => {
    expect(shiftHours('09:00', '17:00')).toBe(8)
  })

  it('calculates half-hour increment correctly', () => {
    expect(shiftHours('09:00', '13:30')).toBe(4.5)
  })

  it('returns 0 for same start and end', () => {
    expect(shiftHours('09:00', '09:00')).toBe(0)
  })

  it('handles early morning shift', () => {
    expect(shiftHours('06:00', '14:00')).toBe(8)
  })
})

// ─── dayKeyFromDate ───────────────────────────────────────────────────────────

describe('dayKeyFromDate', () => {
  it('returns sun for a Sunday', () => {
    expect(dayKeyFromDate('2026-07-05')).toBe('sun')  // July 5 2026 is a Sunday
  })

  it('returns mon for a Monday', () => {
    expect(dayKeyFromDate('2026-07-06')).toBe('mon')
  })

  it('returns sat for a Saturday', () => {
    expect(dayKeyFromDate('2026-07-11')).toBe('sat')
  })
})

// ─── openShifts ───────────────────────────────────────────────────────────────

describe('openShifts', () => {
  const shifts = [
    { id: 1, shift_date: '2026-07-10', employee_id: 5, is_open_shift: false },
    { id: 2, shift_date: '2026-07-11', employee_id: null, is_open_shift: true },
    { id: 3, shift_date: '2026-07-12', employee_id: null, is_open_shift: true },
    { id: 4, shift_date: '2026-07-13', employee_id: 3, is_open_shift: false },
  ]

  it('returns only unclaimed open shifts', () => {
    const result = openShifts(shifts)
    expect(result.map(s => s.id)).toEqual([2, 3])
  })

  it('returns empty array when no open shifts', () => {
    const assigned = shifts.filter(s => s.employee_id != null)
    expect(openShifts(assigned)).toHaveLength(0)
  })
})

// ─── overdueOpenShifts ────────────────────────────────────────────────────────

describe('overdueOpenShifts', () => {
  const shifts = [
    { id: 1, shift_date: '2026-06-01', employee_id: null, is_open_shift: true },  // past
    { id: 2, shift_date: '2026-07-05', employee_id: null, is_open_shift: true },  // today
    { id: 3, shift_date: '2026-07-10', employee_id: null, is_open_shift: true },  // future
    { id: 4, shift_date: '2026-06-15', employee_id: 2, is_open_shift: false },    // assigned
  ]

  it('returns only past unclaimed open shifts', () => {
    const result = overdueOpenShifts(shifts, '2026-07-05')
    expect(result.map(s => s.id)).toEqual([1])
  })

  it('does not include today as overdue', () => {
    const result = overdueOpenShifts(shifts, '2026-07-05')
    expect(result.every(s => s.shift_date < '2026-07-05')).toBe(true)
  })

  it('returns empty when no overdue shifts', () => {
    expect(overdueOpenShifts(shifts, '2026-05-01')).toHaveLength(0)
  })
})

// ─── upcomingAssignedShifts ───────────────────────────────────────────────────

describe('upcomingAssignedShifts', () => {
  const shifts = [
    { id: 1, shift_date: '2026-07-01', employee_id: 5, is_open_shift: false },  // past, assigned
    { id: 2, shift_date: '2026-07-10', employee_id: 5, is_open_shift: false },  // today, assigned
    { id: 3, shift_date: '2026-07-15', employee_id: 5, is_open_shift: false },  // future, assigned
    { id: 4, shift_date: '2026-07-20', employee_id: null, is_open_shift: true }, // future, open
  ]

  it('returns only assigned shifts today or later', () => {
    const result = upcomingAssignedShifts(shifts, '2026-07-10')
    expect(result.map(s => s.id)).toEqual([2, 3])
  })

  it('excludes open (unassigned) shifts', () => {
    const result = upcomingAssignedShifts(shifts, '2026-07-01')
    expect(result.some(s => s.id === 4)).toBe(false)
  })

  it('returns empty array when no upcoming assigned shifts', () => {
    expect(upcomingAssignedShifts(shifts, '2026-08-01')).toHaveLength(0)
  })
})

// ─── isNoShowShift ──────────────────────────────────────────────────────────

describe('isNoShowShift', () => {
  const now = new Date('2026-07-13T18:00:00Z')
  const baseShift = { shift_date: '2026-07-13', end_time: '12:00', employee_id: 1, is_open_shift: false, status: undefined as string | undefined }
  const clockIn = (employeeId: number, date: string) => ({ employee_id: employeeId, clock_in: `${date}T09:00:00Z` })

  it('flags a past shift with no clock-in and no callout as a no-show', () => {
    expect(isNoShowShift(baseShift, [], now)).toBe(true)
  })

  it('does not flag a shift whose scheduled end has not passed yet', () => {
    const shift = { ...baseShift, end_time: '23:00' }
    expect(isNoShowShift(shift, [], now)).toBe(false)
  })

  it('does not flag a shift with a matching clock-in that day', () => {
    expect(isNoShowShift(baseShift, [clockIn(1, '2026-07-13')], now)).toBe(false)
  })

  it('does not flag a shift already marked as a callout', () => {
    const shift = { ...baseShift, status: 'called_out' }
    expect(isNoShowShift(shift, [], now)).toBe(false)
  })

  it('does not flag an open (unassigned) shift', () => {
    const shift = { ...baseShift, employee_id: null, is_open_shift: true }
    expect(isNoShowShift(shift, [], now)).toBe(false)
  })

  it('ignores a clock-in from a different employee or a different day', () => {
    const entries = [clockIn(2, '2026-07-13'), clockIn(1, '2026-07-12')]
    expect(isNoShowShift(baseShift, entries, now)).toBe(true)
  })
})

// ─── shouldSuppressOutOfHoursEntry ─────────────────────────────────────────────

describe('shouldSuppressOutOfHoursEntry', () => {
  it('suppresses a shift whose flagged end differs only by seconds precision', () => {
    const shift = { start_time: '09:00', end_time: '17:00' }
    const hours: DayHours = { open: '09:00', close: '17:00:00', closed: false }
    expect(shouldSuppressOutOfHoursEntry(shift, hours)).toBe(true)
  })

  it('does not suppress a shift genuinely outside business hours', () => {
    const shift = { start_time: '08:00', end_time: '17:00' }
    const hours: DayHours = { open: '09:00', close: '17:00', closed: false }
    expect(shouldSuppressOutOfHoursEntry(shift, hours)).toBe(false)
  })

  it('does not suppress a closed-day entry', () => {
    const shift = { start_time: '09:00', end_time: '17:00' }
    const hours: DayHours = { open: '09:00', close: '17:00', closed: true }
    expect(shouldSuppressOutOfHoursEntry(shift, hours)).toBe(false)
  })

  it('does not suppress when only one side of a doubly-flagged shift is a genuine mismatch', () => {
    const shift = { start_time: '08:00', end_time: '17:00' }
    const hours: DayHours = { open: '09:00', close: '17:00:00', closed: false }
    expect(shouldSuppressOutOfHoursEntry(shift, hours)).toBe(false)
  })
})

// ─── splitWeeklyOvertime ────────────────────────────────────────────────────

describe('splitWeeklyOvertime', () => {
  const shift = (id: number, date: string, start: string, end: string, employeeId: number | null = 1) => (
    { id, employee_id: employeeId, shift_date: date, start_time: start, end_time: end }
  )

  it('splits nothing when total week hours are at or under 40', () => {
    const shifts = [
      shift(1, '2026-07-06', '09:00', '17:00'), // 8h
      shift(2, '2026-07-07', '09:00', '17:00'), // 8h
      shift(3, '2026-07-08', '09:00', '17:00'), // 8h
      shift(4, '2026-07-09', '09:00', '17:00'), // 8h
      shift(5, '2026-07-10', '09:00', '17:00'), // 8h — total 40h
    ]
    const result = splitWeeklyOvertime(shifts, 1)
    for (const s of shifts) {
      expect(result.get(s)).toEqual({ regHrs: 8, otHrs: 0 })
    }
  })

  it('splits a single shift that crosses the 40h threshold', () => {
    const shifts = [
      shift(1, '2026-07-06', '09:00', '17:00'), // 8h, running 8
      shift(2, '2026-07-07', '09:00', '17:00'), // 8h, running 16
      shift(3, '2026-07-08', '09:00', '17:00'), // 8h, running 24
      shift(4, '2026-07-09', '09:00', '17:00'), // 8h, running 32
      shift(5, '2026-07-10', '09:00', '18:00'), // 9h, running 41 — 1h OT
    ]
    const result = splitWeeklyOvertime(shifts, 1)
    expect(result.get(shifts[4])).toEqual({ regHrs: 8, otHrs: 1 })
    expect(result.get(shifts[0])).toEqual({ regHrs: 8, otHrs: 0 })
  })

  it('treats a later shift as entirely overtime once an earlier one already reached 40h', () => {
    const shifts = [
      shift(1, '2026-07-06', '08:00', '18:00', 1), // 10h
      shift(2, '2026-07-07', '08:00', '18:00', 1), // 10h, running 20
      shift(3, '2026-07-08', '08:00', '18:00', 1), // 10h, running 30
      shift(4, '2026-07-09', '08:00', '18:00', 1), // 10h, running 40
      shift(5, '2026-07-10', '09:00', '13:00', 1), // 4h, running 44 — fully OT
    ]
    const result = splitWeeklyOvertime(shifts, 1)
    expect(result.get(shifts[3])).toEqual({ regHrs: 10, otHrs: 0 })
    expect(result.get(shifts[4])).toEqual({ regHrs: 0, otHrs: 4 })
  })

  it('orders same-day shifts by start_time before walking the running total', () => {
    const shifts = [
      shift(1, '2026-07-06', '13:00', '17:00'), // 4h, added second chronologically but listed first
      shift(2, '2026-07-06', '09:00', '13:00'), // 4h, earlier start
    ]
    const result = splitWeeklyOvertime(shifts, 1)
    expect(result.get(shifts[1])).toEqual({ regHrs: 4, otHrs: 0 })
    expect(result.get(shifts[0])).toEqual({ regHrs: 4, otHrs: 0 })
  })

  it('ignores shifts belonging to other employees', () => {
    const shifts = [
      shift(1, '2026-07-06', '09:00', '18:00', 1), // 9h
      shift(2, '2026-07-06', '09:00', '18:00', 2), // different employee
    ]
    const result = splitWeeklyOvertime(shifts, 1)
    expect(result.has(shifts[1])).toBe(false)
    expect(result.get(shifts[0])).toEqual({ regHrs: 9, otHrs: 0 })
  })
})

// ─── shiftLaborCost ─────────────────────────────────────────────────────────

describe('shiftLaborCost', () => {
  it('returns null when the employee has no pay rate', () => {
    expect(shiftLaborCost(8, 0, { pay_type: 'hourly', pay_rate: null })).toBeNull()
  })

  it('pays hourly regular hours at the flat rate with no overtime', () => {
    expect(shiftLaborCost(8, 0, { pay_type: 'hourly', pay_rate: 20 })).toBe(160)
  })

  it('pays overtime hours at 1.5x for hourly employees', () => {
    // JAY-166 ticket's own gut-check: 45h @ $20/hr → $950, not $900 flat.
    expect(shiftLaborCost(40, 5, { pay_type: 'hourly', pay_rate: 20 })).toBe(950)
  })

  it('always uses the flat implied-hourly rate for salary employees, never an OT premium', () => {
    const emp = { pay_type: 'salary', pay_rate: 41600 } // implied $20/hr
    expect(shiftLaborCost(40, 5, emp)).toBe(20 * 45)
  })
})

// ─── employeeAgeOnDate ──────────────────────────────────────────────────────

describe('employeeAgeOnDate', () => {
  it('counts a birthday falling exactly on the given date as already turned', () => {
    expect(employeeAgeOnDate('2010-07-21', '2026-07-21')).toBe(16)
  })

  it('does not count a birthday that falls the day after the given date', () => {
    expect(employeeAgeOnDate('2010-07-22', '2026-07-21')).toBe(15)
  })

  it('handles a leap-year (Feb 29) date of birth', () => {
    expect(employeeAgeOnDate('2008-02-29', '2026-07-21')).toBe(18)
    expect(employeeAgeOnDate('2008-02-29', '2026-01-01')).toBe(17)
  })
})

// ─── isMinorLaborViolation ──────────────────────────────────────────────────

describe('isMinorLaborViolation', () => {
  const config = { curfewHour: 22, maxDailyHours: 8 }

  it('flags a curfew violation for an under-18 employee whose shift ends after the curfew hour', () => {
    const shift = { shift_date: '2026-07-21', start_time: '18:00', end_time: '23:00' }
    const result = isMinorLaborViolation(shift, '2010-01-01', config, [shift])
    expect(result).toEqual({ curfew: true, overDailyMax: false })
  })

  it('flags an over-daily-max violation for an under-18 employee whose shifts that day exceed the cap', () => {
    const shift = { shift_date: '2026-07-21', start_time: '09:00', end_time: '18:00' } // 9h
    const result = isMinorLaborViolation(shift, '2010-01-01', config, [shift])
    expect(result).toEqual({ curfew: false, overDailyMax: true })
  })

  it('never flags an adult employee', () => {
    const shift = { shift_date: '2026-07-21', start_time: '18:00', end_time: '23:00' }
    expect(isMinorLaborViolation(shift, '2000-01-01', config, [shift])).toBeNull()
  })

  it('never flags when the employee has no date of birth on file', () => {
    const shift = { shift_date: '2026-07-21', start_time: '18:00', end_time: '23:00' }
    expect(isMinorLaborViolation(shift, null, config, [shift])).toBeNull()
  })

  it('is off when both settings are null, even for an under-18 employee', () => {
    const shift = { shift_date: '2026-07-21', start_time: '18:00', end_time: '23:00' }
    const result = isMinorLaborViolation(shift, '2010-01-01', { curfewHour: null, maxDailyHours: null }, [shift])
    expect(result).toBeNull()
  })
})
