import { describe, expect, it } from 'vitest'
import { analyzeMeasureContext } from '../../../src/runtime/context/contextAnalysis'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildStarSchemaFixture } from './starSchemaFixture'

/**
 * Sprint 8 Context Explorer integration (sprint brief §38-§39): a CALCULATE
 * measure's diagram must reflect its *internal* (CALCULATE-modified) context,
 * not just the external filter the learner set — "Do not hide
 * CALCULATE-generated filters." See docs/CALCULATE.md "Context Explorer
 * integration" for the documented, bounded scope of this substitution.
 */
describe('Context Explorer — CALCULATE integration', () => {
  it('shows the internal Spain context in the diagram even under an external France filter', () => {
    const { model, datasets, customersTableId, countryColumn } = buildStarSchemaFixture()
    const spainRevenue = createMeasure(model, datasets, {
      homeModelTableId: model.tables.find((t) => t.id === customersTableId)!.id,
      name: 'Spain Revenue',
      expression: 'CALCULATE([Total Revenue], Customers[Country] = "Spain")',
    })
    expect(spainRevenue.diagnostics).toEqual([])

    const franceFilter = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['France'] }],
    }

    const analysis = analyzeMeasureContext({
      model: spainRevenue.model,
      datasets,
      measureId: spainRevenue.measure!.id,
      filterContext: franceFilter,
    })

    // The learner's own external selection is still reported as-is...
    expect(analysis.filters).toEqual(franceFilter.filters)
    // ...but the result and diagram reflect what CALCULATE actually did: Spain, not France.
    expect(analysis.current.value).toBe(230) // Spain: orders 1, 3, 4
    const customers = analysis.tables!.find((t) => t.modelTableId === customersTableId)!
    expect(customers.visibleRows).toBe(2) // the two Spain customers, not the one France customer

    // The trace exposes the CALCULATE modification explicitly (never hidden).
    const calculateNode = analysis.current.trace!.children!.find((c) => c.kind === 'calculate')
    expect(calculateNode).toBeDefined()
  })

  it('REMOVEFILTERS-based measure shows the grand-total diagram even under a Country slicer', () => {
    const { model, datasets, customersTableId, countryColumn } = buildStarSchemaFixture()
    const revenueAllCountries = createMeasure(model, datasets, {
      homeModelTableId: model.tables.find((t) => t.id === customersTableId)!.id,
      name: 'Revenue All Countries',
      expression: 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))',
    })
    expect(revenueAllCountries.diagnostics).toEqual([])

    const spainFilter = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }
    const analysis = analyzeMeasureContext({
      model: revenueAllCountries.model,
      datasets,
      measureId: revenueAllCountries.measure!.id,
      filterContext: spainFilter,
    })

    expect(analysis.current.value).toBe(460) // grand total, Country filter removed internally
    const customers = analysis.tables!.find((t) => t.modelTableId === customersTableId)!
    expect(customers.visibleRows).toBe(customers.totalRows) // fully unfiltered again
  })
})
