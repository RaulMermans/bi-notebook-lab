import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../../src/domain/model'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { runKpiVisual } from '../../../src/runtime/visual/visualRuntime'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

describe('runKpiVisual', () => {
  it('evaluates an unfiltered measure', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const result = runKpiVisual(model, datasets, { id: 'v1', type: 'kpi', measureId }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('success')
    expect(result.value).toBe(460) // 100+200+50+80+30
  })

  it('evaluates a filtered measure under the shared notebook context', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const context = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const result = runKpiVisual(model, datasets, { id: 'v1', type: 'kpi', measureId }, context)
    expect(result.status).toBe('success')
    expect(result.value).toBe(230) // orders 1,3,4 => 100+50+80
  })

  it('reports VISUAL_MEASURE_NOT_FOUND for a deleted measure, with no fabricated zero', () => {
    const { model, datasets } = buildStarSchemaFixture()
    const result = runKpiVisual(model, datasets, { id: 'v1', type: 'kpi', measureId: 'does-not-exist' }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('error')
    expect(result.value).toBeUndefined()
    expect(result.diagnostics[0]?.code).toBe('VISUAL_MEASURE_NOT_FOUND')
  })

  it('maps FILTER_GRAPH_INVALID to VISUAL_FILTER_GRAPH_INVALID instead of returning a value', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    // Region already reaches Sales via Customers; add a second, direct Region -> Sales path (a diamond),
    // the same forced-ambiguity technique used in filterContext.test.ts.
    const withDiamond: SemanticModel = {
      ...model,
      relationships: [
        ...model.relationships,
        {
          id: 'region-to-sales-direct',
          one: { datasetId: 'region-ds', tableId: 'region-table', columnId: 'region-id' },
          many: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' },
          cardinality: 'one-to-many',
          crossFilterDirection: 'single',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const result = runKpiVisual(withDiamond, datasets, { id: 'v1', type: 'kpi', measureId }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('error')
    expect(result.value).toBeUndefined()
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'VISUAL_FILTER_GRAPH_INVALID' })])
  })

  it('propagates relationship filters through the real filter propagation runtime (region -> customers -> sales)', () => {
    const { model, datasets, measureId, regionNameColumn } = buildStarSchemaFixture()
    const regionName = { datasetId: 'region-ds', tableId: 'region-table', columnId: regionNameColumn.id }
    const context = { filters: [{ column: regionName, operator: 'equals' as const, values: ['South'] }] }
    const result = runKpiVisual(model, datasets, { id: 'v1', type: 'kpi', measureId }, context)
    // South -> RegionID 10 -> Customers 1,3 (Spain) -> Sales orders 1,3,4 => 230
    expect(result.value).toBe(230)
  })
})
