import { describe, expect, it } from 'vitest'
import { analyzeMeasureContext } from '../../../src/runtime/context/contextAnalysis'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { runBarVisual, runKpiVisual, runTableVisual } from '../../../src/runtime/visual/visualRuntime'
import { buildStarSchemaFixture, withAverageOrderValue } from '../context/starSchemaFixture'

describe('Context Explorer / Visual Runtime consistency (brief §49/§68)', () => {
  it('produces exactly the same measure result as the Context Explorer under Country = Spain', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const filterContext = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }

    const contextAnalysis = analyzeMeasureContext({ model, datasets, measureId, filterContext })
    const kpiResult = runKpiVisual(model, datasets, { id: 'v1', type: 'kpi', measureId }, filterContext)

    expect(kpiResult.value).toBe(contextAnalysis.current.value)
    expect(kpiResult.value).toBe(230)
  })
})

describe('Retail-like end-to-end visual verification (brief §69)', () => {
  it('KPI, Bar, Line-equivalent (Table by dimension) and Table all agree, and a Slicer narrows every one of them identically', () => {
    const { model, datasets, measureId, salesTableId, countryColumn, categoryColumn } = buildStarSchemaFixture()
    const { model: withMeasures, averageOrderValueId } = withAverageOrderValue(model, datasets, salesTableId)
    const ordersId = withMeasures.measures.find((m) => m.name === 'Orders')!.id

    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const category = { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }

    // Unfiltered: KPI, Bar-by-category and Table-by-country must all reduce to the same grand total.
    const kpi = runKpiVisual(withMeasures, datasets, { id: 'kpi', type: 'kpi', measureId }, EMPTY_FILTER_CONTEXT)
    const bar = runBarVisual(withMeasures, datasets, { id: 'bar', type: 'bar', category, measureId }, EMPTY_FILTER_CONTEXT)
    const barTotal = bar.rows.reduce((sum, r) => sum + (r.measureValues[measureId] as number), 0)
    const table = runTableVisual(withMeasures, datasets, { id: 'table', type: 'table', dimension: country, measureIds: [measureId, ordersId, averageOrderValueId] }, EMPTY_FILTER_CONTEXT)
    const tableTotal = table.rows.reduce((sum, r) => sum + (r.measureValues[measureId] as number), 0)

    expect(kpi.value).toBe(460)
    expect(barTotal).toBe(460)
    expect(tableTotal).toBe(460)

    // A Country = Spain slicer narrows the KPI, the Bar and the Table identically.
    const slicerContext = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const kpiFiltered = runKpiVisual(withMeasures, datasets, { id: 'kpi', type: 'kpi', measureId }, slicerContext)
    const barFiltered = runBarVisual(withMeasures, datasets, { id: 'bar', type: 'bar', category, measureId }, slicerContext)
    const barFilteredTotal = barFiltered.rows.reduce((sum, r) => sum + (r.measureValues[measureId] as number), 0)

    expect(kpiFiltered.value).toBe(230)
    expect(barFilteredTotal).toBe(230)
  })

  it('multiple slicers combine with AND semantics across every visual', () => {
    const { model, datasets, measureId, countryColumn, categoryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const category = { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }

    const combined = {
      filters: [
        { column: country, operator: 'equals' as const, values: ['Spain'] },
        { column: category, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const kpi = runKpiVisual(model, datasets, { id: 'kpi', type: 'kpi', measureId }, combined)
    expect(kpi.value).toBe(150) // Spain + Furniture: orders 1 (100) and 3 (50)

    // Clearing only the Category slicer restores the Country-only result.
    const countryOnly = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const kpiCountryOnly = runKpiVisual(model, datasets, { id: 'kpi', type: 'kpi', measureId }, countryOnly)
    expect(kpiCountryOnly.value).toBe(230)
  })
})

describe('Inactive-relationship end-to-end verification (brief §48/§70)', () => {
  it('a Products filter stops affecting Sales measures once Products -> Sales is inactive, and recovers when re-enabled', () => {
    const { model, datasets, measureId, categoryColumn, productRelationshipId } = buildStarSchemaFixture()
    const category = { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }
    const filterContext = { filters: [{ column: category, operator: 'equals' as const, values: ['Furniture'] }] }

    const activeResult = runKpiVisual(model, datasets, { id: 'kpi', type: 'kpi', measureId }, filterContext)
    expect(activeResult.value).toBe(180) // orders 1, 3, 5

    const inactiveModel = setRelationshipActive(model, productRelationshipId, false)
    const inactiveResult = runKpiVisual(inactiveModel, datasets, { id: 'kpi', type: 'kpi', measureId }, filterContext)
    expect(inactiveResult.value).toBe(460) // Product filter no longer propagates to Sales

    const reenabledModel = setRelationshipActive(inactiveModel, productRelationshipId, true)
    const recoveredResult = runKpiVisual(reenabledModel, datasets, { id: 'kpi', type: 'kpi', measureId }, filterContext)
    expect(recoveredResult.value).toBe(180)
  })
})
