import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'
import { resolveFilterContext } from '../../../src/runtime/measure/filterPropagation'
import type { FilterContext } from '../../../src/runtime/measure/filterContext'

/**
 * Products (*) <-> Targets (*) via Category — duplicates on both sides
 * (sprint brief §39/§42). Real `DataTable`s, not mocked row sets.
 */
function buildFixture(direction: 'left-to-right' | 'right-to-left' | 'both') {
  const productsDs: Dataset = {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [
          { id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'products-category', name: 'Category', dataType: 'string', nullable: false },
        ],
        rows: [
          { ProductID: 1, Category: 'Electronics' },
          { ProductID: 2, Category: 'Electronics' },
          { ProductID: 3, Category: 'Furniture' },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const targetsDs: Dataset = {
    id: 'targets-ds',
    name: 'Targets',
    source: { type: 'sample', key: 'targets' },
    tables: [
      {
        id: 'targets-table',
        name: 'Targets',
        columns: [
          { id: 'targets-region', name: 'Region', dataType: 'string', nullable: false },
          { id: 'targets-category', name: 'Category', dataType: 'string', nullable: false },
        ],
        rows: [
          { Region: 'North', Category: 'Electronics' },
          { Region: 'South', Category: 'Electronics' },
          { Region: 'North', Category: 'Furniture' },
          { Region: 'East', Category: 'Office' }, // no matching Products row — blank-key regression coverage
        ],
        rowCount: 4,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [productsDs.id]: productsDs, [targetsDs.id]: targetsDs }
  let model = addTable(createModel(), { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: targetsDs.id, tableId: 'targets-table' })
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
  const targetsTableId = model.tables.find((t) => t.datasetId === targetsDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-category' },
      right: { datasetId: targetsDs.id, tableId: 'targets-table', columnId: 'targets-category' },
      cardinality: 'many-to-many',
      crossFilterDirection: direction,
      active: true,
    },
    datasets,
  )
  expect(rel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = rel.model

  return { model, datasets, productsDs, targetsDs, productsTableId, targetsTableId }
}

describe('many-to-many propagation (sprint 11 §39, §42, §64)', () => {
  it('left -> right: filtering Products by Category narrows Targets to matching-category rows, duplicates and all', () => {
    const { model, datasets, productsDs, targetsTableId } = buildFixture('left-to-right')
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-category' }, operator: 'equals', values: ['Electronics'] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    const visible = [...(state.rowSelections.get(targetsTableId) ?? [])].sort()
    expect(visible).toEqual([0, 1]) // North/Electronics, South/Electronics
  })

  it('right -> left: filtering Targets by Region narrows Products to the categories that region targets', () => {
    const { model, datasets, targetsDs, productsTableId } = buildFixture('right-to-left')
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: targetsDs.id, tableId: 'targets-table', columnId: 'targets-region' }, operator: 'equals', values: ['South'] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    const visible = [...(state.rowSelections.get(productsTableId) ?? [])].sort()
    expect(visible).toEqual([0, 1]) // South only targets Electronics -> ProductID 1 and 2
  })

  it('both: a Products filter reaches Targets AND a Targets filter reaches Products in the same model', () => {
    const { model, datasets, productsDs, targetsDs, productsTableId, targetsTableId } = buildFixture('both')

    const fromProducts: FilterContext = {
      filters: [{ column: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-category' }, operator: 'equals', values: ['Furniture'] }],
    }
    const stateA = resolveFilterContext(model, datasets, fromProducts)
    expect([...(stateA.rowSelections.get(targetsTableId) ?? [])]).toEqual([2]) // North/Furniture

    const fromTargets: FilterContext = {
      filters: [{ column: { datasetId: targetsDs.id, tableId: 'targets-table', columnId: 'targets-region' }, operator: 'equals', values: ['North'] }],
    }
    const stateB = resolveFilterContext(model, datasets, fromTargets)
    const visibleProducts = [...(stateB.rowSelections.get(productsTableId) ?? [])].sort()
    expect(visibleProducts).toEqual([0, 1, 2]) // North targets both Electronics and Furniture -> all 3 products
  })

  it('no matching keys (a category present only on one side) resolves to zero visible rows, not an error', () => {
    const { model, datasets, targetsDs, productsTableId } = buildFixture('right-to-left')
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: targetsDs.id, tableId: 'targets-table', columnId: 'targets-region' }, operator: 'equals', values: ['East'] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    expect([...(state.rowSelections.get(productsTableId) ?? [])]).toEqual([]) // Office has no matching Products row
  })
})
