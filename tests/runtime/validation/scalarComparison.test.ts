import { describe, expect, it } from 'vitest'
import { compareScalar } from '../../../src/runtime/validation/scalarComparison'

describe('compareScalar', () => {
  it('matches an exact integer', () => {
    expect(compareScalar(42, 42).matches).toBe(true)
  })

  it('matches a float inside the default absolute tolerance', () => {
    expect(compareScalar(100.005, 100).matches).toBe(true)
  })

  it('rejects a float outside tolerance', () => {
    expect(compareScalar(101, 100, { type: 'absolute', value: 0.01 }).matches).toBe(false)
  })

  it('matches within relative tolerance for large numbers', () => {
    // 0.0001% relative tolerance on 10,000,000 is ±10 — well within a rounding difference of 5.
    expect(compareScalar(10_000_005, 10_000_000, { type: 'relative', value: 0.000001 }).matches).toBe(true)
  })

  it('rejects outside relative tolerance', () => {
    expect(compareScalar(10_100_000, 10_000_000, { type: 'relative', value: 0.000001 }).matches).toBe(false)
  })

  it('matches null against blank (null)', () => {
    expect(compareScalar(null, null).matches).toBe(true)
  })

  it('matches null against blank (undefined)', () => {
    expect(compareScalar(undefined, null).matches).toBe(true)
  })

  it('rejects a non-blank value against expected null', () => {
    expect(compareScalar(1, null).matches).toBe(false)
  })

  it('matches an exact string', () => {
    expect(compareScalar('Spain', 'Spain').matches).toBe(true)
  })

  it('rejects a mismatched string', () => {
    expect(compareScalar('France', 'Spain').matches).toBe(false)
  })

  it('matches an exact boolean', () => {
    expect(compareScalar(true, true).matches).toBe(true)
  })

  it('rejects a mismatched boolean', () => {
    expect(compareScalar(false, true).matches).toBe(false)
  })

  it('rejects a non-numeric actual value against an expected number', () => {
    expect(compareScalar('not a number', 42).matches).toBe(false)
  })
})
