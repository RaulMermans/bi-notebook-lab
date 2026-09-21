import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { addTable, createModel, createRelationshipConfig, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

function dataset(id: string, columns: { name: string; dataType: 'integer' | 'string' }[], rows: Record<string, unknown>[]): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [{ id: `${id}-table`, name: id, columns: columns.map((c, i) => ({ id: `${id}-col-${i}`, ...c, nullable: false })), rows, rowCount: rows.length }],
    createdAt: new Date().toISOString(),
  }
}

function colRef(datasetId: string, columnIndex: number) {
  return { datasetId, tableId: `${datasetId}-table`, columnId: `${datasetId}-col-${columnIndex}` }
}

describe('cardinality-aware relationship validation (sprint 11)', () => {
  it('accepts a valid one-to-one relationship (both sides unique) with a required BOTH direction', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    const profiles = dataset('profiles', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: profiles.id, tableId: 'profiles-table' })
    const datasets = { customers, profiles }

    const result = createRelationshipConfig(
      model,
      { left: colRef('customers', 0), right: colRef('profiles', 0), cardinality: 'one-to-one', crossFilterDirection: 'both', active: true },
      datasets,
    )

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.relationship?.cardinality).toBe('one-to-one')
    expect(result.relationship?.crossFilterDirection).toBe('both')
  })

  it('ONE_TO_ONE_REQUIRES_BOTH blocks a single-direction 1:1 relationship', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    const profiles = dataset('profiles', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: profiles.id, tableId: 'profiles-table' })
    const datasets = { customers, profiles }

    const result = createRelationshipConfig(
      model,
      { left: colRef('customers', 0), right: colRef('profiles', 0), cardinality: 'one-to-one', crossFilterDirection: 'left-to-right', active: true },
      datasets,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'ONE_TO_ONE_REQUIRES_BOTH' }))
    expect(result.relationship).toBeUndefined()
  })

  it('rejects a 1:1 relationship when either side has duplicate values', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 1 }])
    const profiles = dataset('profiles', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }, { CustomerID: 2 }])
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: profiles.id, tableId: 'profiles-table' })
    const datasets = { customers, profiles }

    const result = createRelationshipConfig(
      model,
      { left: colRef('customers', 0), right: colRef('profiles', 0), cardinality: 'one-to-one', crossFilterDirection: 'both', active: true },
      datasets,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'LEFT_SIDE_NOT_UNIQUE' }))
  })

  it('accepts a many-to-many relationship with duplicates on both sides, emitting a pedagogical warning', () => {
    const products = dataset('products', [{ name: 'Category', dataType: 'string' }], [{ Category: 'A' }, { Category: 'A' }, { Category: 'B' }])
    const targets = dataset('targets', [{ name: 'Category', dataType: 'string' }], [{ Category: 'A' }, { Category: 'B' }, { Category: 'B' }])
    let model = addTable(createModel(), { datasetId: products.id, tableId: 'products-table' })
    model = addTable(model, { datasetId: targets.id, tableId: 'targets-table' })
    const datasets = { products, targets }

    const result = createRelationshipConfig(
      model,
      { left: colRef('products', 0), right: colRef('targets', 0), cardinality: 'many-to-many', crossFilterDirection: 'left-to-right', active: true },
      datasets,
    )

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'MANY_TO_MANY_RELATIONSHIP' }))
    expect(result.relationship?.cardinality).toBe('many-to-many')
  })

  it('a one-to-many relationship rejects the reverse single direction relative to its configured oneSide', () => {
    const customers = dataset('customers', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    const sales = dataset('sales', [{ name: 'CustomerID', dataType: 'integer' }], [{ CustomerID: 1 }])
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
    const datasets = { customers, sales }

    const result = createRelationshipConfig(
      model,
      {
        left: colRef('customers', 0),
        right: colRef('sales', 0),
        cardinality: 'one-to-many',
        oneSide: 'left',
        crossFilterDirection: 'right-to-left',
        active: true,
      },
      datasets,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'INVALID_CROSS_FILTER_DIRECTION' }))
  })

  it('RELATIONSHIP_CREATES_AMBIGUOUS_PATH blocks creating a second active relationship between the same table pair', () => {
    const calendar = dataset('calendar', [{ name: 'Date', dataType: 'string' }], [{ Date: '2024-01-01' }])
    const sales = dataset(
      'sales',
      [
        { name: 'OrderDate', dataType: 'string' },
        { name: 'ShipDate', dataType: 'string' },
      ],
      [{ OrderDate: '2024-01-01', ShipDate: '2024-01-01' }],
    )
    let model = addTable(createModel(), { datasetId: calendar.id, tableId: 'calendar-table' })
    model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
    const datasets = { calendar, sales }

    const orderDateRef = { datasetId: 'calendar', tableId: 'calendar-table', columnId: 'calendar-col-0' }
    const orderDateSales = { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col-0' }
    const shipDateSales = { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col-1' }

    const first = createRelationshipConfig(
      model,
      { left: orderDateRef, right: orderDateSales, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
      datasets,
    )
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    model = first.model

    // ShipDate relationship created active would give Calendar<->Sales two simultaneously-active
    // propagation edges — must be rejected, matching the canonical "one active, rest inactive" shape.
    const second = createRelationshipConfig(
      model,
      { left: orderDateRef, right: shipDateSales, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
      datasets,
    )
    expect(second.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'RELATIONSHIP_CREATES_AMBIGUOUS_PATH' }))
    expect(second.relationship).toBeUndefined()

    // Created inactive, the same relationship is fine — this is the canonical role-playing shape.
    const third = createRelationshipConfig(
      model,
      { left: orderDateRef, right: shipDateSales, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: false },
      datasets,
    )
    expect(third.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(third.relationship).toBeDefined()
  })

  it('setRelationshipActive rejects activating a relationship that would create an ambiguous path, leaving the model unchanged', () => {
    const calendar = dataset('calendar', [{ name: 'Date', dataType: 'string' }], [{ Date: '2024-01-01' }])
    const sales = dataset(
      'sales',
      [
        { name: 'OrderDate', dataType: 'string' },
        { name: 'ShipDate', dataType: 'string' },
      ],
      [{ OrderDate: '2024-01-01', ShipDate: '2024-01-01' }],
    )
    let model = addTable(createModel(), { datasetId: calendar.id, tableId: 'calendar-table' })
    model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
    const datasets = { calendar, sales }

    const orderDateRef = { datasetId: 'calendar', tableId: 'calendar-table', columnId: 'calendar-col-0' }
    const orderDateSales = { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col-0' }
    const shipDateSales = { datasetId: 'sales', tableId: 'sales-table', columnId: 'sales-col-1' }

    const withOrderDate = createRelationshipConfig(
      model,
      { left: orderDateRef, right: orderDateSales, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
      datasets,
    )
    model = withOrderDate.model
    const withShipDate = createRelationshipConfig(
      model,
      { left: orderDateRef, right: shipDateSales, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: false },
      datasets,
    )
    model = withShipDate.model
    const shipDateRelationshipId = withShipDate.relationship!.id

    const activated = setRelationshipActive(model, shipDateRelationshipId, true)

    expect(activated.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'RELATIONSHIP_CREATES_AMBIGUOUS_PATH' }))
    expect(activated.model).toBe(model)
    expect(activated.model.relationships.find((r) => r.id === shipDateRelationshipId)!.active).toBe(false)
  })
})
