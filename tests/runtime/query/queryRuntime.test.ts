import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { QueryDefinition } from '../../../src/domain/query'
import {
  addQueryStep,
  createQueryDefinition,
  evaluateAllQueries,
  findDependentQueryIds,
  frameAtStep,
  moveQueryStep,
  removeQueryStep,
  renameQuery,
  setQueryLoadEnabled,
  updateQueryStep,
} from '../../../src/runtime/query/queryRuntime'

function dataset(id: string, tableId: string, columnNames: string[], rows: Record<string, unknown>[]): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [
      {
        id: tableId,
        name: id,
        columns: columnNames.map((name) => ({ id: `${tableId}-${name}`, name, dataType: typeof rows[0]?.[name] === 'number' ? 'integer' : 'string', nullable: true })),
        rows,
        rowCount: rows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

describe('queryRuntime end-to-end evaluation', () => {
  const salesDataset = dataset('sales-ds', 'sales-table', ['OrderID', 'Revenue'], [{ OrderID: 1, Revenue: 10 }, { OrderID: 2, Revenue: 0 }, { OrderID: 3, Revenue: 30 }])

  it('evaluates a single query and preserves output identity across re-evaluation', () => {
    let query = createQueryDefinition('Sales Clean', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    query = addQueryStep(query, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-table-Revenue', operator: 'greater-than', value: 0 }] })

    const firstRun = evaluateAllQueries({ [query.id]: query }, { 'sales-ds': salesDataset })
    const firstOutputId = firstRun[query.id].output?.id
    expect(firstRun[query.id].output?.tables[0].rowCount).toBe(2)

    const secondQuery = addQueryStep(query, { kind: 'sort-rows', keys: [{ columnId: 'sales-table-OrderID', direction: 'desc' }] })
    const secondRun = evaluateAllQueries({ [secondQuery.id]: secondQuery }, { 'sales-ds': salesDataset })

    expect(secondRun[secondQuery.id].output?.id).toBe(firstOutputId)
    expect(secondRun[secondQuery.id].output?.tables[0].id).toBe(query.outputTableId)
  })

  it('stops the pipeline at the first failing step and marks downstream steps skipped', () => {
    // Renaming preserves the column id (brief §7), so it never breaks a later step referencing
    // that id — only removing a column a later step still points at does (brief §15).
    let query = createQueryDefinition('Broken', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    query = addQueryStep(query, { kind: 'rename-columns', renames: [{ columnId: 'sales-table-OrderID', newName: 'Order Key' }] })
    query = addQueryStep(query, { kind: 'remove-columns', columnIds: ['sales-table-Revenue'] })
    query = addQueryStep(query, { kind: 'sort-rows', keys: [{ columnId: 'sales-table-Revenue', direction: 'asc' }] })
    query = addQueryStep(query, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-table-OrderID', operator: 'greater-than', value: 1 }] })

    const result = evaluateAllQueries({ [query.id]: query }, { 'sales-ds': salesDataset })[query.id]

    expect(result.status).toBe('error')
    expect(result.stepResults[0].status).toBe('success')
    expect(result.stepResults[1].status).toBe('success')
    expect(result.stepResults[2].status).toBe('error')
    expect(result.stepResults[2].diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
    expect(result.stepResults[3].status).toBe('skipped')
    // The output still reflects the last successfully-executed step (Source -> Renamed -> Removed), never crashes.
    expect(result.output?.tables[0].columns.map((c) => c.name)).toEqual(['Order Key'])
  })

  it('lets a query source from another query, propagating edits', () => {
    let sales = createQueryDefinition('Sales Base', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    sales = addQueryStep(sales, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-table-Revenue', operator: 'greater-than', value: 0 }] })
    const derived = createQueryDefinition('Sales Sorted', { kind: 'query', queryId: sales.id })
    const derivedWithStep = addQueryStep(derived, { kind: 'sort-rows', keys: [{ columnId: 'sales-table-OrderID', direction: 'desc' }] })

    const queries: Record<string, QueryDefinition> = { [sales.id]: sales, [derivedWithStep.id]: derivedWithStep }
    const results = evaluateAllQueries(queries, { 'sales-ds': salesDataset })

    expect(results[derivedWithStep.id].output?.tables[0].rowCount).toBe(2)
    expect(results[derivedWithStep.id].output?.tables[0].rows.map((r) => r.OrderID)).toEqual([3, 1])

    // Editing the upstream query changes the derived query's fingerprint.
    const tightened = updateQueryStep(sales, sales.steps[0].id, { conditions: [{ columnId: 'sales-table-Revenue', operator: 'greater-than', value: 20 }] })
    const queries2 = { ...queries, [tightened.id]: tightened }
    const results2 = evaluateAllQueries(queries2, { 'sales-ds': salesDataset })
    expect(results2[derivedWithStep.id].fingerprint).not.toBe(results[derivedWithStep.id].fingerprint)
    expect(results2[derivedWithStep.id].output?.tables[0].rowCount).toBe(1)
  })

  it('exposes the frame as of each step for "select an applied step"', () => {
    let query = createQueryDefinition('Sales', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    query = addQueryStep(query, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-table-Revenue', operator: 'greater-than', value: 0 }] })
    const result = evaluateAllQueries({ [query.id]: query }, { 'sales-ds': salesDataset })[query.id]

    expect(frameAtStep(result, 0)?.rows).toHaveLength(3) // Source
    expect(frameAtStep(result, 1)?.rows).toHaveLength(2) // after Filter Rows
  })

  it('rename/remove/move/delete mutate steps without touching evaluation', () => {
    let query = createQueryDefinition('Q', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    query = addQueryStep(query, { kind: 'sort-rows', keys: [{ columnId: 'sales-table-OrderID', direction: 'asc' }] })
    query = addQueryStep(query, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-table-Revenue', operator: 'greater-than', value: 0 }] })

    const sortStepId = query.steps[0].id
    const filterStepId = query.steps[1].id

    const moved = moveQueryStep(query, filterStepId, 0)
    expect(moved.steps.map((s) => s.id)).toEqual([filterStepId, sortStepId])

    const removed = removeQueryStep(query, sortStepId)
    expect(removed.steps.map((s) => s.id)).toEqual([filterStepId])

    const renamed = renameQuery(query, 'New Name')
    expect(renamed.name).toBe('New Name')

    const disabled = setQueryLoadEnabled(query, false)
    expect(disabled.loadEnabled).toBe(false)
  })

  it('findDependentQueryIds finds queries referencing another via source/merge/append', () => {
    const a = createQueryDefinition('A', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    const b = createQueryDefinition('B', { kind: 'query', queryId: a.id })
    const queries = { [a.id]: a, [b.id]: b }
    expect(findDependentQueryIds(queries, a.id)).toEqual([b.id])
    expect(findDependentQueryIds(queries, b.id)).toEqual([])
  })

  it('enforces QUERY_ROW_LIMIT_EXCEEDED via the shared limits parameter', () => {
    let query = createQueryDefinition('Q', { kind: 'dataset-table', datasetId: 'sales-ds', tableId: 'sales-table' })
    query = addQueryStep(query, { kind: 'sort-rows', keys: [{ columnId: 'sales-table-OrderID', direction: 'asc' }] })
    const result = evaluateAllQueries({ [query.id]: query }, { 'sales-ds': salesDataset }, { maxRowsPerTable: 1, maxColumns: 200 })[query.id]
    expect(result.status).toBe('error')
    expect(result.diagnostics.some((d) => d.code === 'QUERY_ROW_LIMIT_EXCEEDED')).toBe(true)
  })
})
