import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { runTableVisual } from '../../../src/runtime/visual/visualRuntime'
import { withAverageOrderValue } from '../context/starSchemaFixture'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

describe('runTableVisual', () => {
  it('evaluates dimension + one measure', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const result = runTableVisual(model, datasets, { id: 'v1', type: 'table', dimension: country, measureIds: [measureId] }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('success')
    const byCountry = Object.fromEntries(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    expect(byCountry.Spain).toBe(230)
    expect(byCountry.France).toBe(230)
  })

  it('evaluates dimension + multiple measures, evaluated under the same member context', () => {
    const { model, datasets, measureId, salesTableId, countryColumn } = buildStarSchemaFixture()
    const { model: withMeasures, averageOrderValueId } = withAverageOrderValue(model, datasets, salesTableId)
    const ordersId = withMeasures.measures.find((m) => m.name === 'Orders')!.id
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }

    const result = runTableVisual(
      withMeasures,
      datasets,
      { id: 'v1', type: 'table', dimension: country, measureIds: [measureId, ordersId, averageOrderValueId] },
      EMPTY_FILTER_CONTEXT,
    )

    const spainRow = result.rows.find((r) => r.dimensionLabel === 'Spain')!
    expect(spainRow.measureValues[measureId]).toBe(230)
    expect(spainRow.measureValues[ordersId]).toBe(3)
    expect(spainRow.measureValues[averageOrderValueId]).toBeCloseTo(230 / 3)
  })

  it('evaluates one row per measure when no dimension is configured', () => {
    const { model, datasets, measureId, salesTableId } = buildStarSchemaFixture()
    const { model: withMeasures, averageOrderValueId } = withAverageOrderValue(model, datasets, salesTableId)
    const ordersId = withMeasures.measures.find((m) => m.name === 'Orders')!.id

    const result = runTableVisual(withMeasures, datasets, { id: 'v1', type: 'table', measureIds: [measureId, ordersId, averageOrderValueId] }, EMPTY_FILTER_CONTEXT)

    expect(result.rows).toHaveLength(3)
    const totalRow = result.rows.find((r) => r.dimensionLabel === 'Total Revenue')!
    expect(totalRow.measureValues[measureId]).toBe(460)
    const ordersRow = result.rows.find((r) => r.dimensionLabel === 'Orders')!
    expect(ordersRow.measureValues[ordersId]).toBe(5)
  })

  it('applies the row limit', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const result = runTableVisual(model, datasets, { id: 'v1', type: 'table', dimension: country, measureIds: [measureId], limit: 1 }, EMPTY_FILTER_CONTEXT)
    expect(result.rows).toHaveLength(1)
    expect(result.truncated).toEqual({ shown: 1, total: 2 })
  })

  it('respects the current slicer/notebook context', () => {
    const { model, datasets, measureId, countryColumn, categoryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const category = { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }
    const context = { filters: [{ column: category, operator: 'equals' as const, values: ['Furniture'] }] }
    const result = runTableVisual(model, datasets, { id: 'v1', type: 'table', dimension: country, measureIds: [measureId] }, context)
    const byCountry = Object.fromEntries(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    expect(byCountry.Spain).toBe(150) // orders 1,3
    expect(byCountry.France).toBe(30) // order 5
  })
})
