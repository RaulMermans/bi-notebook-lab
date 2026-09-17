import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { Relationship, SemanticModel } from '../../../src/domain/model'
import {
  createCalculatedColumn,
  evaluateCalculatedColumn,
  removeCalculatedColumn,
  updateCalculatedColumn,
} from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { addTable, createModel, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

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
        rows: [
          { OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 },
          { OrderID: 2, ProductID: 1, Revenue: 50, Cost: 30 },
        ],
        rowCount: 2,
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

function setUp() {
  const sales = salesDataset()
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

describe('createCalculatedColumn', () => {
  it('creates Margin = Sales[Revenue] - Sales[Cost] and stores an inferred decimal type', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.calculatedColumn).toMatchObject({ name: 'Margin', dataType: 'integer' })
    expect(result.execution?.values).toEqual([40, 20])
    expect(result.model.calculatedColumns).toHaveLength(1)
  })

  it('creates a RELATED calculated column through an active relationship', () => {
    const { model, datasets, salesTableId, productsTableId } = setUp()
    void productsTableId
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }

    const result = createCalculatedColumn(withRelationship, datasets, {
      modelTableId: salesTableId,
      name: 'Unit Cost',
      expression: 'RELATED(Products[UnitCost])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.values).toEqual([12.5, 12.5])
  })

  it('does not store a column when the name conflicts with a physical column', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Revenue',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_NAME_CONFLICT' })])
    expect(result.model.calculatedColumns).toHaveLength(0)
  })

  it('does not store a second calculated column with a duplicate name', () => {
    const { model, datasets, salesTableId } = setUp()
    const first = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    const second = createCalculatedColumn(first.model, datasets, {
      modelTableId: salesTableId,
      name: 'margin',
      expression: 'Sales[Revenue]',
    })

    expect(second.diagnostics).toEqual([expect.objectContaining({ code: 'DUPLICATE_CALCULATED_COLUMN' })])
    expect(second.model.calculatedColumns).toHaveLength(1)
  })

  it('never stores a definition for a syntax-invalid expression', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] -',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SYNTAX_ERROR' })])
    expect(result.model).toBe(model)
    expect(result.model.calculatedColumns).toHaveLength(0)
  })

  it('never stores a definition that fails to bind (unknown column)', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenu] - Sales[Cost]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
    expect(result.model.calculatedColumns).toHaveLength(0)
  })
})

describe('updateCalculatedColumn', () => {
  it('edits the expression and re-evaluates', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })
    const columnId = created.calculatedColumn!.id

    const updated = updateCalculatedColumn(created.model, datasets, columnId, { expression: 'Sales[Revenue] * Sales[Cost]' })

    expect(updated.diagnostics).toEqual([])
    expect(updated.execution?.values).toEqual([9600, 1500])
    expect(updated.model.calculatedColumns[0].expression).toBe('Sales[Revenue] * Sales[Cost]')
  })

  it('allows renaming to the same name without flagging a self-conflict', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })
    const columnId = created.calculatedColumn!.id

    const updated = updateCalculatedColumn(created.model, datasets, columnId, { name: 'Margin' })

    expect(updated.diagnostics).toEqual([])
  })
})

describe('removeCalculatedColumn', () => {
  it('removes the definition from the model', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    const result = removeCalculatedColumn(created.model, created.calculatedColumn!.id)

    expect(result.calculatedColumns).toHaveLength(0)
  })
})

describe('evaluateCalculatedColumn', () => {
  it('recomputes a persisted definition from scratch (simulating a reload)', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    const execution = evaluateCalculatedColumn(created.model, datasets, created.calculatedColumn!.id)

    expect(execution?.values).toEqual([40, 20])
    expect(execution?.columnDiagnostics).toEqual([])
  })

  it('surfaces columnDiagnostics when a RELATED column loses its relationship', () => {
    const { model, datasets, salesTableId } = setUp()
    const withRelationship: SemanticModel = { ...model, relationships: [relationship()] }
    const created = createCalculatedColumn(withRelationship, datasets, {
      modelTableId: salesTableId,
      name: 'Unit Cost',
      expression: 'RELATED(Products[UnitCost])',
    })

    const disabled = setRelationshipActive(created.model, 'rel-1', false)
    const execution = evaluateCalculatedColumn(disabled, datasets, created.calculatedColumn!.id)

    expect(execution?.values).toEqual([])
    expect(execution?.columnDiagnostics).toEqual([expect.objectContaining({ code: 'RELATED_INACTIVE_RELATIONSHIP' })])
  })
})
