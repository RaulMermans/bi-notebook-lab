import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { ConditionalColumnStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateConditionalColumn } from '../../../../src/runtime/query/steps/conditionalColumn'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

const columns = [col('c1', 'Revenue', 'decimal')]

function step(overrides: Partial<ConditionalColumnStep> = {}): ConditionalColumnStep {
  return {
    id: 's1',
    kind: 'conditional-column',
    name: 'Conditional Column',
    outputColumnId: 'out1',
    outputName: 'RevenueBand',
    clauses: [
      { columnId: 'c1', operator: 'greater-than-or-equal', value: 1000, result: 'High' },
      { columnId: 'c1', operator: 'greater-than-or-equal', value: 500, result: 'Medium' },
    ],
    elseValue: 'Low',
    ...overrides,
  }
}

describe('conditional-column', () => {
  it('applies the first matching clause', () => {
    const base = frame(columns, [{ Revenue: 1500 }, { Revenue: 700 }, { Revenue: 100 }])
    const result = evaluateConditionalColumn(base, step())
    expect(result.frame?.rows.map((r) => r.RevenueBand)).toEqual(['High', 'Medium', 'Low'])
  })

  it('falls through to elseValue when no clause matches', () => {
    const base = frame(columns, [{ Revenue: 0 }])
    expect(evaluateConditionalColumn(base, step()).frame?.rows[0].RevenueBand).toBe('Low')
  })

  it('generates a column with the stable pre-minted id', () => {
    const base = frame(columns, [{ Revenue: 1500 }])
    const result = evaluateConditionalColumn(base, step())
    expect(result.frame?.columns.find((c) => c.name === 'RevenueBand')?.id).toBe('out1')
  })

  it('infers a boolean/numeric/string output type from produced values', () => {
    const base = frame(columns, [{ Revenue: 1500 }, { Revenue: 100 }])
    const numeric = step({ clauses: [{ columnId: 'c1', operator: 'greater-than-or-equal', value: 1000, result: 1 }], elseValue: 0 })
    const result = evaluateConditionalColumn(base, numeric)
    expect(result.frame?.columns.find((c) => c.name === 'RevenueBand')?.dataType).toBe('integer')
  })

  it('rejects incompatible result types across branches', () => {
    const base = frame(columns, [{ Revenue: 1500 }, { Revenue: 100 }])
    const mixed = step({ clauses: [{ columnId: 'c1', operator: 'greater-than-or-equal', value: 1000, result: 1 }], elseValue: 'Low' })
    expect(evaluateConditionalColumn(base, mixed).diagnostics[0].code).toBe('QUERY_CONDITIONAL_INVALID_RESULT_TYPE')
  })

  it('rejects zero clauses', () => {
    const base = frame(columns, [{ Revenue: 1 }])
    expect(evaluateConditionalColumn(base, step({ clauses: [] })).diagnostics[0].code).toBe('QUERY_INVALID_STEP_CONFIG')
  })

  it('reports a missing clause column', () => {
    const base = frame(columns, [{ Revenue: 1 }])
    expect(evaluateConditionalColumn(base, step({ clauses: [{ columnId: 'missing', operator: 'equals', value: 1, result: 'x' }] })).diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
  })
})
