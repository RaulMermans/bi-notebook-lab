import type { Dataset } from '../../domain/data'
import type { ModelDiagnostic, ModelTable, Relationship, SemanticModel } from '../../domain/model'
import { detectCycle } from '../../lib/graph/cycle'
import { resolveTableRef } from './modelRuntime'

export function activeRelationships(model: SemanticModel): Relationship[] {
  return model.relationships.filter((r) => r.active)
}

export function modelTableFor(model: SemanticModel, ref: { datasetId: string; tableId: string }): ModelTable | undefined {
  return model.tables.find((t) => t.datasetId === ref.datasetId && t.tableId === ref.tableId)
}

/**
 * Directed edge = active relationship, many → one (a fact-like row "looks
 * up" its dimension). Cycles here mean a lookup chain loops back on itself.
 * Exported so `runtime/measure/filterPropagation.ts` can walk the same graph
 * in the opposite direction (one → many) for filter propagation, rather than
 * building a third adjacency map (docs/FILTER_CONTEXT.md).
 */
export function directedActiveGraph(model: SemanticModel): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const table of model.tables) graph.set(table.id, new Set())

  for (const relationship of activeRelationships(model)) {
    const manyTable = modelTableFor(model, relationship.many)
    const oneTable = modelTableFor(model, relationship.one)
    if (!manyTable || !oneTable) continue
    graph.get(manyTable.id)?.add(oneTable.id)
  }
  return graph
}

/**
 * Undirected edge list for path-counting. Ambiguous filter propagation is a
 * property of "how many ways can two tables reach each other", which is
 * inherently undirected (a diamond A→B, A→C, B→C gives B two ways to reach
 * A: directly, and via C).
 */
export function undirectedActiveEdges(model: SemanticModel): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const table of model.tables) graph.set(table.id, new Set())

  for (const relationship of activeRelationships(model)) {
    const manyTable = modelTableFor(model, relationship.many)
    const oneTable = modelTableFor(model, relationship.one)
    if (!manyTable || !oneTable) continue
    graph.get(manyTable.id)?.add(oneTable.id)
    graph.get(oneTable.id)?.add(manyTable.id)
  }
  return graph
}

/**
 * For each connected pair of tables, counts simple paths between them,
 * stopping once 2 are found (the spec only needs ">1", not an exact count).
 */
function findAmbiguousPairs(graph: Map<string, Set<string>>): [string, string][] {
  const nodes = [...graph.keys()]
  const ambiguous: [string, string][] = []

  function countPaths(start: string, end: string): number {
    let count = 0
    const visited = new Set<string>([start])

    function walk(node: string) {
      if (count >= 2) return
      if (node === end) {
        count += 1
        return
      }
      for (const neighbor of graph.get(node) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        walk(neighbor)
        visited.delete(neighbor)
        if (count >= 2) return
      }
    }

    walk(start)
    return count
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (countPaths(nodes[i], nodes[j]) > 1) {
        ambiguous.push([nodes[i], nodes[j]])
      }
    }
  }

  return ambiguous
}

function tableLabel(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string): string {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  if (!modelTable) return modelTableId
  const resolved = resolveTableRef(datasets, modelTable)
  return resolved?.table.name ?? modelTableId
}

function findIsolatedTables(model: SemanticModel): ModelTable[] {
  const touched = new Set<string>()
  for (const relationship of model.relationships) {
    const manyTable = modelTableFor(model, relationship.many)
    const oneTable = modelTableFor(model, relationship.one)
    if (manyTable) touched.add(manyTable.id)
    if (oneTable) touched.add(oneTable.id)
  }
  return model.tables.filter((t) => !touched.has(t.id))
}

interface TableRole {
  modelTableId: string
  oneSideCount: number
  manySideCount: number
}

function computeTableRoles(model: SemanticModel): TableRole[] {
  const roles = new Map<string, TableRole>()
  for (const table of model.tables) {
    roles.set(table.id, { modelTableId: table.id, oneSideCount: 0, manySideCount: 0 })
  }

  for (const relationship of activeRelationships(model)) {
    const oneTable = modelTableFor(model, relationship.one)
    const manyTable = modelTableFor(model, relationship.many)
    if (oneTable) roles.get(oneTable.id)!.oneSideCount += 1
    if (manyTable) roles.get(manyTable.id)!.manySideCount += 1
  }

  return [...roles.values()]
}

/**
 * Infers fact-like vs dimension-like tables purely from relationship
 * topology (never from table names). A table that is only ever the "many"
 * side is fact-like; one that is only ever the "1" side is dimension-like;
 * a table that plays both roles is flagged for review.
 */
export function inferFactDimensionRoles(model: SemanticModel): {
  factLike: string[]
  dimensionLike: string[]
  mixedRole: string[]
} {
  const roles = computeTableRoles(model)
  const factLike = roles.filter((r) => r.manySideCount > 0 && r.oneSideCount === 0).map((r) => r.modelTableId)
  const dimensionLike = roles.filter((r) => r.oneSideCount > 0 && r.manySideCount === 0).map((r) => r.modelTableId)
  const mixedRole = roles.filter((r) => r.oneSideCount > 0 && r.manySideCount > 0).map((r) => r.modelTableId)
  return { factLike, dimensionLike, mixedRole }
}

export function validateModel(model: SemanticModel, datasets: Record<string, Dataset>): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = []
  const label = (id: string) => tableLabel(model, datasets, id)

  const isolated = findIsolatedTables(model)
  for (const table of isolated) {
    diagnostics.push({
      severity: 'warning',
      code: 'ISOLATED_TABLE',
      message: `"${label(table.id)}" is in the model but has no relationships. It won't filter or be filtered by anything else.`,
      details: { modelTableId: table.id },
    })
  }

  const cycle = detectCycle(directedActiveGraph(model))
  if (cycle.found) {
    diagnostics.push({
      severity: 'error',
      code: 'ACTIVE_CYCLE',
      message: `Active relationships form a cycle: ${cycle.path.map(label).join(' → ')}. This would make filter propagation ambiguous.`,
      details: { path: cycle.path },
    })
  }

  const ambiguousPairs = findAmbiguousPairs(undirectedActiveEdges(model))
  for (const [a, b] of ambiguousPairs) {
    diagnostics.push({
      severity: 'warning',
      code: 'AMBIGUOUS_PATH',
      message: `More than one active relationship path connects "${label(a)}" and "${label(b)}". Filter propagation between them would be ambiguous.`,
      details: { tableA: a, tableB: b },
    })
  }

  const { factLike, dimensionLike, mixedRole } = inferFactDimensionRoles(model)
  const hasBlockingIssues = diagnostics.some((d) => d.severity === 'error')

  if (factLike.length === 1 && dimensionLike.length >= 1 && !hasBlockingIssues) {
    diagnostics.push({
      severity: 'info',
      code: 'STAR_SCHEMA_VALID',
      message: `"${label(factLike[0])}" looks like the fact table, filtered by ${dimensionLike.length} dimension table${dimensionLike.length === 1 ? '' : 's'} (${dimensionLike.map(label).join(', ')}).`,
      details: { fact: factLike[0], dimensions: dimensionLike },
    })
  } else if (factLike.length > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'MULTIPLE_FACT_TABLES',
      message: `Multiple tables (${factLike.map(label).join(', ')}) are only ever on the "many" side. Verify this is intentional rather than a modeling mistake.`,
      details: { factLike },
    })
  }

  for (const modelTableId of mixedRole) {
    diagnostics.push({
      severity: 'warning',
      code: 'DIMENSION_ON_MANY_SIDE',
      message: `"${label(modelTableId)}" is the "1" side in some relationships but the "many" side in others. Dimension tables usually stay on the "1" side — check the relationship direction.`,
      details: { modelTableId },
    })
  }

  return diagnostics
}
