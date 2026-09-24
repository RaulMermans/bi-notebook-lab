import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import {
  addTable,
  createModel,
  createRelationship,
  moveTable,
  removeRelationship,
  removeTable,
  setRelationshipActive,
} from '../../../src/runtime/model/modelRuntime'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'

function fakeDataset(id: string, columnDataType: 'integer' | 'string' = 'integer'): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [
      {
        id: `${id}-table`,
        name: id,
        columns: [{ id: `${id}-col`, name: 'Key', dataType: columnDataType, nullable: false }],
        rows: [{ Key: 1 }, { Key: 2 }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

describe('modelRuntime', () => {
  it('creates an empty model', () => {
    const model = createModel('Retail')
    expect(model.name).toBe('Retail')
    expect(model.tables).toEqual([])
    expect(model.relationships).toEqual([])
  })

  it('adds and removes a table', () => {
    let model = createModel()
    model = addTable(model, { datasetId: 'ds1', tableId: 'ds1-table' })
    expect(model.tables).toHaveLength(1)

    const [table] = model.tables
    model = removeTable(model, table.id)
    expect(model.tables).toHaveLength(0)
  })

  it('removing a table also removes relationships that reference it', () => {
    const customers = fakeDataset('customers')
    const sales = fakeDataset('sales')
    const datasets = { customers, sales }

    let model = createModel()
    model = addTable(model, { datasetId: 'customers', tableId: 'customers-table' })
    model = addTable(model, { datasetId: 'sales', tableId: 'sales-table' })

    const result = createRelationship(
      model,
      {
        one: { datasetId: 'customers', tableId: 'customers-table', columnId: 'customers-col' },
        many: { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col' },
      },
      datasets,
    )
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false)
    model = result.model
    expect(model.relationships).toHaveLength(1)

    const customersTable = model.tables.find((t) => t.datasetId === 'customers')!
    model = removeTable(model, customersTable.id)
    expect(model.relationships).toHaveLength(0)
  })

  it('moves a table to a new position', () => {
    let model = createModel()
    model = addTable(model, { datasetId: 'ds1', tableId: 'ds1-table' })
    const [table] = model.tables

    model = moveTable(model, table.id, { x: 120, y: 40 })
    expect(model.tables[0].position).toEqual({ x: 120, y: 40 })
  })

  it('toggles a relationship active state', () => {
    const customers = fakeDataset('customers')
    const sales = fakeDataset('sales')
    const datasets = { customers, sales }

    let model = createModel()
    model = addTable(model, { datasetId: 'customers', tableId: 'customers-table' })
    model = addTable(model, { datasetId: 'sales', tableId: 'sales-table' })

    const result = createRelationship(
      model,
      {
        one: { datasetId: 'customers', tableId: 'customers-table', columnId: 'customers-col' },
        many: { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col' },
      },
      datasets,
    )
    model = result.model
    const relationshipId = result.relationship!.id

    model = setRelationshipActive(model, relationshipId, false).model
    expect(model.relationships[0].active).toBe(false)

    model = removeRelationship(model, relationshipId)
    expect(model.relationships).toHaveLength(0)
  })

  it('Sprint 15: removing a table cascades any measure homed on it (brief §5 "Remove Model Table")', () => {
    const sales = fakeDataset('sales')
    const datasets = { sales }

    let model = createModel()
    model = addTable(model, { datasetId: 'sales', tableId: 'sales-table' })
    const salesTableId = model.tables[0].id

    const result = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Key', expression: 'SUM(sales[Key])' })
    expect(result.diagnostics).toEqual([])
    model = result.model
    expect(model.measures).toHaveLength(1)

    model = removeTable(model, salesTableId)
    expect(model.measures).toHaveLength(0)
    expect(model.tables).toHaveLength(0)
  })

  it('does not apply a relationship that fails validation', () => {
    const customers = fakeDataset('customers', 'integer')
    const sales = fakeDataset('sales', 'string')
    const datasets = { customers, sales }

    let model = createModel()
    model = addTable(model, { datasetId: 'customers', tableId: 'customers-table' })
    model = addTable(model, { datasetId: 'sales', tableId: 'sales-table' })

    const result = createRelationship(
      model,
      {
        one: { datasetId: 'customers', tableId: 'customers-table', columnId: 'customers-col' },
        many: { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col' },
      },
      datasets,
    )

    expect(result.diagnostics.some((d) => d.code === 'COLUMN_TYPE_MISMATCH')).toBe(true)
    expect(result.relationship).toBeUndefined()
    expect(result.model.relationships).toHaveLength(0)
  })
})
