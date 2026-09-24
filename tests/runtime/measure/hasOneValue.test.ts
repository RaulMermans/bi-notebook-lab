import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import type { FilterContext } from '../../../src/runtime/measure/filterContext'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * HASONEVALUE (brief §42/§19). Customers 1:*-> Sales via CustomerID, so a
 * Customers-side filter propagates down to Sales — used for the
 * "propagated filter" case.
 *
 *   Customer 1: Spain, Notes: null  -> Order 1
 *   Customer 2: France, Notes: null -> Order 2
 */
function buildFixture(): { model: SemanticModel; datasets: Record<string, Dataset> } {
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
          { id: 'customer-notes', name: 'Notes', dataType: 'string', nullable: true },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain', Notes: null },
          { CustomerID: 2, Country: 'France', Notes: null },
        ],
        rowCount: 2,
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
        ],
        rows: [
          { OrderID: 1, CustomerID: 1 },
          { OrderID: 2, CustomerID: 2 },
        ],
        rowCount: 2,
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
  return { model, datasets }
}

function columnFilter(columnId: string, values: unknown[]): FilterContext {
  return {
    filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId }, operator: values.length === 1 ? 'equals' : 'in', values }],
  }
}

function evalMeasureExpr(model: SemanticModel, datasets: Record<string, Dataset>, expression: string, filterContext?: FilterContext) {
  const customersTableId = model.tables.find((t) => t.datasetId === 'customers-ds')!.id
  const created = createMeasure(model, datasets, { homeModelTableId: customersTableId, name: 'Probe', expression })
  expect(created.diagnostics).toEqual([])
  return evaluateMeasure(created.model, datasets, created.measure!.id, filterContext)
}

describe('HASONEVALUE', () => {
  it('no filter — multiple distinct values visible', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'HASONEVALUE(Customers[Country])')
    expect(result.value).toBe(false)
  })

  it('single value selected (slicer-produced equality filter)', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'HASONEVALUE(Customers[Country])', columnFilter('customer-country', ['Spain']))
    expect(result.value).toBe(true)
  })

  it('multiple values selected (slicer-produced IN filter)', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'HASONEVALUE(Customers[Country])', columnFilter('customer-country', ['Spain', 'France']))
    expect(result.value).toBe(false)
  })

  it('empty context (filter matches zero rows)', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'HASONEVALUE(Customers[Country])', columnFilter('customer-country', ['Germany']))
    expect(result.value).toBe(false)
  })

  it('blank-only visible context counts as exactly one distinct (BLANK) value', () => {
    const { model, datasets } = buildFixture()
    const result = evalMeasureExpr(model, datasets, 'HASONEVALUE(Customers[Notes])', columnFilter('customer-country', ['Spain']))
    expect(result.value).toBe(true)
  })

  it('a filter propagated from Customers narrows Sales down to one distinct row', () => {
    const { model, datasets } = buildFixture()
    const salesTableId = model.tables.find((t) => t.datasetId === 'sales-ds')!.id
    const created = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Probe', expression: 'HASONEVALUE(Sales[OrderID])' })
    expect(created.diagnostics).toEqual([])

    const unfiltered = evaluateMeasure(created.model, datasets, created.measure!.id)
    expect(unfiltered.value).toBe(false)

    const filtered = evaluateMeasure(created.model, datasets, created.measure!.id, columnFilter('customer-country', ['Spain']))
    expect(filtered.value).toBe(true)
  })
})
