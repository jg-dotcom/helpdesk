// JAY-137 — shared date-formatting util, extracted from 6 near-duplicate
// per-component `formatDate`/`fmtShort` helpers. Each `style` maps to one of
// the distinct `toLocaleDateString` option sets already in use across the
// app; date-only `YYYY-MM-DD` strings get `T00:00:00` appended before
// parsing (several call sites relied on this to avoid `new Date(...)`
// shifting a day under UTC parsing), while full ISO timestamps are left
// untouched.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export type DateFormatStyle = 'short' | 'shortNoYear' | 'weekdayShort' | 'longFull'

const STYLES: Record<DateFormatStyle, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric', year: 'numeric' },
  shortNoYear: { month: 'short', day: 'numeric' },
  weekdayShort: { weekday: 'long', month: 'short', day: 'numeric' },
  longFull: { month: 'long', day: 'numeric', year: 'numeric' },
}

export function formatDate(input: string, style: DateFormatStyle): string {
  const date = new Date(DATE_ONLY.test(input) ? `${input}T00:00:00` : input)
  return date.toLocaleDateString('en-US', STYLES[style])
}
