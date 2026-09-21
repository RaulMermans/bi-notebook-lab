import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { removeRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { evaluateModelHealthRule, evaluateRelationshipRule, evaluateTablePresenceRule } from '../../../src/runtime/validation/structuralValidation'
import { buildRetailModel } from './helpers'

/** A hand-built two-table model whose relationships form a directed cycle (A → B → A), independent of buildRetailModel's star schema (which can't express a cycle without violating one-side uniqueness). */
function buildCyclicModel(): { model: SemanticModel; datasets: Record<string, Dataset> } {
  const datasetA: Dataset = {
    id: 'ds-a', name: 'A', source: { type: 'sample', key: 'a' },
    tables: [{ id: 'table-a', name: 'A', columns: [
      { id: 'a-key', name: 'Key', dataType: 'integer', nullable: false },
      { id: 'a-bkey', name: 'BKey', dataType: 'integer', nullable: false },
    ], rows: [{ Key: 1, BKey: 1 }], rowCount: 1 }],
    createdAt: new Date().toISOString(),
  }
  const datasetB: Dataset = {
    id: 'ds-b', name: 'B', source: { type: 'sample', key: 'b' },
    tables: [{ id: 'table-b', name: 'B', columns: [
      { id: 'b-key', name: 'Key', dataType: 'integer', nullable: false },
      { id: 'b-akey', name: 'AKey', dataType: 'integer', nullable: false },
    ], rows: [{ Key: 1, AKey: 1 }], rowCount: 1 }],
    createdAt: new Date().toISOString(),
  }

  const model: SemanticModel = {
    id: 'model-cyclic', name: 'Cyclic', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    tables: [
      { id: 'mt-a', datasetId: 'ds-a', tableId: 'table-a' },
      { id: 'mt-b', datasetId: 'ds-b', tableId: 'table-b' },
    ],
    calculatedColumns: [],
    measures: [],
    relationships: [
      {
        id: 'rel-a-to-b', cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true, createdAt: new Date().toISOString(),
        left: { datasetId: 'ds-a', tableId: 'table-a', columnId: 'a-key' },
        right: { datasetId: 'ds-b', tableId: 'table-b', columnId: 'b-akey' },
      },
      {
        id: 'rel-b-to-a', cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true, createdAt: new Date().toISOString(),
        left: { datasetId: 'ds-b', tableId: 'table-b', columnId: 'b-key' },
        right: { datasetId: 'ds-a', tableId: 'table-a', columnId: 'a-bkey' },
      },
    ],
  }

  return { model, datasets: { [datasetA.id]: datasetA, [datasetB.id]: datasetB } }
}

/** A three-table model with a genuine diamond (A -> B -> C and A -> C directly) — two distinct propagation paths from A to C, which is what Sprint 11's AMBIGUOUS_FILTER_PATH actually detects (unlike the legal two-table cycle above). */
function buildDiamondModel(): { model: SemanticModel; datasets: Record<string, Dataset> } {
  const { model: cyclic, datasets } = buildCyclicModel()
  const datasetC: Dataset = {
    id: 'ds-c', name: 'C', source: { type: 'sample', key: 'c' },
    tables: [{ id: 'table-c', name: 'C', columns: [
      { id: 'c-akey', name: 'AKey', dataType: 'integer', nullable: false },
      { id: 'c-bkey', name: 'BKey', dataType: 'integer', nullable: false },
    ], rows: [{ AKey: 1, BKey: 1 }], rowCount: 1 }],
    createdAt: new Date().toISOString(),
  }

  const model: SemanticModel = {
    ...cyclic,
    tables: [...cyclic.tables, { id: 'mt-c', datasetId: 'ds-c', tableId: 'table-c' }],
    relationships: [
      // Keep only the legal a->b edge from the cyclic fixture (drop b->a so this is a clean diamond, not also a cycle).
      cyclic.relationships[0],
      {
        id: 'rel-a-to-c', cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true, createdAt: new Date().toISOString(),
        left: { datasetId: 'ds-a', tableId: 'table-a', columnId: 'a-key' },
        right: { datasetId: 'ds-c', tableId: 'table-c', columnId: 'c-akey' },
      },
      {
        id: 'rel-b-to-c', cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true, createdAt: new Date().toISOString(),
        left: { datasetId: 'ds-b', tableId: 'table-b', columnId: 'b-key' },
        right: { datasetId: 'ds-c', tableId: 'table-c', columnId: 'c-bkey' },
      },
    ],
  }

  return { model, datasets: { ...datasets, [datasetC.id]: datasetC } }
}

describe('structuralValidation', () => {
  it('passes a correctly-directed, active relationship', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateRelationshipRule(
      {
        id: 'rel', type: 'relationship', title: 'Customers → Sales', points: 10,
        one: { table: { tableName: 'Customers' }, columnName: 'CustomerID' },
        many: { table: { tableName: 'Sales' }, columnName: 'CustomerID' },
      },
      model,
      datasets,
    )
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('fails when the relationship runs the wrong direction', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateRelationshipRule(
      {
        id: 'rel', type: 'relationship', title: 'Customers → Sales', points: 10,
        one: { table: { tableName: 'Sales' }, columnName: 'CustomerID' },
        many: { table: { tableName: 'Customers' }, columnName: 'CustomerID' },
      },
      model,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.pointsEarned).toBe(0)
    expect(result.feedback[0].code).toBe('RELATIONSHIP_WRONG_DIRECTION')
  })

  it('fails when the relationship uses the wrong column', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateRelationshipRule(
      {
        id: 'rel', type: 'relationship', title: 'Products → Sales', points: 10,
        one: { table: { tableName: 'Products' }, columnName: 'ProductID' },
        many: { table: { tableName: 'Sales' }, columnName: 'OrderID' },
      },
      model,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('RELATIONSHIP_MISSING')
  })

  it('fails when active is expected but the relationship is inactive', () => {
    const { model, datasets, customerRelationshipId } = buildRetailModel()
    const { model: disabled } = setRelationshipActive(model, customerRelationshipId, false)
    const result = evaluateRelationshipRule(
      {
        id: 'rel', type: 'relationship', title: 'Customers → Sales', points: 10,
        one: { table: { tableName: 'Customers' }, columnName: 'CustomerID' },
        many: { table: { tableName: 'Sales' }, columnName: 'CustomerID' },
      },
      disabled,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('RELATIONSHIP_WRONG_ACTIVE_STATE')
  })

  it('fails when the relationship does not exist at all', () => {
    const { model, datasets, customerRelationshipId } = buildRetailModel()
    const withoutRel = removeRelationship(model, customerRelationshipId)
    const result = evaluateRelationshipRule(
      {
        id: 'rel', type: 'relationship', title: 'Customers → Sales', points: 10,
        one: { table: { tableName: 'Customers' }, columnName: 'CustomerID' },
        many: { table: { tableName: 'Sales' }, columnName: 'CustomerID' },
      },
      withoutRel,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('RELATIONSHIP_MISSING')
  })

  it('passes model health when the graph is a valid star schema', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateModelHealthRule(
      { id: 'health', type: 'model-health', title: 'Valid star schema', points: 10, requireValidGraph: true, requireStarSchema: true },
      model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('a directed cycle among active relationships is legal and passes model health (ACTIVE_CYCLE is retired, sprint brief §15)', () => {
    const { model, datasets } = buildCyclicModel()
    const result = evaluateModelHealthRule(
      { id: 'health', type: 'model-health', title: 'Valid graph', points: 10, requireValidGraph: true },
      model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('fails model health when the active relationship graph has an ambiguous path (a diamond)', () => {
    const { model, datasets } = buildDiamondModel()
    const result = evaluateModelHealthRule(
      { id: 'health', type: 'model-health', title: 'Valid graph', points: 10, requireValidGraph: true },
      model,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback.some((f) => f.code === 'AMBIGUOUS_FILTER_PATH')).toBe(true)
  })

  it('table-present rule passes once the table has been added to the model', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateTablePresenceRule({ id: 'tp', type: 'table-present', title: 'Sales present', points: 5, table: { tableName: 'Sales' } }, model, datasets)
    expect(result.status).toBe('passed')
  })

  it('table-present rule fails when the table has not been added', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateTablePresenceRule({ id: 'tp', type: 'table-present', title: 'Warehouse present', points: 5, table: { tableName: 'Warehouse' } }, model, datasets)
    expect(result.status).toBe('failed')
  })
})
