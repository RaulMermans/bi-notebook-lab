import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import type { FilterContext } from '../../../src/runtime/measure/filterContext'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 15 KEEPFILTERS matrix (brief §41). Customers 1:*-> Sales via
 * CustomerID, so a Country filter on Customers propagates to Sales — the
 * same mechanism every case below exercises.
 *
 *   Customer 1: Spain / Premium  -> Order 1: Revenue 100
 *   Customer 2: France / Standard -> Order 2: Revenue 200
 *   Customer 3: Spain / Standard -> Order 3: Revenue 50
 */
function buildFixture(): { model: SemanticModel; datasets: Record<string, Dataset>; countryColumnId: string; segmentColumnId: string } {
  const customersDs: Dataset = {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [
          { id: 'customer-id', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'customer-country', name: 'Country', dataType: 'string', nullable: false },
          { id: 'customer-segment', name: 'Segment', dataType: 'string', nullable: false },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain', Segment: 'Premium' },
          { CustomerID: 2, Country: 'France', Segment: 'Standard' },
          { CustomerID: 3, Country: 'Spain', Segment: 'Standard' },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const salesDs: Dataset = {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { OrderID: 1, CustomerID: 1, Revenue: 100 },
          { OrderID: 2, CustomerID: 2, Revenue: 200 },
          { OrderID: 3, CustomerID: 3, Revenue: 50 },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = createModel()
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const rel = createRelationship(
    model,
    {
      one: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
    },
    datasets,
  )
  model = rel.model

  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
  const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  model = revenue.model

  return { model, datasets, countryColumnId: 'customer-country', segmentColumnId: 'customer-segment' }
}

function countryFilter(values: unknown[]): FilterContext {
  return {
    filters: [
      {
        column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' },
        operator: values.length === 1 ? 'equals' : 'in',
        values,
      },
    ],
  }
}

function segmentFilter(values: unknown[]): FilterContext {
  return {
    filters: [
      {
        column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-segment' },
        operator: values.length === 1 ? 'equals' : 'in',
        values,
      },
    ],
  }
}

function evalMeasureExpr(model: SemanticModel, datasets: Record<string, Dataset>, expression: string, filterContext?: FilterContext) {
  const salesTableId = model.tables.find((t) => t.datasetId === 'sales-ds')!.id
  const created = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Probe', expression })
  expect(created.diagnostics).toEqual([])
  return evaluateMeasure(created.model, datasets, created.measure!.id, filterContext)
}

describe('KEEPFILTERS', () => {
  it('no pre-existing filter — behaves like a plain replace', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))')
    expect(result.diagnostics).toEqual([])
    expect(result.value).toBe(150) // 100 + 50
  })

  it('same value already filtered — result unchanged', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(
      model,
      datasets,
      'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))',
      countryFilter(['Spain']),
    )
    expect(result.value).toBe(150)
  })

  it('broader existing filter intersected down to the KEEPFILTERS value', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(
      model,
      datasets,
      'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))',
      countryFilter(['Spain', 'France']),
    )
    expect(result.value).toBe(150)
  })

  it('incompatible existing filter intersects to an empty set', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(
      model,
      datasets,
      'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))',
      countryFilter(['France']),
    )
    expect(result.value == null || result.value === 0).toBe(true)
  })

  it('a different-column ambient filter is preserved (only the same column intersects)', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(
      model,
      datasets,
      'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))',
      segmentFilter(['Standard']),
    )
    // Spain AND Standard -> Customer 3 only -> Revenue 50.
    expect(result.value).toBe(50)
  })

  it('without KEEPFILTERS, the same scenario replaces instead of intersecting', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'CALCULATE([Total Revenue], Customers[Country] = "Spain")', countryFilter(['France']))
    // Plain CALCULATE replaces the Country filter outright — France's incompatibility is irrelevant.
    expect(result.value).toBe(150)
  })

  it('works through a nested measure reference', () => {
    const { model, datasets } = buildFixture()
    const salesTableId = model.tables.find((t) => t.datasetId === 'sales-ds')!.id
    const inner = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Spain KeepFilters',
      expression: 'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))',
    })
    expect(inner.diagnostics).toEqual([])
    const outer = createMeasure(inner.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Double Spain',
      expression: '[Spain KeepFilters] * 2',
    })
    expect(outer.diagnostics).toEqual([])

    const result = evaluateMeasure(outer.model, datasets, outer.measure!.id, countryFilter(['France']))
    // Incompatible ambient (France) intersected with KEEPFILTERS(Spain) -> empty -> BLANK*2 -> BLANK.
    expect(result.value == null).toBe(true)
  })
})
