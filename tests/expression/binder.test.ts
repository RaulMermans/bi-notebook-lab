import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { Relationship, SemanticModel } from '../../src/domain/model'
import { bind } from '../../src/expression/binder'
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
        ],
        rows: [{ OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 }],
        rowCount: 1,
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
        rows: [{ ProductID: 1, UnitCost: 12.5 }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function baseModel(): { model: SemanticModel; datasets: Record<string, Dataset>; salesTableId: string; productsTableId: string } {
  const sales = salesDataset()
  const products = productsDataset()
  let model = createModel()
  model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
  model = addTable(model, { datasetId: products.id, tableId: 'products-table' })
  const salesTableId = model.tables.find((t) => t.datasetId === sales.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === products.id)!.id
  return { model, datasets: { [sales.id]: sales, [products.id]: products }, salesTableId, productsTableId }
}

function relationship(productsId: string, salesId: string, active = true): Relationship {
  return {
    id: 'rel-1',
    one: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'products-id' },
    many: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-productid' },
    cardinality: 'one-to-many',
    crossFilterDirection: 'single',
    active,
    createdAt: new Date().toISOString(),
  }
}

describe('bind', () => {
  it('binds a valid current-table column reference', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('Sales[Revenue]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'ColumnReference', dataType: 'decimal' })
  })

  it('binds the current-table shorthand [Column]', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('[Revenue]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'ColumnReference', dataType: 'decimal' })
  })

  it('flags UNKNOWN_TABLE for a table that is not in the model', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('Customers[Name]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLE' })])
  })

  it('flags UNKNOWN_COLUMN for a misspelled column on the current table', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('Sales[Revenu]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
  })

  it('rejects a direct cross-table reference without RELATED', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('Products[UnitCost]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_OUTSIDE_ROW_CONTEXT' })])
  })

  it('binds RELATED to the resolved relationship and target column', () => {
    const { model, datasets, salesTableId, productsTableId } = baseModel()
    const withRelationship: SemanticModel = { ...model, relationships: [relationship(productsTableId, salesTableId)] }
    const parsed = parseExpression('RELATED(Products[UnitCost])')
    const result = bind(parsed.expression!, { model: withRelationship, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([])
    expect(result.bound).toMatchObject({ kind: 'Related', relationshipId: 'rel-1', dataType: 'decimal' })
  })

  it('flags RELATED_NO_RELATIONSHIP when no relationship connects the tables', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('RELATED(Products[UnitCost])')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_NO_RELATIONSHIP' })])
  })

  it('flags RELATED_INACTIVE_RELATIONSHIP when the only matching relationship is inactive', () => {
    const { model, datasets, salesTableId, productsTableId } = baseModel()
    const withRelationship: SemanticModel = { ...model, relationships: [relationship(productsTableId, salesTableId, false)] }
    const parsed = parseExpression('RELATED(Products[UnitCost])')
    const result = bind(parsed.expression!, { model: withRelationship, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_INACTIVE_RELATIONSHIP' })])
  })

  it('flags RELATED_WRONG_DIRECTION when the relationship runs the other way', () => {
    const { model, datasets, salesTableId, productsTableId } = baseModel()
    // Sales as the "one" side, Products as the "many" side: reversed from what RELATED(Products[...]) from Sales needs.
    const reversed: Relationship = {
      id: 'rel-reversed',
      one: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-productid' },
      many: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'products-id' },
      cardinality: 'one-to-many',
      crossFilterDirection: 'single',
      active: true,
      createdAt: new Date().toISOString(),
    }
    const withRelationship: SemanticModel = { ...model, relationships: [reversed] }
    void productsTableId
    const parsed = parseExpression('RELATED(Products[UnitCost])')
    const result = bind(parsed.expression!, { model: withRelationship, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_WRONG_DIRECTION' })])
  })

  it('flags RELATED_AMBIGUOUS_RELATIONSHIP when two active relationships connect the same tables', () => {
    const { model, datasets, salesTableId, productsTableId } = baseModel()
    const second: Relationship = { ...relationship(productsTableId, salesTableId), id: 'rel-2' }
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship(productsTableId, salesTableId), second],
    }
    const parsed = parseExpression('RELATED(Products[UnitCost])')
    const result = bind(parsed.expression!, { model: withRelationships, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_AMBIGUOUS_RELATIONSHIP' })])
  })

  it('flags UNKNOWN_TABLE inside RELATED for a table not in the model', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('RELATED(Customers[Name])')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLE' })])
  })

  it('flags UNKNOWN_COLUMN inside RELATED for a column not on the target table', () => {
    const { model, datasets, salesTableId, productsTableId } = baseModel()
    const withRelationship: SemanticModel = { ...model, relationships: [relationship(productsTableId, salesTableId)] }
    const parsed = parseExpression('RELATED(Products[Weight])')
    const result = bind(parsed.expression!, { model: withRelationship, datasets, currentModelTableId: salesTableId })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
  })

  it('propagates diagnostics from both sides of a binary expression', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('Sales[Nope] - Products[AlsoNope]')
    const result = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })

    expect(result.bound).toBeUndefined()
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['UNKNOWN_COLUMN', 'COLUMN_OUTSIDE_ROW_CONTEXT'])
  })
})
