import { describe, expect, it } from 'vitest'
import { evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildBeginnerExplanation, buildContextNarrative } from '../../../src/runtime/context/narrative'
import { buildStarSchemaFixture } from './starSchemaFixture'

describe('context narrative', () => {
  it('reports "no filter propagation" when the context has no filters', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const execution = evaluateMeasure(model, datasets, measureId)

    const narrative = buildContextNarrative('Total Revenue', execution.value, execution.filterState!, execution.trace)
    expect(narrative[0].description).toContain('No filters')

    const explanation = buildBeginnerExplanation('Total Revenue', execution.value, execution.filterState!)
    expect(explanation).toContain('460')
  })

  it('describes the real direct filter and propagation step, not a hardcoded string', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }
    const execution = evaluateMeasure(model, datasets, measureId, filterContext)

    const narrative = buildContextNarrative('Total Revenue', execution.value, execution.filterState!, execution.trace)
    const descriptions = narrative.map((s) => s.description)

    expect(descriptions.some((d) => d.includes('Customers filtered by Country = Spain'))).toBe(true)
    expect(descriptions.some((d) => d.includes('CustomerID filter propagated from Customers to Sales'))).toBe(true)
    expect(descriptions.some((d) => d.includes('Result: Total Revenue = 230'))).toBe(true)

    const explanation = buildBeginnerExplanation('Total Revenue', execution.value, execution.filterState!)
    expect(explanation).toContain('Country = Spain filters Customers')
    expect(explanation).toContain('230')
  })
})
