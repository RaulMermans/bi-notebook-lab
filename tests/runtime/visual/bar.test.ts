import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { runBarVisual } from '../../../src/runtime/visual/visualQuery'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

const productCategory = { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }

describe('runBarVisual', () => {
  it('returns expected category/value pairs (semantic output, not chart markup)', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const result = runBarVisual(model, datasets, { id: 'v1', type: 'bar', category: productCategory, measureId, sort: 'category-asc' }, EMPTY_FILTER_CONTEXT)

    expect(result.status).toBe('success')
    expect(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]])).toEqual([
      ['Electronics', 280],
      ['Furniture', 180],
    ])
  })

  it('defaults to value-descending sort', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const result = runBarVisual(model, datasets, { id: 'v1', type: 'bar', category: productCategory, measureId }, EMPTY_FILTER_CONTEXT)
    expect(result.rows.map((r) => r.dimensionLabel)).toEqual(['Electronics', 'Furniture'])
  })

  it('reports VISUAL_MEASURE_NOT_FOUND when the referenced measure is gone', () => {
    const { model, datasets } = buildStarSchemaFixture()
    const result = runBarVisual(model, datasets, { id: 'v1', type: 'bar', category: productCategory, measureId: 'missing' }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('error')
    expect(result.diagnostics[0]?.code).toBe('VISUAL_MEASURE_NOT_FOUND')
  })

  it('reports VISUAL_COLUMN_NOT_FOUND when the category column is gone', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const result = runBarVisual(
      model,
      datasets,
      { id: 'v1', type: 'bar', category: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'missing' }, measureId },
      EMPTY_FILTER_CONTEXT,
    )
    expect(result.status).toBe('error')
    expect(result.diagnostics[0]?.code).toBe('VISUAL_COLUMN_NOT_FOUND')
  })

  it('respects the shared notebook filter context (Country = Spain narrows every category)', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const context = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const result = runBarVisual(model, datasets, { id: 'v1', type: 'bar', category: productCategory, measureId, sort: 'category-asc' }, context)
    expect(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]])).toEqual([
      ['Electronics', 80],
      ['Furniture', 150],
    ])
  })
})
