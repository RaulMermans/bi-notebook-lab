import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { FillStep, FilterRowsStep, RemoveDuplicatesStep, ReplaceValuesStep, SortRowsStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateFill } from '../../../../src/runtime/query/steps/fill'
import { evaluateFilterRows } from '../../../../src/runtime/query/steps/filterRows'
import { evaluateRemoveDuplicates } from '../../../../src/runtime/query/steps/removeDuplicates'
import { evaluateReplaceValues } from '../../../../src/runtime/query/steps/replaceValues'
import { evaluateSortRows } from '../../../../src/runtime/query/steps/sortRows'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

describe('filter-rows', () => {
  const columns = [col('c1', 'Revenue', 'decimal'), col('c2', 'Country', 'string'), col('c3', 'Notes', 'string')]
  const rows = [
    { Revenue: 100, Country: 'Spain', Notes: null },
    { Revenue: 500, Country: 'France', Notes: 'vip' },
    { Revenue: null, Country: 'Spain', Notes: 'partial' },
  ]
  const base = frame(columns, rows)

  it('supports every operator', () => {
    const cases: [FilterRowsStep['conditions'][number]['operator'], unknown, number][] = [
      ['equals', 100, 1],
      ['not-equals', 100, 1],
      ['greater-than', 100, 1],
      ['greater-than-or-equal', 100, 2],
      ['less-than', 500, 1],
      ['less-than-or-equal', 500, 2],
      ['contains', 'pai', 2],
      ['starts-with', 'Sp', 2],
      ['ends-with', 'ain', 2],
      ['is-blank', undefined, 1],
      ['is-not-blank', undefined, 2],
    ]
    for (const [operator, value, expectedCount] of cases) {
      const isBlankOp = operator === 'is-blank' || operator === 'is-not-blank'
      const isStringOp = operator === 'contains' || operator === 'starts-with' || operator === 'ends-with'
      const columnId = isBlankOp ? 'c3' : isStringOp ? 'c2' : 'c1'
      const step: FilterRowsStep = { id: 's1', kind: 'filter-rows', name: 'F', logic: 'and', conditions: [{ columnId, operator, value }] }
      const result = evaluateFilterRows(base, step)
      expect(result.frame?.rows.length, `operator ${operator}`).toBe(expectedCount)
    }
  })

  it('combines conditions with AND / OR', () => {
    const andStep: FilterRowsStep = {
      id: 's1',
      kind: 'filter-rows',
      name: 'F',
      logic: 'and',
      conditions: [{ columnId: 'c2', operator: 'equals', value: 'Spain' }, { columnId: 'c1', operator: 'is-not-blank' }],
    }
    expect(evaluateFilterRows(base, andStep).frame?.rows.length).toBe(1)

    const orStep: FilterRowsStep = {
      id: 's1',
      kind: 'filter-rows',
      name: 'F',
      logic: 'or',
      conditions: [{ columnId: 'c1', operator: 'greater-than', value: 400 }, { columnId: 'c3', operator: 'is-blank' }],
    }
    expect(evaluateFilterRows(base, orStep).frame?.rows.length).toBe(2)
  })

  it('fails with QUERY_COLUMN_NOT_FOUND when the filtered column no longer exists', () => {
    const step: FilterRowsStep = { id: 's1', kind: 'filter-rows', name: 'F', logic: 'and', conditions: [{ columnId: 'missing', operator: 'equals', value: 1 }] }
    expect(evaluateFilterRows(base, step).diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
  })
})

describe('replace-values', () => {
  it('replaces a string value, a number value, and null, across multiple selected columns', () => {
    const columns = [col('c1', 'Country'), col('c2', 'Score', 'integer')]
    const base = frame(columns, [{ Country: 'ES ', Score: 0 }, { Country: null, Score: null }])
    const step: ReplaceValuesStep = {
      id: 's1',
      kind: 'replace-values',
      name: 'Replaced',
      replacements: [
        { columnId: 'c1', find: 'ES ', replace: 'ES' },
        { columnId: 'c1', find: null, replace: 'Unknown' },
        { columnId: 'c2', find: null, replace: -1 },
      ],
    }
    const result = evaluateReplaceValues(base, step)
    expect(result.frame?.rows).toEqual([{ Country: 'ES', Score: 0 }, { Country: 'Unknown', Score: -1 }])
  })

  it('is a no-op when nothing matches', () => {
    const columns = [col('c1', 'Country')]
    const base = frame(columns, [{ Country: 'US' }])
    const step: ReplaceValuesStep = { id: 's1', kind: 'replace-values', name: 'Replaced', replacements: [{ columnId: 'c1', find: 'ES', replace: 'Spain' }] }
    expect(evaluateReplaceValues(base, step).frame?.rows).toEqual([{ Country: 'US' }])
  })

  it('rejects a replacement value incompatible with the column type', () => {
    const columns = [col('c1', 'Score', 'integer')]
    const base = frame(columns, [{ Score: 1 }])
    const step: ReplaceValuesStep = { id: 's1', kind: 'replace-values', name: 'Replaced', replacements: [{ columnId: 'c1', find: 1, replace: 'not a number' }] }
    expect(evaluateReplaceValues(base, step).diagnostics[0].code).toBe('QUERY_INVALID_STEP_CONFIG')
  })
})

describe('remove-duplicates', () => {
  it('dedupes by one key, keeping the first occurrence', () => {
    const columns = [col('c1', 'CustomerID', 'integer'), col('c2', 'Name')]
    const base = frame(columns, [{ CustomerID: 1, Name: 'A' }, { CustomerID: 1, Name: 'A-dup' }, { CustomerID: 2, Name: 'B' }])
    const step: RemoveDuplicatesStep = { id: 's1', kind: 'remove-duplicates', name: 'Deduped', columnIds: ['c1'] }
    expect(evaluateRemoveDuplicates(base, step).frame?.rows).toEqual([{ CustomerID: 1, Name: 'A' }, { CustomerID: 2, Name: 'B' }])
  })

  it('dedupes by multiple keys', () => {
    const columns = [col('c1', 'A', 'integer'), col('c2', 'B', 'integer')]
    const base = frame(columns, [{ A: 1, B: 1 }, { A: 1, B: 2 }, { A: 1, B: 1 }])
    const step: RemoveDuplicatesStep = { id: 's1', kind: 'remove-duplicates', name: 'Deduped', columnIds: ['c1', 'c2'] }
    expect(evaluateRemoveDuplicates(base, step).frame?.rows.length).toBe(2)
  })

  it('dedupes by all columns when none are selected', () => {
    const columns = [col('c1', 'A', 'integer')]
    const base = frame(columns, [{ A: 1 }, { A: 1 }, { A: 2 }])
    const step: RemoveDuplicatesStep = { id: 's1', kind: 'remove-duplicates', name: 'Deduped' }
    expect(evaluateRemoveDuplicates(base, step).frame?.rows).toEqual([{ A: 1 }, { A: 2 }])
  })

  it('treats null as its own matching value', () => {
    const columns = [col('c1', 'A', 'integer')]
    const base = frame(columns, [{ A: null }, { A: null }, { A: 1 }])
    const step: RemoveDuplicatesStep = { id: 's1', kind: 'remove-duplicates', name: 'Deduped', columnIds: ['c1'] }
    expect(evaluateRemoveDuplicates(base, step).frame?.rows).toEqual([{ A: null }, { A: 1 }])
  })
})

describe('sort-rows', () => {
  it('sorts ascending and descending', () => {
    const columns = [col('c1', 'Revenue', 'decimal')]
    const base = frame(columns, [{ Revenue: 3 }, { Revenue: 1 }, { Revenue: 2 }])
    const asc: SortRowsStep = { id: 's1', kind: 'sort-rows', name: 'Sorted', keys: [{ columnId: 'c1', direction: 'asc' }] }
    expect(evaluateSortRows(base, asc).frame?.rows.map((r) => r.Revenue)).toEqual([1, 2, 3])
    const desc: SortRowsStep = { id: 's1', kind: 'sort-rows', name: 'Sorted', keys: [{ columnId: 'c1', direction: 'desc' }] }
    expect(evaluateSortRows(base, desc).frame?.rows.map((r) => r.Revenue)).toEqual([3, 2, 1])
  })

  it('sorts by multiple keys, stably', () => {
    const columns = [col('c1', 'Date', 'date'), col('c2', 'Revenue', 'decimal')]
    const base = frame(columns, [
      { Date: '2024-02-01', Revenue: 10 },
      { Date: '2024-01-01', Revenue: 5 },
      { Date: '2024-01-01', Revenue: 20 },
    ])
    const step: SortRowsStep = { id: 's1', kind: 'sort-rows', name: 'Sorted', keys: [{ columnId: 'c1', direction: 'asc' }, { columnId: 'c2', direction: 'desc' }] }
    expect(evaluateSortRows(base, step).frame?.rows).toEqual([
      { Date: '2024-01-01', Revenue: 20 },
      { Date: '2024-01-01', Revenue: 5 },
      { Date: '2024-02-01', Revenue: 10 },
    ])
  })

  it('sorts blanks first ascending', () => {
    const columns = [col('c1', 'Revenue', 'decimal')]
    const base = frame(columns, [{ Revenue: 1 }, { Revenue: null }])
    const step: SortRowsStep = { id: 's1', kind: 'sort-rows', name: 'Sorted', keys: [{ columnId: 'c1', direction: 'asc' }] }
    expect(evaluateSortRows(base, step).frame?.rows.map((r) => r.Revenue)).toEqual([null, 1])
  })
})

describe('fill', () => {
  it('fills down, only over blanks', () => {
    const columns = [col('c1', 'Category')]
    const base = frame(columns, [{ Category: 'A' }, { Category: null }, { Category: null }, { Category: 'B' }, { Category: null }])
    const step: FillStep = { id: 's1', kind: 'fill', name: 'Filled Down', direction: 'down', columnIds: ['c1'] }
    expect(evaluateFill(base, step).frame?.rows.map((r) => r.Category)).toEqual(['A', 'A', 'A', 'B', 'B'])
  })

  it('fills up', () => {
    const columns = [col('c1', 'Category')]
    const base = frame(columns, [{ Category: null }, { Category: 'A' }, { Category: null }])
    const step: FillStep = { id: 's1', kind: 'fill', name: 'Filled Up', direction: 'up', columnIds: ['c1'] }
    expect(evaluateFill(base, step).frame?.rows.map((r) => r.Category)).toEqual(['A', 'A', null])
  })

  it('never treats 0, false, or empty string as blank', () => {
    const columns = [col('c1', 'Value')]
    const base = frame(columns, [{ Value: 0 }, { Value: null }, { Value: false }, { Value: null }, { Value: '' }])
    const step: FillStep = { id: 's1', kind: 'fill', name: 'Filled Down', direction: 'down', columnIds: ['c1'] }
    expect(evaluateFill(base, step).frame?.rows.map((r) => r.Value)).toEqual([0, 0, false, false, ''])
  })

  it('leaves leading blanks with no prior value untouched', () => {
    const columns = [col('c1', 'Value')]
    const base = frame(columns, [{ Value: null }, { Value: null }, { Value: 5 }])
    const step: FillStep = { id: 's1', kind: 'fill', name: 'Filled Down', direction: 'down', columnIds: ['c1'] }
    expect(evaluateFill(base, step).frame?.rows.map((r) => r.Value)).toEqual([null, null, 5])
  })
})
