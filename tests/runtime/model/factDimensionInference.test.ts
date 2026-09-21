import { describe, expect, it } from 'vitest'
import type { Relationship, SemanticModel } from '../../../src/domain/model'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import { inferFactDimensionRoles, validateModel } from '../../../src/runtime/model/graphAnalysis'

function withTables(names: string[]): SemanticModel {
  let model = createModel()
  for (const name of names) {
    model = addTable(model, { datasetId: name, tableId: `${name}-table` })
  }
  return model
}

function relationship(oneDataset: string, manyDataset: string): Relationship {
  return {
    id: `${manyDataset}->${oneDataset}`,
    left: { datasetId: oneDataset, tableId: `${oneDataset}-table`, columnId: `${oneDataset}-col` },
    right: { datasetId: manyDataset, tableId: `${manyDataset}-table`, columnId: `${manyDataset}-col` },
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

describe('fact/dimension inference', () => {
  it('identifies one fact-like table and its dimensions from a star schema', () => {
    const model = withTables(['customers', 'products', 'calendar', 'sales'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('customers', 'sales'), relationship('products', 'sales'), relationship('calendar', 'sales')],
    }

    const roles = inferFactDimensionRoles(withRelationships)
    const salesId = model.tables.find((t) => t.datasetId === 'sales')!.id
    const dimensionIds = model.tables.filter((t) => t.datasetId !== 'sales').map((t) => t.id)

    expect(roles.factLike).toEqual([salesId])
    expect(roles.dimensionLike.sort()).toEqual(dimensionIds.sort())
    expect(roles.mixedRole).toEqual([])

    const diagnostics = validateModel(withRelationships, {})
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'STAR_SCHEMA_VALID' }))
  })

  it('flags a table that plays both roles as mixed and warns about it', () => {
    const model = withTables(['a', 'b', 'c'])
    // b is the "1" side toward c, but the "many" side toward a: mixed role.
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('a', 'b'), relationship('b', 'c')],
    }

    const roles = inferFactDimensionRoles(withRelationships)
    const bId = model.tables.find((t) => t.datasetId === 'b')!.id
    expect(roles.mixedRole).toEqual([bId])

    const diagnostics = validateModel(withRelationships, {})
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'DIMENSION_ON_MANY_SIDE', details: expect.objectContaining({ modelTableId: bId }) }))
  })

  it('warns when multiple tables are only ever on the many side', () => {
    const model = withTables(['a', 'x', 'y'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('a', 'x'), relationship('a', 'y')],
    }
    // Both x and y are pure many-side (fact-like) with no dimension table pointing at either.
    const roles = inferFactDimensionRoles(withRelationships)
    expect(roles.factLike.sort()).toEqual(
      model.tables.filter((t) => t.datasetId === 'x' || t.datasetId === 'y').map((t) => t.id).sort(),
    )

    const diagnostics = validateModel(withRelationships, {})
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'MULTIPLE_FACT_TABLES' }))
  })
})
