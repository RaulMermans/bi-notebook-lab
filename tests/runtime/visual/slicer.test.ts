import { describe, expect, it } from 'vitest'
import { mergeFilterContexts } from '../../../src/runtime/measure/filterContext'
import { buildSlicerFilter, runSlicerMembers } from '../../../src/runtime/visual/visualRuntime'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

describe('runSlicerMembers', () => {
  it('resolves the real distinct values of the underlying column', () => {
    const { datasets, countryColumn } = buildStarSchemaFixture()
    const column = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const members = runSlicerMembers(datasets, { column })
    expect(members?.values.sort()).toEqual(['France', 'Spain'])
  })
})

describe('buildSlicerFilter', () => {
  const column = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }

  it('single select emits an `equals` filter with exactly the datasetId/tableId/columnId of the source column', () => {
    const filter = buildSlicerFilter(column, ['Spain'], 'single')
    expect(filter).toEqual({ column, operator: 'equals', values: ['Spain'] })
  })

  it('multi select emits an `in` filter over every selected value', () => {
    const filter = buildSlicerFilter(column, ['Spain', 'France'], 'multi')
    expect(filter).toEqual({ column, operator: 'in', values: ['Spain', 'France'] })
  })

  it('clearing (empty selection) means "All" — no filter at all', () => {
    const filter = buildSlicerFilter(column, [], 'single')
    expect(filter).toBeUndefined()
  })

  it('never emits a ModelTable.id in place of the physical datasetId/tableId (Sprint 4 regression)', () => {
    const { model: starModel, countryColumn } = buildStarSchemaFixture()
    const customersModelTable = starModel.tables.find((t) => t.datasetId === 'customers-ds')!
    const realColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }

    const filter = buildSlicerFilter(realColumn, ['Spain'], 'single')!

    // The emitted filter must use the dataset's own table id, never the generated ModelTable.id.
    expect(filter.column.tableId).not.toBe(customersModelTable.id)
    expect(filter.column.tableId).toBe('customers-table')
    expect(filter.column.datasetId).toBe('customers-ds')
    expect(filter.column).toEqual(realColumn)
  })

  it('multiple slicers combine with AND semantics via mergeFilterContexts', () => {
    const countryFilter = buildSlicerFilter(column, ['Spain'], 'single')!
    const categoryColumn = { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }
    const categoryFilter = buildSlicerFilter(categoryColumn, ['Furniture'], 'single')!

    const merged = [countryFilter, categoryFilter].reduce((ctx, filter) => mergeFilterContexts(ctx, { filters: [filter] }), { filters: [] })
    expect(merged.filters).toHaveLength(2)
    expect(merged.filters).toContainEqual(countryFilter)
    expect(merged.filters).toContainEqual(categoryFilter)
  })

  it('clearing one slicer removes only its own filter, leaving the other slicer active', () => {
    // Simulates the App-level `bySlicer` map: keyed by slicer cell id, not by column.
    const bySlicer: Record<string, ReturnType<typeof buildSlicerFilter>> = {
      'slicer-country': buildSlicerFilter(column, ['Spain'], 'single'),
      'slicer-category': buildSlicerFilter({ datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, ['Furniture'], 'single'),
    }

    delete bySlicer['slicer-category']

    const remaining = Object.values(bySlicer).filter((f): f is NonNullable<typeof f> => Boolean(f))
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.column.columnId).toBe('customer-country')
  })
})
