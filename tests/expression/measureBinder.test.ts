import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { Measure, SemanticModel } from '../../src/domain/model'
import { bindMeasureExpression } from '../../src/expression/measureBinder'
import { parseExpression } from '../../src/expression/parser'
import { addTable, createModel } from '../../src/runtime/model/modelRuntime'

function salesDataset(): Dataset {
  return {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-productid', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: false },
          { id: 'sales-region', name: 'Region', dataType: 'string', nullable: false },
        ],
        rows: [{ OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80, Region: 'Spain' }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function baseModel(measures: Measure[] = []): { model: SemanticModel; datasets: Record<string, Dataset>; salesTableId: string } {
  const sales = salesDataset()
  let model = createModel()
  model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
  const salesTableId = model.tables[0].id
  return { model: { ...model, measures }, datasets: { [sales.id]: sales }, salesTableId }
}

function fakeMeasure(id: string, name: string, homeModelTableId: string): Measure {
  const now = new Date().toISOString()
  return { id, homeModelTableId, name, expression: 'SUM(Sales[Revenue])', dataType: 'decimal', createdAt: now, updatedAt: now }
}

function bindMeasure(model: SemanticModel, datasets: Record<string, Dataset>, expression: string) {
  const parsed = parseExpression(expression)
  if (!parsed.expression) return { diagnostics: parsed.diagnostics }
  return bindMeasureExpression(parsed.expression, { model, datasets })
}

describe('bindMeasureExpression', () => {
  it('binds SUM(Sales[Revenue]) to an Aggregation node', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'SUM(Sales[Revenue])')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Aggregation', function: 'SUM' })
  })

  it.each(['AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCTCOUNT'])('binds %s(Sales[Revenue])', (fn) => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, `${fn}(Sales[Revenue])`)

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Aggregation', function: fn })
  })

  it('binds COUNTROWS(Sales) to a CountRows node using the new TableReference AST', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'COUNTROWS(Sales)')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'CountRows' })
  })

  it('binds DIVIDE(SUM(...), SUM(...)) with two arguments', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'DIVIDE(SUM(Sales[Revenue]), SUM(Sales[Cost]))')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Divide' })
  })

  it('binds DIVIDE with a third alternate-result argument', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'DIVIDE(SUM(Sales[Revenue]), SUM(Sales[Cost]), 0)')

    expect(result.diagnostics).toEqual([])
    const bound = result.bound as { kind: 'Divide'; alternate?: unknown }
    expect(bound.alternate).toBeDefined()
  })

  it('binds a measure reference [Total Revenue] to a MeasureReference node', () => {
    const { model, datasets, salesTableId } = baseModel()
    const withMeasure: SemanticModel = { ...model, measures: [fakeMeasure('m1', 'Total Revenue', salesTableId)] }
    const result = bindMeasure(withMeasure, datasets, '[Total Revenue]')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'MeasureReference', measureId: 'm1' })
  })

  it('binds arithmetic between two measure references', () => {
    const { model, datasets, salesTableId } = baseModel()
    const withMeasures: SemanticModel = {
      ...model,
      measures: [fakeMeasure('m1', 'Total Revenue', salesTableId), fakeMeasure('m2', 'Total Cost', salesTableId)],
    }
    const result = bindMeasure(withMeasures, datasets, '[Total Revenue] - [Total Cost]')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Binary', operator: '-' })
  })

  it('rejects a naked physical column with COLUMN_REQUIRES_AGGREGATION', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'Sales[Revenue]')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_REQUIRES_AGGREGATION' })])
  })

  it('rejects a naked physical column used in arithmetic', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'Sales[Revenue] + 10')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_REQUIRES_AGGREGATION' })])
  })

  it('rejects an unknown measure reference with UNKNOWN_MEASURE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, '[Nonexistent]')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_MEASURE' })])
  })

  it('rejects an unsupported function with UNSUPPORTED_FUNCTION', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'KEEPFILTERS(SUM(Sales[Revenue]))')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_FUNCTION' })])
  })

  it('rejects RELATED with RELATED_REQUIRES_ROW_CONTEXT', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'RELATED(Sales[Revenue])')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_REQUIRES_ROW_CONTEXT' })])
  })

  it('rejects a bare table reference used outside COUNTROWS with BARE_TABLE_REFERENCE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'Sales + 1')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'BARE_TABLE_REFERENCE' })])
  })

  it('rejects SUM over a non-numeric column with NON_NUMERIC_AGGREGATION', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'SUM(Sales[Region])')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'NON_NUMERIC_AGGREGATION' })])
  })

  it('rejects an unknown table inside an aggregation with UNKNOWN_TABLE', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'SUM(Customers[Revenue])')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLE' })])
  })

  it('rejects an unknown column inside an aggregation with UNKNOWN_COLUMN', () => {
    const { model, datasets } = baseModel()
    const result = bindMeasure(model, datasets, 'SUM(Sales[Nope])')

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
  })

  it('resolves a calculated column through the logical-column abstraction', () => {
    const { model, datasets, salesTableId } = baseModel()
    const withCalcColumn: SemanticModel = {
      ...model,
      calculatedColumns: [
        {
          id: 'calc-margin',
          modelTableId: salesTableId,
          name: 'Margin',
          expression: 'Sales[Revenue] - Sales[Cost]',
          dataType: 'decimal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }
    const result = bindMeasure(withCalcColumn, datasets, 'SUM(Sales[Margin])')

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Aggregation', function: 'SUM', column: { kind: 'calculated' } })
  })
})
