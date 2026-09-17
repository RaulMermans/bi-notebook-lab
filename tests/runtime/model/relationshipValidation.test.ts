import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { addTable, createModel, validateRelationship } from '../../../src/runtime/model/modelRuntime'
import type { ColumnRef } from '../../../src/domain/model'

function dataset(id: string, columns: { name: string; dataType: Dataset['tables'][number]['columns'][number]['dataType'] }[], rows: Record<string, unknown>[]): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [
      {
        id: `${id}-table`,
        name: id,
        columns: columns.map((c) => ({ id: `${id}-${c.name}`, name: c.name, dataType: c.dataType, nullable: false })),
        rows,
        rowCount: rows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function colRef(datasetId: string, columnName: string): ColumnRef {
  return { datasetId, tableId: `${datasetId}-table`, columnId: `${datasetId}-${columnName}` }
}

describe('validateRelationship', () => {
  it('accepts a valid one-to-many relationship with no diagnostics', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    const sales = dataset('sales', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 1 }, { CustomerID: 2 }])
    const datasets = { customers, sales }
    const model = addTable(addTable(createModel(), { datasetId: 'customers', tableId: 'customers-table' }), {
      datasetId: 'sales',
      tableId: 'sales-table',
    })

    const diagnostics = validateRelationship(
      model,
      { one: colRef('customers', 'CustomerID'), many: colRef('sales', 'CustomerID') },
      datasets,
    )

    expect(diagnostics).toEqual([])
  })

  it('flags MISSING_REFERENCE when a dataset/table/column does not exist', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    const model = createModel()

    const diagnostics = validateRelationship(
      model,
      { one: colRef('customers', 'CustomerID'), many: { datasetId: 'missing', tableId: 'missing-table', columnId: 'missing-col' } },
      { customers },
    )

    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'MISSING_REFERENCE' })])
  })

  it('flags SELF_RELATIONSHIP when both sides are the same table', () => {
    const sales = dataset(
      'sales',
      [
        { name: 'OrderID', dataType: 'integer' },
        { name: 'CustomerID', dataType: 'integer' },
      ],
      [{ OrderID: 1, CustomerID: 1 }],
    )

    const diagnostics = validateRelationship(
      createModel(),
      { one: colRef('sales', 'OrderID'), many: colRef('sales', 'CustomerID') },
      { sales },
    )

    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'SELF_RELATIONSHIP' })])
  })

  it('flags COLUMN_TYPE_MISMATCH for incompatible types', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    const sales = dataset('sales', [{ name: 'CustomerID', dataType: 'string' }], [{ CustomerID: '1' }])

    const diagnostics = validateRelationship(
      createModel(),
      { one: colRef('customers', 'CustomerID'), many: colRef('sales', 'CustomerID') },
      { customers, sales },
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'COLUMN_TYPE_MISMATCH' }))
  })

  it('allows integer/decimal and date/datetime as compatible families', () => {
    const one = dataset('one', [{ name: 'K', dataType: 'integer' }], [{ K: 1 }])
    const many = dataset('many', [{ name: 'K', dataType: 'decimal' }], [{ K: 1 }])

    const diagnostics = validateRelationship(createModel(), { one: colRef('one', 'K'), many: colRef('many', 'K') }, { one, many })

    expect(diagnostics.some((d) => d.code === 'COLUMN_TYPE_MISMATCH')).toBe(false)
  })

  it('flags ONE_SIDE_NOT_UNIQUE when the one-side column has duplicate values', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 1 }])
    const sales = dataset('sales', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])

    const diagnostics = validateRelationship(
      createModel(),
      { one: colRef('customers', 'CustomerID'), many: colRef('sales', 'CustomerID') },
      { customers, sales },
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'ONE_SIDE_NOT_UNIQUE' }))
  })

  it('flags DUPLICATE_RELATIONSHIP when the same column pair already exists (either direction)', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    const sales = dataset('sales', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    const datasets = { customers, sales }

    let model = addTable(createModel(), { datasetId: 'customers', tableId: 'customers-table' })
    model = addTable(model, { datasetId: 'sales', tableId: 'sales-table' })
    model = {
      ...model,
      relationships: [
        {
          id: 'existing',
          one: colRef('customers', 'CustomerID'),
          many: colRef('sales', 'CustomerID'),
          cardinality: 'one-to-many',
          crossFilterDirection: 'single',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const diagnostics = validateRelationship(
      model,
      { one: colRef('sales', 'CustomerID'), many: colRef('customers', 'CustomerID') },
      datasets,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'DUPLICATE_RELATIONSHIP' }))
  })

  it('flags UNMATCHED_FOREIGN_KEYS as a non-blocking warning with a match rate', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    const sales = dataset(
      'sales',
      [{ name: 'CustomerID', dataType: 'integer' }],
      [{ CustomerID: 1 }, { CustomerID: 999 }],
    )

    const diagnostics = validateRelationship(
      createModel(),
      { one: colRef('customers', 'CustomerID'), many: colRef('sales', 'CustomerID') },
      { customers, sales },
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'UNMATCHED_FOREIGN_KEYS', details: expect.objectContaining({ matchRate: 0.5, unmatchedCount: 1 }) }),
    ])
  })

  it('validates the Retail sample star schema relationships with no errors', () => {
    const [customersDs, productsDs, salesDs, calendarDs] = generateRetailDataset()
    const datasets = {
      [customersDs.id]: customersDs,
      [productsDs.id]: productsDs,
      [salesDs.id]: salesDs,
      [calendarDs.id]: calendarDs,
    }

    const findColumn = (dataset: Dataset, name: string) => dataset.tables[0].columns.find((c) => c.name === name)!

    const relationships = [
      { one: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: findColumn(customersDs, 'CustomerID').id }, many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'CustomerID').id } },
      { one: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumn(productsDs, 'ProductID').id }, many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'ProductID').id } },
      { one: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id }, many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'Date').id } },
    ]

    const model = createModel()
    for (const relationship of relationships) {
      const diagnostics = validateRelationship(model, relationship, datasets)
      expect(diagnostics.some((d) => d.severity === 'error')).toBe(false)
    }
  })
})
