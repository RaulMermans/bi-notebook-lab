import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../../src/domain/model'
import { analyzeMeasureContext } from '../../../src/runtime/context/contextAnalysis'
import { setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { buildStarSchemaFixture, withAverageOrderValue } from './starSchemaFixture'

describe('analyzeMeasureContext', () => {
  it('baseline with no filters: every table unfiltered, current equals baseline', () => {
    const { model, datasets, measureId, salesTableId, customersTableId, productsTableId } = buildStarSchemaFixture()

    const analysis = analyzeMeasureContext({ model, datasets, measureId, filterContext: { filters: [] } })

    expect(analysis.invalid).toBeUndefined()
    expect(analysis.baseline.value).toBe(460)
    expect(analysis.current.value).toBe(460)
    expect(analysis.comparison.bothNumeric).toBe(true)
    expect(analysis.comparison.absoluteDelta).toBe(0)
    expect(analysis.comparison.relativeDelta).toBe(0)

    for (const tableId of [salesTableId, customersTableId, productsTableId]) {
      const table = analysis.tables!.find((t) => t.modelTableId === tableId)!
      expect(table.filterState).toBe('unfiltered')
      expect(table.visibleRows).toBe(table.totalRows)
    }
  })

  it('applies a direct filter: Customers is DIRECT, Sales is PROPAGATED', () => {
    const { model, datasets, measureId, salesTableId, customersTableId, countryColumn } = buildStarSchemaFixture()

    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }

    const analysis = analyzeMeasureContext({ model, datasets, measureId, filterContext })

    expect(analysis.baseline.value).toBe(460)
    expect(analysis.current.value).toBe(230) // orders 1, 3, 4

    const customers = analysis.tables!.find((t) => t.modelTableId === customersTableId)!
    expect(customers.filterState).toBe('direct')
    expect(customers.visibleRows).toBe(2)
    expect(customers.totalRows).toBe(3)

    const sales = analysis.tables!.find((t) => t.modelTableId === salesTableId)!
    expect(sales.filterState).toBe('propagated')
    expect(sales.incomingPropagation).toHaveLength(1)
    expect(sales.incomingPropagation[0].oneTableName).toBe('Customers')

    const relationship = analysis.relationships!.find((r) => r.oneModelTableId === customersTableId)!
    expect(relationship.state).toBe('propagated')
    expect(relationship.manyRowsBefore).toBe(5)
    expect(relationship.manyRowsAfter).toBe(3)
    expect(relationship.allowedOneSideKeys).toBe(2)
  })

  it('two dimension filters both propagate into Sales (multiple filter paths)', () => {
    const { model, datasets, measureId, salesTableId, countryColumn, categoryColumn } = buildStarSchemaFixture()

    const filterContext = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }

    const analysis = analyzeMeasureContext({ model, datasets, measureId, filterContext })

    expect(analysis.current.value).toBe(150) // orders 1, 3
    const sales = analysis.tables!.find((t) => t.modelTableId === salesTableId)!
    expect(sales.filterState).toBe('propagated')
    expect(sales.incomingPropagation.map((p) => p.oneTableName).sort()).toEqual(['Customers', 'Products'])
  })

  it('propagates transitively through Region -> Customers -> Sales', () => {
    const { model, datasets, measureId, salesTableId, regionNameColumn } = buildStarSchemaFixture()

    const filterContext = {
      filters: [{ column: { datasetId: 'region-ds', tableId: 'region-table', columnId: regionNameColumn.id }, operator: 'equals' as const, values: ['South'] }],
    }

    const analysis = analyzeMeasureContext({ model, datasets, measureId, filterContext })

    expect(analysis.current.value).toBe(230)
    const sales = analysis.tables!.find((t) => t.modelTableId === salesTableId)!
    expect(sales.filterState).toBe('propagated')
    // Region -> Customers -> Sales: two propagation steps land on Customers and Sales respectively.
    expect(analysis.narrative.some((s) => s.description.includes('RegionName'))).toBe(true)
  })

  it('an inactive relationship does not propagate, and the edge is marked INACTIVE', () => {
    const { model, datasets, measureId, salesTableId, productRelationshipId, categoryColumn } = buildStarSchemaFixture()
    const disabled = setRelationshipActive(model, productRelationshipId, false)

    const filterContext = {
      filters: [{ column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] }],
    }

    const analysis = analyzeMeasureContext({ model, datasets: datasets, measureId, filterContext })
    void disabled

    const analysisWithDisabled = analyzeMeasureContext({ model: disabled, datasets, measureId, filterContext })
    expect(analysisWithDisabled.current.value).toBe(460) // unaffected

    const relationship = analysisWithDisabled.relationships!.find((r) => r.relationshipId === productRelationshipId)!
    expect(relationship.active).toBe(false)
    expect(relationship.state).toBe('inactive')
    expect(relationship.propagated).toBe(false)

    const sales = analysisWithDisabled.tables!.find((t) => t.modelTableId === salesTableId)!
    expect(sales.incomingPropagation.some((p) => p.relationshipId === productRelationshipId)).toBe(false)

    // sanity: the still-active-graph baseline analysis (computed above) isn't reused for the disabled assertions.
    expect(analysis.relationships!.find((r) => r.relationshipId === productRelationshipId)!.active).toBe(true)
  })

  it('fails closed with an `invalid` state when the active relationship graph is cyclic', () => {
    const { model, datasets, measureId } = buildStarSchemaFixture()
    const forcedCycle: SemanticModel = {
      ...model,
      relationships: [
        ...model.relationships,
        {
          id: 'forced-cycle',
          one: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' },
          many: { datasetId: 'region-ds', tableId: 'region-table', columnId: 'region-id' },
          cardinality: 'one-to-many',
          crossFilterDirection: 'single',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const analysis = analyzeMeasureContext({ model: forcedCycle, datasets, measureId, filterContext: { filters: [] } })

    expect(analysis.invalid).toBeDefined()
    expect(analysis.invalid!.code).toBe('FILTER_GRAPH_INVALID')
    expect(analysis.tables).toBeUndefined()
    expect(analysis.relationships).toBeUndefined()
  })

  it('shows a measure dependency chain in the trace for a DIVIDE-of-measures measure', () => {
    const { model, datasets, salesTableId } = buildStarSchemaFixture()
    const { model: withAov, averageOrderValueId } = withAverageOrderValue(model, datasets, salesTableId)

    const analysis = analyzeMeasureContext({ model: withAov, datasets, measureId: averageOrderValueId, filterContext: { filters: [] } })

    expect(analysis.current.trace).toBeDefined()
    // The root trace node is the AOV measure-reference; its DIVIDE child should contain two nested measure-reference nodes.
    const divideNode = analysis.current.trace!.children![0]
    const nestedMeasureRefs = (divideNode.children ?? []).filter((c) => c.kind === 'measure-reference')
    expect(nestedMeasureRefs.map((n) => n.label)).toEqual(expect.arrayContaining(['[Total Revenue]', '[Orders]']))
  })
})
