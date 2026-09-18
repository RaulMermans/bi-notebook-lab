import { describe, expect, it } from 'vitest'
import { compareMeasureResults } from '../../../src/runtime/context/comparison'

describe('compareMeasureResults', () => {
  it('computes absolute and relative delta for two numeric results', () => {
    const result = compareMeasureResults(2557236.9, 143882.17)
    expect(result.bothNumeric).toBe(true)
    expect(result.absoluteDelta).toBeCloseTo(143882.17 - 2557236.9, 5)
    expect(result.relativeDelta).toBeCloseTo((143882.17 - 2557236.9) / 2557236.9, 5)
  })

  it('returns relativeDelta 0 when both baseline and current are zero', () => {
    const result = compareMeasureResults(0, 0)
    expect(result.bothNumeric).toBe(true)
    expect(result.absoluteDelta).toBe(0)
    expect(result.relativeDelta).toBe(0)
  })

  it('leaves relativeDelta undefined (never Infinity/NaN) when baseline is zero but current is not', () => {
    const result = compareMeasureResults(0, 42)
    expect(result.bothNumeric).toBe(true)
    expect(result.absoluteDelta).toBe(42)
    expect(result.relativeDelta).toBeUndefined()
  })

  it('does not compute a delta between two non-numeric results', () => {
    const result = compareMeasureResults('Spain', 'France')
    expect(result.bothNumeric).toBe(false)
    expect(result.absoluteDelta).toBeUndefined()
    expect(result.relativeDelta).toBeUndefined()
  })

  it('does not compute a delta when either result is blank (null)', () => {
    const withNullBaseline = compareMeasureResults(null, 10)
    expect(withNullBaseline.bothNumeric).toBe(false)

    const bothNull = compareMeasureResults(null, null)
    expect(bothNull.bothNumeric).toBe(false)
    expect(bothNull.baselineValue).toBeNull()
    expect(bothNull.currentValue).toBeNull()
  })

  it('does not compute a delta for a boolean result', () => {
    const result = compareMeasureResults(true, false)
    expect(result.bothNumeric).toBe(false)
  })
})
