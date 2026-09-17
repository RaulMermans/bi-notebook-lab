import { describe, expect, it } from 'vitest'
import type { Relationship, SemanticModel } from '../../../src/domain/model'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import { validateModel } from '../../../src/runtime/model/graphAnalysis'

function withTables(names: string[]): { model: SemanticModel; ids: Record<string, string> } {
  let model = createModel()
  const ids: Record<string, string> = {}
  for (const name of names) {
    model = addTable(model, { datasetId: name, tableId: `${name}-table` })
    ids[name] = model.tables[model.tables.length - 1].id
  }
  return { model, ids }
}

function relationship(oneDataset: string, manyDataset: string, active = true): Relationship {
  return {
    id: `${manyDataset}->${oneDataset}`,
    one: { datasetId: oneDataset, tableId: `${oneDataset}-table`, columnId: `${oneDataset}-col` },
    many: { datasetId: manyDataset, tableId: `${manyDataset}-table`, columnId: `${manyDataset}-col` },
    cardinality: 'one-to-many',
    crossFilterDirection: 'single',
    active,
    createdAt: new Date().toISOString(),
  }
}

describe('validateModel graph diagnostics', () => {
  it('reports a clean star schema with no cycle/ambiguous/isolated diagnostics', () => {
    const { model } = withTables(['customers', 'products', 'calendar', 'sales'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('customers', 'sales'), relationship('products', 'sales'), relationship('calendar', 'sales')],
    }

    const diagnostics = validateModel(withRelationships, {})

    expect(diagnostics.some((d) => d.code === 'ACTIVE_CYCLE')).toBe(false)
    expect(diagnostics.some((d) => d.code === 'AMBIGUOUS_PATH')).toBe(false)
    expect(diagnostics.some((d) => d.code === 'ISOLATED_TABLE')).toBe(false)
    expect(diagnostics.some((d) => d.code === 'STAR_SCHEMA_VALID')).toBe(true)
  })

  it('detects an isolated table', () => {
    const { model } = withTables(['customers', 'sales', 'unrelated'])
    const withRelationships: SemanticModel = { ...model, relationships: [relationship('customers', 'sales')] }

    const diagnostics = validateModel(withRelationships, {})

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'ISOLATED_TABLE' }))
  })

  it('detects a cycle among active relationships', () => {
    const { model } = withTables(['a', 'b', 'c'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('a', 'b'), relationship('b', 'c'), relationship('c', 'a')],
    }

    const diagnostics = validateModel(withRelationships, {})

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'ACTIVE_CYCLE' }))
  })

  it('detects an ambiguous active path in a diamond shape', () => {
    const { model } = withTables(['a', 'b', 'c'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('a', 'b'), relationship('a', 'c'), relationship('b', 'c')],
    }

    const diagnostics = validateModel(withRelationships, {})

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'AMBIGUOUS_PATH' }))
  })

  it('excludes inactive relationships from cycle and ambiguous-path analysis', () => {
    const { model } = withTables(['a', 'b', 'c'])
    const withRelationships: SemanticModel = {
      ...model,
      relationships: [relationship('a', 'b'), relationship('b', 'c'), relationship('c', 'a', false)],
    }

    const diagnostics = validateModel(withRelationships, {})

    expect(diagnostics.some((d) => d.code === 'ACTIVE_CYCLE')).toBe(false)
  })
})
