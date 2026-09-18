import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { Measure, SemanticModel } from '../../src/domain/model'
import { bindMeasureExpression } from '../../src/expression/measureBinder'
import { parseExpression } from '../../src/expression/parser'
import { addTable, createModel, createRelationship } from '../../src/runtime/model/modelRuntime'

/** Two-table fixture (Customers -> Sales) for CALCULATE/FILTER binder-level diagnostics — see docs/CALCULATE.md. */
function baseModel(): { model: SemanticModel; datasets: Record<string, Dataset> } {
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
        ],
        rows: [{ CustomerID: 1, Country: 'Spain' }],
        rowCount: 1,
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
        rows: [{ OrderID: 1, CustomerID: 1, Revenue: 100 }],
        rowCount: 1,
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

  const now = new Date().toISOString()
  const totalRevenue: Measure = {
    id: 'measure-total-revenue',
    homeModelTableId: model.tables.find((t) => t.datasetId === salesDs.id)!.id,
    name: 'Total Revenue',
    expression: 'SUM(Sales[Revenue])',
    dataType: 'decimal',
    createdAt: now,
    updatedAt: now,
  }
  model = { ...model, measures: [totalRevenue] }

  return { model, datasets }
}

function bindMeasure(model: SemanticModel, datasets: Record<string, Dataset>, expression: string) {
  const parsed = parseExpression(expression)
  if (!parsed.expression) return { diagnostics: parsed.diagnostics }
  return bindMeasureExpression(parsed.expression, { model, datasets })
}

describe('CALCULATE binder diagnostics', () => {
  it('rejects CALCULATE() with no arguments', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE()')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_CALCULATE_ARITY' })])
  })

  it('accepts CALCULATE with only an expression and no filter arguments (sprint brief §53)', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue])')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Calculate' })
    expect((result.bound as any).modifiers).toHaveLength(0)
  })

  it('binds a valid CALCULATE to a Calculate node with one modifier', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Calculate' })
    expect((result.bound as any).modifiers).toHaveLength(1)
    expect((result.bound as any).modifiers[0]).toMatchObject({ kind: 'ReplaceColumnFilter', operator: 'equals', values: ['Spain'] })
  })

  it('rejects a boolean filter argument referencing two tables with BOOLEAN_FILTER_MULTIPLE_TABLES', () => {
    const { model, datasets } = baseModel()
    // Comparing two different tables' columns directly isn't a supported shape — both sides resolve to columns.
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], Customers[Country] = Sales[Revenue])')
    // Sales[Revenue] used as a string comparand is still a column read attempt — expect the multi-table rejection.
    expect(result.diagnostics.some((d) => d.code === 'BOOLEAN_FILTER_MULTIPLE_TABLES')).toBe(true)
  })

  it('rejects a measure reference inside a boolean filter with BOOLEAN_FILTER_MEASURE_REFERENCE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], [Total Revenue] = 100)')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'BOOLEAN_FILTER_MEASURE_REFERENCE' })])
  })

  it('rejects a nested CALCULATE inside a boolean filter with BOOLEAN_FILTER_NESTED_CALCULATE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(
      model,
      datasets,
      'CALCULATE([Total Revenue], CALCULATE([Total Revenue], Customers[Country] = "Spain") = 100)',
    )
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'BOOLEAN_FILTER_NESTED_CALCULATE' })])
  })

  it('rejects a non-boolean filter argument with FILTER_PREDICATE_NOT_BOOLEAN', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], Customers[Country])')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'FILTER_PREDICATE_NOT_BOOLEAN' })])
  })

  it('rejects arithmetic inside a boolean filter argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], Customers[CustomerID] + 1 = 2)')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'CALCULATE_INVALID_FILTER_ARGUMENT' })])
  })

  it('rejects FILTER used outside of CALCULATE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'FILTER(Customers, Customers[Country] = "Spain")')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_FUNCTION' })])
  })

  it('rejects REMOVEFILTERS used outside of CALCULATE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'REMOVEFILTERS(Customers[Country])')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_FUNCTION' })])
  })

  it('rejects a malformed REMOVEFILTERS argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], REMOVEFILTERS(42))')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_REMOVEFILTERS_ARGUMENT' })])
  })

  it('rejects mixing columns and a table in one REMOVEFILTERS call', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country], Sales))')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_REMOVEFILTERS_ARGUMENT' })])
  })

  it('rejects ALL with the wrong arity', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], ALL())')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_ALL_ARGUMENT' })])
  })

  it('rejects ALL with a non-table/column argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], ALL(42))')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_ALL_ARGUMENT' })])
  })

  it('rejects KEEPFILTERS as a CALCULATE filter argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_FUNCTION' })])
  })

  it('rejects FILTER with a non-table first argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], FILTER(Customers[Country], Customers[Country] = "Spain"))')
    // Sprint 9 routes FILTER through the shared table-expression binder (sprint brief §6-§7), which
    // reports a malformed table argument as INVALID_TABLE_EXPRESSION_ARGUMENT instead of the generic
    // INVALID_FUNCTION_ARGUMENT — still a single, still-rejected error, just a more specific code.
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_TABLE_EXPRESSION_ARGUMENT' })])
  })

  it('binds FILTER as a table-wide PredicateFilter modifier', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], FILTER(Customers, Customers[Country] = "Spain"))')
    expect(result.diagnostics).toEqual([])
    expect((result.bound as any).modifiers[0]).toMatchObject({ kind: 'PredicateFilter', tableWide: true })
  })

  it('binds a compound direct filter as a column-scoped PredicateFilter modifier', () => {
    const { model, datasets } = baseModel()
    // Not a required example, but the general design supports it: a compound comparison directly in CALCULATE.
    const result = bindMeasure(model, datasets, 'CALCULATE([Total Revenue], Customers[Country] = "Spain" || Customers[Country] = "France")')
    expect(result.diagnostics).toEqual([])
    expect((result.bound as any).modifiers[0]).toMatchObject({ kind: 'PredicateFilter', tableWide: false })
  })

  it('supports a comparison as a general scalar measure result outside CALCULATE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, '[Total Revenue] > 100')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Comparison', operator: '>' })
  })
})
