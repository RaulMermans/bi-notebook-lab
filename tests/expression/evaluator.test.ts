import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { Relationship, SemanticModel } from '../../src/domain/model'
import { bind } from '../../src/expression/binder'
import { evaluateBoundExpressionOverTable, evaluateSingleRow } from '../../src/expression/evaluator'
import { parseExpression } from '../../src/expression/parser'
import { addTable, createModel } from '../../src/runtime/model/modelRuntime'

function salesDataset(rows: Record<string, unknown>[]): Dataset {
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
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: true },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: true },
        ],
        rows,
        rowCount: rows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function productsDataset(): Dataset {
  return {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [
          { id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'products-unitcost', name: 'UnitCost', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { ProductID: 1, UnitCost: 12.5 },
          { ProductID: 2, UnitCost: 30 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function setUpModel(salesRows: Record<string, unknown>[]) {
  const sales = salesDataset(salesRows)
  const products = productsDataset()
  let model = createModel()
  model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
  model = addTable(model, { datasetId: products.id, tableId: 'products-table' })
  const salesTableId = model.tables.find((t) => t.datasetId === sales.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === products.id)!.id
  const datasets = { [sales.id]: sales, [products.id]: products }
  return { model, datasets, salesTableId, productsTableId }
}

function relationship(): Relationship {
  return {
    id: 'rel-1',
    one: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'products-id' },
    many: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-productid' },
    cardinality: 'one-to-many',
    crossFilterDirection: 'single',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

function bindAndEvaluate(model: SemanticModel, datasets: Record<string, Dataset>, tableId: string, expression: string) {
  const parsed = parseExpression(expression)
  const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: tableId })
  if (!bound.bound) throw new Error(`Expected bind to succeed: ${JSON.stringify(bound.diagnostics)}`)
  return evaluateBoundExpressionOverTable(bound.bound, model, datasets, tableId)
}

describe('evaluateBoundExpressionOverTable', () => {
  it('computes Margin = Revenue - Cost per row', () => {
    const { model, datasets, salesTableId } = setUpModel([
      { OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 },
      { OrderID: 2, ProductID: 2, Revenue: 50, Cost: 30 },
    ])

    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] - Sales[Cost]')

    expect(result.values).toEqual([40, 20])
    expect(result.errors).toEqual([])
  })

  it('evaluates multiplication', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 10, Cost: 2 }])
    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] * Sales[Cost]')
    expect(result.values).toEqual([20])
  })

  it('evaluates division and honors parentheses precedence for Margin %', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 100, Cost: 60 }])
    const result = bindAndEvaluate(model, datasets, salesTableId, '(Sales[Revenue] - Sales[Cost]) / Sales[Revenue]')
    expect(result.values).toEqual([0.4])
  })

  it('evaluates each row independently', () => {
    const { model, datasets, salesTableId } = setUpModel([
      { OrderID: 1, ProductID: 1, Revenue: 10, Cost: 1 },
      { OrderID: 2, ProductID: 1, Revenue: 20, Cost: 2 },
      { OrderID: 3, ProductID: 1, Revenue: 30, Cost: 3 },
    ])
    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] - Sales[Cost]')
    expect(result.values).toEqual([9, 18, 27])
  })

  it('propagates blank/null through arithmetic instead of coercing', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: null, Cost: 80 }])
    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] - Sales[Cost]')
    expect(result.values).toEqual([null])
    expect(result.errors).toEqual([])
  })

  it('reports a DIVISION_ERROR row error and blank result on divide by zero', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 10, Cost: 0 }])
    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] / Sales[Cost]')
    expect(result.values).toEqual([null])
    expect(result.errors).toEqual([expect.objectContaining({ rowIndex: 0, code: 'DIVISION_ERROR' })])
  })

  it('reports a TYPE_MISMATCH row error for non-numeric arithmetic', () => {
    const sales = salesDataset([{ OrderID: 1, ProductID: 1, Revenue: 10, Cost: 80 }])
    sales.tables[0].columns.push({ id: 'sales-region', name: 'Region', dataType: 'string', nullable: false })
    sales.tables[0].rows[0].Region = 'Spain'
    let model = createModel()
    model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
    const salesTableId = model.tables[0].id
    const datasets = { [sales.id]: sales }

    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] - Sales[Region]')
    expect(result.values).toEqual([null])
    expect(result.errors).toEqual([expect.objectContaining({ rowIndex: 0, code: 'TYPE_MISMATCH' })])
  })

  it('resolves RELATED for a matched foreign key', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 2, Revenue: 60, Cost: 30 }])
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }
    const result = bindAndEvaluate(withRelationship, datasets, salesTableId, 'RELATED(Products[UnitCost])')
    expect(result.values).toEqual([30])
  })

  it('returns blank (not an error) when a foreign key has no matching one-side row', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 999, Revenue: 60, Cost: 30 }])
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }
    const result = bindAndEvaluate(withRelationship, datasets, salesTableId, 'RELATED(Products[UnitCost])')
    expect(result.values).toEqual([null])
    expect(result.errors).toEqual([])
  })

  it('combines RELATED with arithmetic', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 60, Cost: 0 }])
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }
    const result = bindAndEvaluate(withRelationship, datasets, salesTableId, 'Sales[Revenue] - RELATED(Products[UnitCost])')
    expect(result.values).toEqual([47.5])
  })

  it('builds a preview trace whose result matches the computed value', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 }])
    const result = bindAndEvaluate(model, datasets, salesTableId, 'Sales[Revenue] - Sales[Cost]')
    expect(result.previewTraces).toHaveLength(1)
    expect(result.previewTraces[0].trace.value).toBe(40)
    expect(result.previewTraces[0].trace.children?.[0]).toMatchObject({ kind: 'binary-operation', value: 40 })
  })

  it('traces a RELATED lookup with match metadata', () => {
    const { model, datasets, salesTableId } = setUpModel([{ OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 }])
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }
    const result = bindAndEvaluate(withRelationship, datasets, salesTableId, 'RELATED(Products[UnitCost])')
    const relatedTrace = result.previewTraces[0].trace.children?.[0]
    expect(relatedTrace).toMatchObject({ kind: 'related-lookup', value: 12.5, metadata: { matched: true } })
  })
})

describe('evaluateSingleRow', () => {
  it('re-evaluates one row on demand', () => {
    const { model, datasets, salesTableId } = setUpModel([
      { OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 },
      { OrderID: 2, ProductID: 2, Revenue: 50, Cost: 30 },
    ])
    const parsed = parseExpression('Sales[Revenue] - Sales[Cost]')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    const result = evaluateSingleRow(bound.bound!, model, datasets, salesTableId, 1)
    expect(result?.value).toBe(20)
  })
})
