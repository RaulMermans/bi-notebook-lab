import { describe, expect, it } from 'vitest'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { runBarVisual } from '../../../src/runtime/visual/visualQuery'
import { runKpiVisual } from '../../../src/runtime/visual/visualRuntime'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

const productCategory = { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }

/**
 * Sprint 8 Visual Cells integration (sprint brief §40-§41): existing visuals
 * must automatically support CALCULATE measures with **no visual-specific
 * CALCULATE code** — every number still comes from the unmodified
 * `evaluateMeasure` (docs/CALCULATE.md "Visual Cells integration").
 */
describe('Visual Cells — CALCULATE integration', () => {
  function withSpainRevenue(fixture: ReturnType<typeof buildStarSchemaFixture>) {
    const result = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Spain Revenue',
      expression: 'CALCULATE([Total Revenue], Customers[Country] = "Spain")',
    })
    expect(result.diagnostics).toEqual([])
    return { ...fixture, model: result.model, spainRevenueId: result.measure!.id }
  }

  it('KPI shows Spain Revenue under a France slicer (slicer override, sprint brief §41)', () => {
    const fixture = withSpainRevenue(buildStarSchemaFixture())
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: fixture.countryColumn.id }
    const franceSlicer = { filters: [{ column: country, operator: 'equals' as const, values: ['France'] }] }

    const totalUnderFrance = runKpiVisual(fixture.model, fixture.datasets, { id: 'kpi-total', type: 'kpi', measureId: fixture.measureId }, franceSlicer)
    const spainUnderFranceSlicer = runKpiVisual(
      fixture.model,
      fixture.datasets,
      { id: 'kpi-spain', type: 'kpi', measureId: fixture.spainRevenueId },
      franceSlicer,
    )

    expect(totalUnderFrance.value).toBe(230) // France: orders 2, 5 => 200+30
    expect(spainUnderFranceSlicer.status).toBe('success')
    expect(spainUnderFranceSlicer.value).toBe(230) // Spain: orders 1, 3, 4 => 100+50+80 — NOT blank
  })

  it('a grouped Bar visual combines the chart dimension with the internal CALCULATE context', () => {
    const fixture = withSpainRevenue(buildStarSchemaFixture())
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: fixture.countryColumn.id }
    // Shared notebook context says France; each bar member additionally constrains Category.
    const franceSlicer = { filters: [{ column: country, operator: 'equals' as const, values: ['France'] }] }

    const result = runBarVisual(
      fixture.model,
      fixture.datasets,
      { id: 'v1', type: 'bar', category: productCategory, measureId: fixture.spainRevenueId, sort: 'category-asc' },
      franceSlicer,
    )

    expect(result.status).toBe('success')
    // Spain customers 1 & 3: order 1 (Furniture, 100), order 3 (Furniture, 50), order 4 (Electronics, 80).
    expect(result.rows.map((r) => [r.dimensionLabel, r.measureValues[fixture.spainRevenueId]])).toEqual([
      ['Electronics', 80],
      ['Furniture', 150],
    ])
  })
})
