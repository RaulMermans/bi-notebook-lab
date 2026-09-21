import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../../src/domain/model'
import { hydrateSemanticModel } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 11 §61: a model persisted before Sprint 11 stores relationships as
 * `{ one, many, cardinality: 'one-to-many', crossFilterDirection: 'single' }`.
 * `hydrateSemanticModel` must convert this to the canonical `left`/`right`
 * shape with identical propagation semantics — `left = one, right = many,
 * oneSide = 'left', crossFilterDirection = 'left-to-right'`.
 */
describe('legacy relationship hydration', () => {
  it('converts a legacy one/many relationship to the canonical left/right shape', () => {
    const legacyModel = {
      id: 'model-1',
      name: 'Legacy',
      tables: [
        { id: 'table-customers', datasetId: 'customers-ds', tableId: 'customers-table' },
        { id: 'table-sales', datasetId: 'sales-ds', tableId: 'sales-table' },
      ],
      relationships: [
        {
          id: 'rel-1',
          one: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-id' },
          many: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-customerid' },
          cardinality: 'one-to-many',
          crossFilterDirection: 'single',
          active: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      calculatedColumns: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      // Pre-Sprint-4/10 persisted models also lack `measures`/`dateTables` entirely.
    } as unknown as SemanticModel

    const hydrated = hydrateSemanticModel(legacyModel)

    expect(hydrated.relationships).toHaveLength(1)
    const relationship = hydrated.relationships[0]
    expect(relationship.left).toEqual({ datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-id' })
    expect(relationship.right).toEqual({ datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-customerid' })
    expect(relationship.cardinality).toBe('one-to-many')
    expect(relationship.oneSide).toBe('left')
    expect(relationship.crossFilterDirection).toBe('left-to-right')
    expect(relationship.active).toBe(true)
    expect(relationship.id).toBe('rel-1')
    expect(hydrated.measures).toEqual([])
    expect(hydrated.dateTables).toEqual([])
    // No `one`/`many` fields survive hydration.
    expect(relationship).not.toHaveProperty('one')
    expect(relationship).not.toHaveProperty('many')
  })

  it('leaves an already-canonical relationship unchanged', () => {
    const canonicalModel: SemanticModel = {
      id: 'model-2',
      name: 'Canonical',
      tables: [],
      relationships: [
        {
          id: 'rel-2',
          left: { datasetId: 'a-ds', tableId: 'a-table', columnId: 'a-col' },
          right: { datasetId: 'b-ds', tableId: 'b-table', columnId: 'b-col' },
          cardinality: 'one-to-one',
          crossFilterDirection: 'both',
          active: true,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      calculatedColumns: [],
      measures: [],
      dateTables: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }

    const hydrated = hydrateSemanticModel(canonicalModel)

    expect(hydrated.relationships).toEqual(canonicalModel.relationships)
  })

  it('hydrates an inactive legacy relationship (role-playing dimension survives) without flipping active state', () => {
    const legacyModel = {
      id: 'model-3',
      name: 'Legacy role-playing',
      tables: [],
      relationships: [
        {
          id: 'rel-ship',
          one: { datasetId: 'calendar-ds', tableId: 'calendar-table', columnId: 'date' },
          many: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'ship-date' },
          cardinality: 'one-to-many',
          crossFilterDirection: 'single',
          active: false,
          createdAt: '2024-06-01T00:00:00.000Z',
        },
      ],
      calculatedColumns: [],
      createdAt: '2024-06-01T00:00:00.000Z',
      updatedAt: '2024-06-01T00:00:00.000Z',
    } as unknown as SemanticModel

    const hydrated = hydrateSemanticModel(legacyModel)

    expect(hydrated.relationships[0].active).toBe(false)
    expect(hydrated.relationships[0].oneSide).toBe('left')
  })
})
