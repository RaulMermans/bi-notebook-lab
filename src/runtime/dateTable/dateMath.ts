/**
 * Canonical date normalization/arithmetic for Sprint 10 (Date Tables & Time
 * Intelligence). Every model date is stored as an ISO `YYYY-MM-DD` string
 * (see `lib/profiling/inferType.ts` / `lib/buildDataTable.ts`) — this module
 * never touches a JS `Date`'s local-timezone getters/setters, only its UTC
 * ones, so date-shift arithmetic can never drift with the browser's locale
 * or DST (sprint brief §8 "Do not perform local-time arithmetic that can
 * drift due to DST"). See docs/TIME_INTELLIGENCE.md "Date normalization".
 */

export interface ModelDate {
  year: number
  month: number // 1-12
  day: number
}

export type DateIntervalUnit = 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

/** Parses the `YYYY-MM-DD` prefix of a model date/datetime string. Returns `undefined` for anything else — never throws (sprint brief §7 "Do not throw raw JS errors"). */
export function parseModelDate(value: unknown): ModelDate | undefined {
  if (typeof value !== 'string') return undefined
  const match = DATE_PATTERN.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return { year, month, day }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export function formatModelDate(date: ModelDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`
}

function toUtcEpochDay(date: ModelDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000)
}

function fromUtcEpochDay(epochDay: number): ModelDate {
  const instant = new Date(epochDay * 86_400_000)
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() }
}

export function compareModelDates(a: ModelDate, b: ModelDate): number {
  return toUtcEpochDay(a) - toUtcEpochDay(b)
}

export function addDays(date: ModelDate, count: number): ModelDate {
  return fromUtcEpochDay(toUtcEpochDay(date) + count)
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month` — JS Date normalizes
  // month overflow (month=13 → January of year+1), so this works for month=12 too.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Classic (Power BI) month-count shift: clamps the result to the last valid
 * day of the destination month rather than overflowing into the next month,
 * e.g. Jan 31 - 1 month = Feb 28/29, never Mar 2/3 (sprint brief §28 "clamp
 * to the last valid day"). Never relies on JS Date's own day-overflow
 * rollover.
 */
export function addMonthsClassic(date: ModelDate, count: number): ModelDate {
  const absoluteMonth = date.year * 12 + (date.month - 1) + count
  const year = Math.floor(absoluteMonth / 12)
  const month = absoluteMonth - year * 12 + 1
  const day = Math.min(date.day, daysInMonth(year, month))
  return { year, month, day }
}

/** Classic year shift: Feb 29 → Feb 28 when the destination year isn't a leap year (sprint brief §18/§28). */
export function addYearsClassic(date: ModelDate, count: number): ModelDate {
  const year = date.year + count
  const day = Math.min(date.day, daysInMonth(year, date.month))
  return { year, month: date.month, day }
}

export function shiftByInterval(date: ModelDate, count: number, unit: DateIntervalUnit): ModelDate {
  switch (unit) {
    case 'YEAR':
      return addYearsClassic(date, count)
    case 'QUARTER':
      return addMonthsClassic(date, count * 3)
    case 'MONTH':
      return addMonthsClassic(date, count)
    case 'DAY':
      return addDays(date, count)
  }
}

export function startOfMonth(date: ModelDate): ModelDate {
  return { year: date.year, month: date.month, day: 1 }
}

export function endOfMonth(date: ModelDate): ModelDate {
  return { year: date.year, month: date.month, day: daysInMonth(date.year, date.month) }
}

export function startOfYear(date: ModelDate): ModelDate {
  return { year: date.year, month: 1, day: 1 }
}

export function endOfYear(date: ModelDate): ModelDate {
  return { year: date.year, month: 12, day: 31 }
}
