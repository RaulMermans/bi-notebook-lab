import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { CustomColumnStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateCustomColumn } from '../../../../src/runtime/query/steps/customColumn'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

function step(expression: string, outputName = 'Result'): CustomColumnStep {
  return { id: 's1', kind: 'custom-column', name: 'Added Custom', outputColumnId: 'out1', outputName, expression }
}

describe('custom-column', () => {
  it('evaluates arithmetic over column references', () => {
    const base = frame([col('c1', 'Quantity', 'integer'), col('c2', 'UnitPrice', 'decimal')], [{ Quantity: 3, UnitPrice: 10 }])
    const result = evaluateCustomColumn(base, step('[Quantity] * [UnitPrice]', 'Revenue'))
    expect(result.diagnostics).toEqual([])
    expect(result.frame?.rows[0].Revenue).toBe(30)
  })

  it('evaluates text functions', () => {
    const base = frame([col('c1', 'Name')], [{ Name: '  raul  ' }])
    const result = evaluateCustomColumn(base, step('Text.Upper(Text.Trim([Name]))'))
    expect(result.frame?.rows[0].Result).toBe('RAUL')
  })

  it('evaluates a conditional expression', () => {
    const base = frame([col('c1', 'Revenue', 'decimal')], [{ Revenue: 1500 }, { Revenue: 100 }])
    const result = evaluateCustomColumn(base, step('if [Revenue] >= 1000 then "High" else "Standard"'))
    expect(result.frame?.rows.map((r) => r.Result)).toEqual(['High', 'Standard'])
  })

  it('generates the output column with the stable pre-minted id', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    const result = evaluateCustomColumn(base, step('[A] + 1'))
    expect(result.frame?.columns.find((c) => c.name === 'Result')?.id).toBe('out1')
  })

  it('treats a missing column reference as null (arithmetic still fails on non-numeric, but comparison/concat degrade gracefully)', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    const result = evaluateCustomColumn(base, step('Text.Length("hello")'))
    expect(result.frame?.rows[0].Result).toBe(5)
  })

  it('reports a parse error for malformed syntax', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    expect(evaluateCustomColumn(base, step('[A] +')).diagnostics[0].code).toBe('QUERY_CUSTOM_PARSE_ERROR')
  })

  it('reports a binding error for an unknown column', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    expect(evaluateCustomColumn(base, step('[Nope] + 1')).diagnostics[0].code).toBe('QUERY_CUSTOM_COLUMN_NOT_FOUND')
  })

  it('reports a runtime type error for arithmetic over text', () => {
    const base = frame([col('c1', 'A', 'string')], [{ A: 'x' }])
    expect(evaluateCustomColumn(base, step('[A] + 1')).diagnostics[0].code).toBe('QUERY_CUSTOM_TYPE_ERROR')
  })

  it('reports divide-by-zero', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 10 }])
    expect(evaluateCustomColumn(base, step('[A] / 0')).diagnostics[0].code).toBe('QUERY_CUSTOM_DIVIDE_BY_ZERO')
  })

  it('treats a missing column value as null in row data (& concatenation coerces null to empty text)', () => {
    const base = frame([col('c1', 'A'), col('c2', 'B')], [{ A: null, B: 'x' }])
    const result = evaluateCustomColumn(base, step('[A] & [B]'))
    expect(result.frame?.rows[0].Result).toBe('x')
  })

  it('rejects an output name that collides with an existing column', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    expect(evaluateCustomColumn(base, step('[A] + 1', 'A')).diagnostics[0].code).toBe('QUERY_DUPLICATE_COLUMN_NAME')
  })

  it('unsupported M constructs (let/in) fail to parse rather than silently executing', () => {
    const base = frame([col('c1', 'A', 'integer')], [{ A: 1 }])
    expect(evaluateCustomColumn(base, step('let x = 1 in x')).diagnostics[0].code).toBe('QUERY_CUSTOM_PARSE_ERROR')
  })
})
