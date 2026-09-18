import { describe, expect, it } from 'vitest'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { runBarVisual } from '../../../src/runtime/visual/visualQuery'
import { runKpiVisual } from '../../../src/runtime/visual/visualRuntime'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

const productCategory = { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }

/**
 * Sprint 9 Visual Cells integration (sprint brief §52): an iterator or
 * conditional measure must automatically work in every existing Visual with
 * **no visual-specific implementation** — every number still comes from the
 * unmodified `evaluateMeasure` (docs/ITERATORS.md "Visual Cell integration").
 */
describe('Visual Cells — Sprint 9 iterator/conditional integration', () => {
  function withSelectedCountry(fixture: ReturnType<typeof buildStarSchemaFixture>) {
    const result = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Selected Country',
      expression: 'SELECTEDVALUE(Customers[Country], "Multiple Countries")',
    })
    expect(result.diagnostics).toEqual([])
    return { ...fixture, model: result.model, selectedCountryId: result.measure!.id }
  }

  it('a KPI shows SELECTEDVALUE reacting to a Country slicer', () => {
    const fixture = withSelectedCountry(buildStarSchemaFixture())
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: fixture.countryColumn.id }

    const allCountries = runKpiVisual(fixture.model, fixture.datasets, { id: 'kpi-1', type: 'kpi', measureId: fixture.selectedCountryId }, { filters: [] })
    expect(allCountries.value).toBe('Multiple Countries')

    const spainSlicer = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const spainOnly = runKpiVisual(fixture.model, fixture.datasets, { id: 'kpi-2', type: 'kpi', measureId: fixture.selectedCountryId }, spainSlicer)
    expect(spainOnly.value).toBe('Spain')
  })

  it('a grouped Bar visual computes an iterator (SUMX-based) measure per member', () => {
    const fixture = buildStarSchemaFixture()
    const grossMargin = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Gross Margin X',
      expression: 'SUMX(Sales, Sales[Revenue] * 0.5)',
    })
    expect(grossMargin.diagnostics).toEqual([])

    const result = runBarVisual(
      grossMargin.model,
      fixture.datasets,
      { id: 'v1', type: 'bar', category: productCategory, measureId: grossMargin.measure!.id, sort: 'category-asc' },
      { filters: [] },
    )

    expect(result.status).toBe('success')
    // Furniture (orders 1,3,5): revenue 100+50+30=180 -> 90; Electronics (orders 2,4): revenue 200+80=280 -> 140.
    expect(result.rows.map((r) => [r.dimensionLabel, r.measureValues[grossMargin.measure!.id]])).toEqual([
      ['Electronics', 140],
      ['Furniture', 90],
    ])
  })
})
