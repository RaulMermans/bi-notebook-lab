import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonthsClassic,
  addYearsClassic,
  compareModelDates,
  formatModelDate,
  parseModelDate,
  shiftByInterval,
  startOfYear,
} from '../../../src/runtime/dateTable/dateMath'

describe('dateMath', () => {
  it('parses and formats a model date deterministically', () => {
    expect(parseModelDate('2025-03-18')).toEqual({ year: 2025, month: 3, day: 18 })
    expect(formatModelDate({ year: 2025, month: 3, day: 18 })).toBe('2025-03-18')
    expect(parseModelDate('not-a-date')).toBeUndefined()
    expect(parseModelDate(null)).toBeUndefined()
  })

  it('compares dates chronologically', () => {
    expect(compareModelDates({ year: 2025, month: 1, day: 1 }, { year: 2025, month: 1, day: 2 })).toBeLessThan(0)
    expect(compareModelDates({ year: 2025, month: 1, day: 2 }, { year: 2025, month: 1, day: 1 })).toBeGreaterThan(0)
    expect(compareModelDates({ year: 2025, month: 1, day: 1 }, { year: 2025, month: 1, day: 1 })).toBe(0)
  })

  it('addDays crosses month/year boundaries', () => {
    expect(addDays({ year: 2024, month: 12, day: 31 }, 1)).toEqual({ year: 2025, month: 1, day: 1 })
    expect(addDays({ year: 2025, month: 1, day: 1 }, -1)).toEqual({ year: 2024, month: 12, day: 31 })
  })

  it('addYearsClassic clamps Feb 29 to Feb 28 in a non-leap target year (sprint brief §18/§28)', () => {
    expect(addYearsClassic({ year: 2024, month: 2, day: 29 }, -1)).toEqual({ year: 2023, month: 2, day: 28 })
    expect(addYearsClassic({ year: 2024, month: 2, day: 29 }, 1)).toEqual({ year: 2025, month: 2, day: 28 })
    expect(addYearsClassic({ year: 2025, month: 3, day: 1 }, -1)).toEqual({ year: 2024, month: 3, day: 1 })
  })

  it('addMonthsClassic clamps to the last valid day of the destination month rather than rolling over', () => {
    expect(addMonthsClassic({ year: 2025, month: 1, day: 31 }, 1)).toEqual({ year: 2025, month: 2, day: 28 })
    expect(addMonthsClassic({ year: 2025, month: 3, day: 31 }, -1)).toEqual({ year: 2025, month: 2, day: 28 })
    expect(addMonthsClassic({ year: 2025, month: 6, day: 10 }, -1)).toEqual({ year: 2025, month: 5, day: 10 })
  })

  it('shiftByInterval dispatches YEAR/QUARTER/MONTH/DAY consistently', () => {
    const base = { year: 2025, month: 6, day: 15 }
    expect(shiftByInterval(base, -1, 'YEAR')).toEqual({ year: 2024, month: 6, day: 15 })
    expect(shiftByInterval(base, 1, 'QUARTER')).toEqual({ year: 2025, month: 9, day: 15 })
    expect(shiftByInterval(base, -1, 'MONTH')).toEqual({ year: 2025, month: 5, day: 15 })
    expect(shiftByInterval(base, 1, 'DAY')).toEqual({ year: 2025, month: 6, day: 16 })
  })

  it('startOfYear anchors to January 1st', () => {
    expect(startOfYear({ year: 2025, month: 7, day: 4 })).toEqual({ year: 2025, month: 1, day: 1 })
  })
})
