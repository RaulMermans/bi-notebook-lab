import { generateRetailDataset } from '../../lib/sample/generateRetailDataset'
import type { ValidationSpec } from '../../domain/validation'

/**
 * Frozen fixture values for the Time Intelligence checkpoint (Lesson 3).
 * Computed independently of the model/measure/date-table runtime — see
 * `retailFoundationsValidation.ts` for why. Each case anchors the external
 * filter context to one full calendar month (matching
 * docs/TIME_INTELLIGENCE.md's own worked example, "Year = 2025, Month =
 * March"), then computes the same-period-last-year / year-to-date / YoY
 * numbers directly from the raw generated rows.
 */
const [, , salesDs, calendarDs] = generateRetailDataset()
const salesRows = salesDs.tables[0].rows
const calendarRows = calendarDs.tables[0].rows

function sum(rows: Record<string, unknown>[], selector: (row: Record<string, unknown>) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0)
}

const calendarByDate = new Map(calendarRows.map((row) => [row.Date as string, row]))

function revenueForMonth(year: number, month: string): number {
  return sum(
    salesRows.filter((row) => {
      const calendarRow = calendarByDate.get(row.Date as string)
      return calendarRow ? calendarRow.Year === year && calendarRow.Month === month : false
    }),
    (row) => row.Revenue as number,
  )
}

function revenueYtdThrough(year: number, monthNumber: number): number {
  return sum(
    salesRows.filter((row) => {
      const calendarRow = calendarByDate.get(row.Date as string)
      return calendarRow ? calendarRow.Year === year && (calendarRow.MonthNumber as number) <= monthNumber : false
    }),
    (row) => row.Revenue as number,
  )
}

const CALENDAR = { tableName: 'Calendar', sourceKey: 'calendar' }

const periods = [
  { id: 'march-2025', year: 2025, month: 'March', monthNumber: 3, priorYear: 2024 },
  { id: 'june-2025', year: 2025, month: 'June', monthNumber: 6, priorYear: 2024 },
]

const revenueLyCases = periods.map((period) => ({
  id: period.id,
  title: `${period.month} ${period.year}`,
  filters: [
    { column: { table: CALENDAR, columnName: 'Year' }, values: [period.year] },
    { column: { table: CALENDAR, columnName: 'Month' }, values: [period.month] },
  ],
  expected: revenueForMonth(period.priorYear, period.month),
}))

const revenueYtdCases = periods.map((period) => ({
  id: period.id,
  title: `${period.month} ${period.year}`,
  filters: [
    { column: { table: CALENDAR, columnName: 'Year' }, values: [period.year] },
    { column: { table: CALENDAR, columnName: 'Month' }, values: [period.month] },
  ],
  expected: revenueYtdThrough(period.year, period.monthNumber),
}))

const revenueYoyCases = periods.map((period) => ({
  id: period.id,
  title: `${period.month} ${period.year}`,
  filters: [
    { column: { table: CALENDAR, columnName: 'Year' }, values: [period.year] },
    { column: { table: CALENDAR, columnName: 'Month' }, values: [period.month] },
  ],
  expected: revenueForMonth(period.year, period.month) - revenueForMonth(period.priorYear, period.month),
}))

/**
 * The third scored checkpoint (Sprint 13). Requires Calendar to be marked
 * as a Date Table (a prerequisite already satisfied in this lesson's
 * starting state — see `src/data/lessons/timeIntelligenceLesson.ts`) and
 * three classic time-intelligence measures: `Revenue LY`
 * (`SAMEPERIODLASTYEAR`), `Revenue YTD` (`DATESYTD`/`TOTALYTD`), and
 * `Revenue YoY` (the difference between the two prior measures).
 */
export const timeIntelligenceValidationSpec: ValidationSpec = {
  id: 'time-intelligence-checkpoint',
  title: 'Time Intelligence',
  passingPercentage: 70,
  rules: [
    {
      id: 'date-table-calendar',
      type: 'date-table',
      title: 'Calendar marked as a Date Table',
      category: 'Model',
      points: 15,
      required: true,
      table: CALENDAR,
      dateColumn: { table: CALENDAR, columnName: 'Date' },
    },
    {
      id: 'measure-revenue-ly',
      type: 'measure-result',
      title: 'Revenue LY',
      category: 'Measures',
      points: 30,
      measure: { name: 'Revenue LY' },
      cases: revenueLyCases,
    },
    {
      id: 'measure-revenue-ytd',
      type: 'measure-result',
      title: 'Revenue YTD',
      category: 'Measures',
      points: 30,
      measure: { name: 'Revenue YTD' },
      cases: revenueYtdCases,
    },
    {
      id: 'measure-revenue-yoy',
      type: 'measure-result',
      title: 'Revenue YoY',
      category: 'Measures',
      points: 25,
      measure: { name: 'Revenue YoY' },
      cases: revenueYoyCases,
    },
  ],
}
