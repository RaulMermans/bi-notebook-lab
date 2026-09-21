import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { Relationship, SemanticModel } from '../../src/domain/model'
import { createCalculatedColumn } from '../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { addTable, createModel } from '../../src/runtime/model/modelRuntime'

function customersDataset(): Dataset {
  return {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [{ id: 'customers-id', name: 'CustomerID', dataType: 'integer', nullable: false }],
        rows: [{ CustomerID: 1 }, { CustomerID: 2 }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function profileDataset(): Dataset {
  return {
    id: 'profile-ds',
    name: 'CustomerProfile',
    source: { type: 'sample', key: 'profile' },
    tables: [
      {
        id: 'profile-table',
        name: 'CustomerProfile',
        columns: [
          { id: 'profile-id', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'profile-tier', name: 'LoyaltyTier', dataType: 'string', nullable: false },
        ],
        rows: [
          { CustomerID: 1, LoyaltyTier: 'Gold' },
          { CustomerID: 2, LoyaltyTier: 'Silver' },
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
        columns: [{ id: 'products-category', name: 'Category', dataType: 'string', nullable: false }],
        rows: [{ Category: 'A' }, { Category: 'B' }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function targetsDataset(): Dataset {
  return {
    id: 'targets-ds',
    name: 'Targets',
    source: { type: 'sample', key: 'targets' },
    tables: [
      {
        id: 'targets-table',
        name: 'Targets',
        columns: [{ id: 'targets-category', name: 'Category', dataType: 'string', nullable: false }],
        rows: [{ Category: 'A' }, { Category: 'A' }, { Category: 'B' }],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function oneToOneRelationship(): Relationship {
  return {
    id: 'rel-1-1',
    left: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customers-id' },
    right: { datasetId: 'profile-ds', tableId: 'profile-table', columnId: 'profile-id' },
    cardinality: 'one-to-one',
    crossFilterDirection: 'both',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

function manyToManyRelationship(): Relationship {
  return {
    id: 'rel-m-m',
    left: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'products-category' },
    right: { datasetId: 'targets-ds', tableId: 'targets-table', columnId: 'targets-category' },
    cardinality: 'many-to-many',
    crossFilterDirection: 'left-to-right',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

describe('RELATED cardinality behavior (sprint 11 §43-44)', () => {
  it('looks up through a 1:1 relationship from the Customers side', () => {
    const customers = customersDataset()
    const profile = profileDataset()
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: profile.id, tableId: 'profile-table' })
    const customersTableId = model.tables.find((t) => t.datasetId === customers.id)!.id
    const withRel: SemanticModel = { ...model, relationships: [oneToOneRelationship()] }
    const datasets = { [customers.id]: customers, [profile.id]: profile }

    const result = createCalculatedColumn(withRel, datasets, {
      modelTableId: customersTableId,
      name: 'Tier',
      expression: 'RELATED(CustomerProfile[LoyaltyTier])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.values).toEqual(['Gold', 'Silver'])
  })

  it('looks up through a 1:1 relationship from the CustomerProfile side (reverse direction is equally valid)', () => {
    const customers = customersDataset()
    const profile = profileDataset()
    let model = addTable(createModel(), { datasetId: customers.id, tableId: 'customers-table' })
    model = addTable(model, { datasetId: profile.id, tableId: 'profile-table' })
    const profileTableId = model.tables.find((t) => t.datasetId === profile.id)!.id
    const withRel: SemanticModel = { ...model, relationships: [oneToOneRelationship()] }
    const datasets = { [customers.id]: customers, [profile.id]: profile }

    // CustomerProfile has no CustomerID *name* column, so look up nothing meaningful except to
    // prove resolution succeeds in this direction too — reuse CustomerID itself as a trivial probe.
    const result = createCalculatedColumn(withRel, datasets, {
      modelTableId: profileTableId,
      name: 'ProbeId',
      expression: 'RELATED(Customers[CustomerID])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.values).toEqual([1, 2])
  })

  it('rejects RELATED through a many-to-many relationship with RELATED_UNSUPPORTED_CARDINALITY, never picking an arbitrary row', () => {
    const products = productsDataset()
    const targets = targetsDataset()
    let model = addTable(createModel(), { datasetId: products.id, tableId: 'products-table' })
    model = addTable(model, { datasetId: targets.id, tableId: 'targets-table' })
    const productsTableId = model.tables.find((t) => t.datasetId === products.id)!.id
    const withRel: SemanticModel = { ...model, relationships: [manyToManyRelationship()] }
    const datasets = { [products.id]: products, [targets.id]: targets }

    const result = createCalculatedColumn(withRel, datasets, {
      modelTableId: productsTableId,
      name: 'BadLookup',
      expression: 'RELATED(Targets[Category])',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RELATED_UNSUPPORTED_CARDINALITY' })])
  })
})
