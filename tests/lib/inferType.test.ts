import { describe, expect, it } from 'vitest'
import { classifyValue, coerceValue, inferColumnType } from '../../src/lib/profiling/inferType'

describe('inferColumnType', () => {
  it('infers integer', () => {
    expect(inferColumnType(['1', '2', '3'])).toBe('integer')
  })

  it('infers decimal', () => {
    expect(inferColumnType(['12.50', '13.00', '8.75'])).toBe('decimal')
  })

  it('widens mixed integer and decimal values to decimal', () => {
    expect(inferColumnType(['12', '13.5', '4'])).toBe('decimal')
  })

  it('infers boolean', () => {
    expect(inferColumnType(['true', 'false', 'TRUE'])).toBe('boolean')
  })

  it('infers date', () => {
    expect(inferColumnType(['2026-01-02', '2026-01-03'])).toBe('date')
  })

  it('infers datetime', () => {
    expect(inferColumnType(['2026-01-02T10:00:00Z', '2026-01-03T08:30:00Z'])).toBe('datetime')
  })

  it('falls back to string when values are incompatible', () => {
    expect(inferColumnType(['1', '2', 'hello', '4'])).toBe('string')
  })

  it('treats entirely blank samples as the null type', () => {
    expect(inferColumnType(['', '', ''])).toBe('null')
  })

  it('treats an empty column as unknown', () => {
    expect(inferColumnType([])).toBe('unknown')
  })
})

describe('classifyValue', () => {
  it('classifies native Excel-style values', () => {
    expect(classifyValue(5)).toBe('integer')
    expect(classifyValue(5.5)).toBe('decimal')
    expect(classifyValue(true)).toBe('boolean')
    expect(classifyValue(new Date('2026-01-01'))).toBe('datetime')
    expect(classifyValue(null)).toBe('null')
  })
})

describe('coerceValue', () => {
  it('coerces blank strings to null regardless of target type', () => {
    expect(coerceValue('', 'integer')).toBeNull()
    expect(coerceValue('   ', 'string')).toBeNull()
  })

  it('coerces numeric strings into numbers', () => {
    expect(coerceValue('42', 'integer')).toBe(42)
    expect(coerceValue('12.5', 'decimal')).toBe(12.5)
  })

  it('coerces date strings into normalized ISO dates', () => {
    expect(coerceValue('2026-01-02', 'date')).toBe('2026-01-02')
  })

  it('never turns an empty numeric cell into zero', () => {
    expect(coerceValue('', 'decimal')).toBeNull()
  })
})
