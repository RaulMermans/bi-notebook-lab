import { describe, expect, it } from 'vitest'
import { compareScalarValues, evaluatePredicateForRow, type BoundPredicateNode } from '../../../src/runtime/measure/booleanFilter'

function literal(value: number | string | boolean): BoundPredicateNode {
  return { kind: 'Literal', value, span: { start: 0, end: 0 } }
}

function column(name: string): BoundPredicateNode {
  return {
    kind: 'Column',
    ref: { datasetId: 'ds', tableId: 'table', columnId: name },
    name,
    tableName: 'Products',
    dataType: 'decimal',
    span: { start: 0, end: 0 },
  }
}

/** Sprint 8 boolean runtime — see docs/CALCULATE.md "Blank comparison semantics" for the documented rules under test here. */
describe('compareScalarValues', () => {
  it('number comparisons', () => {
    expect(compareScalarValues('>', 10, 5)).toBe(true)
    expect(compareScalarValues('>', 5, 10)).toBe(false)
    expect(compareScalarValues('>=', 5, 5)).toBe(true)
    expect(compareScalarValues('<', 5, 10)).toBe(true)
    expect(compareScalarValues('<=', 10, 10)).toBe(true)
    expect(compareScalarValues('=', 5, 5)).toBe(true)
    expect(compareScalarValues('<>', 5, 6)).toBe(true)
  })

  it('string equality (case-sensitive, no numeric coercion)', () => {
    expect(compareScalarValues('=', 'Spain', 'Spain')).toBe(true)
    expect(compareScalarValues('=', 'Spain', 'spain')).toBe(false)
    expect(compareScalarValues('<>', 'Spain', 'France')).toBe(true)
    expect(compareScalarValues('=', '10', 10)).toBe(false) // no silent string->number coercion
    expect(compareScalarValues('<>', '10', 10)).toBe(true)
  })

  it('boolean equality', () => {
    expect(compareScalarValues('=', true, true)).toBe(true)
    expect(compareScalarValues('=', true, false)).toBe(false)
    expect(compareScalarValues('<>', true, false)).toBe(true)
  })

  it('blank handling: BLANK = BLANK is true, relational comparisons with a blank are never true', () => {
    expect(compareScalarValues('=', null, null)).toBe(true)
    expect(compareScalarValues('=', null, undefined)).toBe(true)
    expect(compareScalarValues('=', null, 0)).toBe(false)
    expect(compareScalarValues('<>', null, 0)).toBe(true)
    expect(compareScalarValues('>', null, 0)).toBe(false)
    expect(compareScalarValues('<', 0, null)).toBe(false)
    expect(compareScalarValues('>=', null, null)).toBe(false)
  })
})

describe('evaluatePredicateForRow', () => {
  it('evaluates a single comparison against a row', () => {
    const predicate: BoundPredicateNode = { kind: 'Comparison', operator: '>', left: column('Price'), right: literal(100), span: { start: 0, end: 0 } }
    expect(evaluatePredicateForRow(predicate, { Price: 150 })).toBe(true)
    expect(evaluatePredicateForRow(predicate, { Price: 50 })).toBe(false)
  })

  it('evaluates && with short-circuit and correct truth table', () => {
    const predicate: BoundPredicateNode = {
      kind: 'Logical',
      operator: '&&',
      left: { kind: 'Comparison', operator: '=', left: column('Category'), right: literal('Furniture'), span: { start: 0, end: 0 } },
      right: { kind: 'Comparison', operator: '>=', left: column('Price'), right: literal(100), span: { start: 0, end: 0 } },
      span: { start: 0, end: 0 },
    }
    expect(evaluatePredicateForRow(predicate, { Category: 'Furniture', Price: 150 })).toBe(true)
    expect(evaluatePredicateForRow(predicate, { Category: 'Furniture', Price: 50 })).toBe(false)
    expect(evaluatePredicateForRow(predicate, { Category: 'Electronics', Price: 150 })).toBe(false)
  })

  it('evaluates || correctly (true/false combinations)', () => {
    const predicate: BoundPredicateNode = {
      kind: 'Logical',
      operator: '||',
      left: { kind: 'Comparison', operator: '=', left: column('Category'), right: literal('Furniture'), span: { start: 0, end: 0 } },
      right: { kind: 'Comparison', operator: '=', left: column('Category'), right: literal('Electronics'), span: { start: 0, end: 0 } },
      span: { start: 0, end: 0 },
    }
    expect(evaluatePredicateForRow(predicate, { Category: 'Furniture' })).toBe(true)
    expect(evaluatePredicateForRow(predicate, { Category: 'Electronics' })).toBe(true)
    expect(evaluatePredicateForRow(predicate, { Category: 'Clothing' })).toBe(false)
  })
})
