import { describe, expect, it } from 'vitest'
import { resolveFilterContext } from '../../../src/runtime/measure/filterPropagation'
import { buildRelationshipStates, buildTableStates } from '../../../src/runtime/context/graphAdapter'
import { moveTable, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { buildStarSchemaFixture } from './starSchemaFixture'

describe('graphAdapter (diagram state)', () => {
  it('marks a directly-filtered table DIRECT and its propagated dependent PROPAGATED', () => {
    const { model, datasets, customersTableId, salesTableId, countryColumn } = buildStarSchemaFixture()
    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)

    const tables = buildTableStates(model, state)
    const relationships = buildRelationshipStates(model, datasets, state)

    expect(tables.find((t) => t.modelTableId === customersTableId)!.filterState).toBe('direct')
    expect(tables.find((t) => t.modelTableId === salesTableId)!.filterState).toBe('propagated')

    const relationship = relationships.find((r) => r.oneModelTableId === customersTableId && r.manyModelTableId === salesTableId)!
    expect(relationship.state).toBe('propagated')
  })

  it('marks an untouched table UNFILTERED', () => {
    const { model, datasets, productsTableId, countryColumn } = buildStarSchemaFixture()
    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    const tables = buildTableStates(model, state)

    const products = tables.find((t) => t.modelTableId === productsTableId)!
    expect(products.filterState).toBe('unfiltered')
    expect(products.visibleRows).toBe(products.totalRows)
  })

  it('marks an inactive relationship INACTIVE and leaves the many side unfiltered by it', () => {
    const { model, datasets, productsTableId, salesTableId, productRelationshipId, categoryColumn } = buildStarSchemaFixture()
    const disabled = setRelationshipActive(model, productRelationshipId, false)
    const filterContext = {
      filters: [{ column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] }],
    }
    const state = resolveFilterContext(disabled, datasets, filterContext)

    const relationships = buildRelationshipStates(disabled, datasets, state)
    const relationship = relationships.find((r) => r.relationshipId === productRelationshipId)!
    expect(relationship.state).toBe('inactive')

    const tables = buildTableStates(disabled, state)
    expect(tables.find((t) => t.modelTableId === productsTableId)!.filterState).toBe('direct') // Products is still directly filtered...
    expect(tables.find((t) => t.modelTableId === salesTableId)!.filterState).toBe('unfiltered') // ...but Sales never hears about it.
  })

  it('marks an active relationship with no filter applied as ACTIVE / NO EFFECT, not PROPAGATED', () => {
    const { model, datasets } = buildStarSchemaFixture()
    const state = resolveFilterContext(model, datasets, { filters: [] })
    const relationships = buildRelationshipStates(model, datasets, state)

    expect(relationships.every((r) => r.active)).toBe(true)
    expect(relationships.every((r) => r.state === 'active-no-effect')).toBe(true)
    expect(relationships.every((r) => !r.propagated)).toBe(true)
  })

  it('reuses ModelTable.position when present, and moving a table never changes visible-row counts', () => {
    const { model, datasets, customersTableId, countryColumn } = buildStarSchemaFixture()
    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }

    const beforeState = resolveFilterContext(model, datasets, filterContext)
    const beforeTables = buildTableStates(model, beforeState)
    const beforeCustomers = beforeTables.find((t) => t.modelTableId === customersTableId)!
    expect(beforeCustomers.position).toBeUndefined()

    const moved = moveTable(model, customersTableId, { x: 999, y: 42 })
    const afterState = resolveFilterContext(moved, datasets, filterContext)
    const afterTables = buildTableStates(moved, afterState)
    const afterCustomers = afterTables.find((t) => t.modelTableId === customersTableId)!

    expect(afterCustomers.position).toEqual({ x: 999, y: 42 })
    expect(afterCustomers.visibleRows).toBe(beforeCustomers.visibleRows)
    expect(afterCustomers.totalRows).toBe(beforeCustomers.totalRows)
    expect(afterCustomers.filterState).toBe(beforeCustomers.filterState)
  })
})
