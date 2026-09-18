import { describe, expect, it } from 'vitest'
import { resolveColumnRef } from '../../../src/runtime/model/modelRuntime'
import { buildStarSchemaFixture } from './starSchemaFixture'

/**
 * Regression coverage for the Sprint 4 bug the brief calls out explicitly
 * (§42): a `ColumnFilter`'s `ColumnRef.tableId` must be the *physical*
 * `DataTable.id` (`modelTable.tableId`), never the `ModelTable` wrapper's
 * own generated id (`modelTable.id`). `ContextFilterEditor.handleAddFilter`
 * (the Sprint 6 generalization of the Sprint 4 `FilterContextPanel`) builds
 * filters exactly the first way — this test locks that contract in place
 * headlessly, since there's no component-test harness in this repo
 * (vitest runs in a Node environment, not jsdom).
 */
describe('reusable filter editor: ColumnRef construction regression', () => {
  it('resolves a filter built from ModelTable.datasetId/tableId (the correct construction)', () => {
    const { model, datasets, customersTableId, countryColumn } = buildStarSchemaFixture()
    const modelTable = model.tables.find((t) => t.id === customersTableId)!

    const correctlyBuiltRef = { datasetId: modelTable.datasetId, tableId: modelTable.tableId, columnId: countryColumn.id }
    const resolved = resolveColumnRef(datasets, correctlyBuiltRef)

    expect(resolved).toBeDefined()
    expect(resolved!.table.name).toBe('Customers')
    expect(resolved!.column.name).toBe('Country')
  })

  it('fails to resolve if the ModelTable wrapper id were used as tableId instead (the historical bug)', () => {
    const { model, datasets, customersTableId, countryColumn } = buildStarSchemaFixture()
    const modelTable = model.tables.find((t) => t.id === customersTableId)!

    // The bug: using modelTable.id (a "modeltable-..." generated id) as the ColumnRef's tableId,
    // instead of modelTable.tableId (the physical DataTable id it wraps).
    const incorrectlyBuiltRef = { datasetId: modelTable.datasetId, tableId: modelTable.id, columnId: countryColumn.id }
    const resolved = resolveColumnRef(datasets, incorrectlyBuiltRef)

    expect(resolved).toBeUndefined()
  })
})
