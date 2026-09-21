import type { Dataset } from '../../domain/data'
import type { ModelDiagnostic, ModelTable, Relationship, SemanticModel } from '../../domain/model'
import { findAmbiguousDirectedPairs, relationshipPropagationEdges } from './relationshipHelpers'
import { resolveTableRef } from './modelRuntime'

export { modelTableFor } from './modelTableLookup'
import { modelTableFor } from './modelTableLookup'

export function activeRelationships(model: SemanticModel): Relationship[] {
  return model.relationships.filter((r) => r.active)
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
    const leftTable = modelTableFor(model, relationship.left)
    const rightTable = modelTableFor(model, relationship.right)
    if (leftTable) touched.add(leftTable.id)
    if (rightTable) touched.add(rightTable.id)
  }
  return model.tables.filter((t) => !touched.has(t.id))
}

interface TableRole {
  modelTableId: string
  oneSideCount: number
  manySideCount: number
}

/**
 * Fact/dimension role inference is scoped to classic `one-to-many`
 * relationships only (sprint brief §45) — a one-to-one, many-to-many or
 * bidirectional relationship carries no "1 side"/"many side" role and must
 * never be counted here, so an advanced model is never misdiagnosed as a
 * broken star schema just for using a feature the old heuristic didn't
 * anticipate.
 */
function computeTableRoles(model: SemanticModel): TableRole[] {
  const roles = new Map<string, TableRole>()
  for (const table of model.tables) {
    roles.set(table.id, { modelTableId: table.id, oneSideCount: 0, manySideCount: 0 })
  }

  for (const relationship of activeRelationships(model)) {
    if (relationship.cardinality !== 'one-to-many' || !relationship.oneSide) continue
    const oneTable = modelTableFor(model, relationship.oneSide === 'left' ? relationship.left : relationship.right)
    const manyTable = modelTableFor(model, relationship.oneSide === 'left' ? relationship.right : relationship.left)
    if (oneTable) roles.get(oneTable.id)!.oneSideCount += 1
    if (manyTable) roles.get(manyTable.id)!.manySideCount += 1
  }

  return [...roles.values()]
}

/**
 * Infers fact-like vs dimension-like tables purely from one-to-many
 * relationship topology (never from table names, never from one-to-one or
 * many-to-many relationships — see `computeTableRoles`). A table that is
 * only ever the "many" side is fact-like; one that is only ever the "1"
 * side is dimension-like; a table that plays both roles is flagged for
 * review.
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

/** All relationships (active + inactive) connecting the same pair of endpoint tables, grouped by an order-independent table-pair key. */
function relationshipsByTablePair(model: SemanticModel): Map<string, Relationship[]> {
  const groups = new Map<string, Relationship[]>()
  for (const relationship of model.relationships) {
    const leftTable = modelTableFor(model, relationship.left)
    const rightTable = modelTableFor(model, relationship.right)
    if (!leftTable || !rightTable) continue
    const key = [leftTable.id, rightTable.id].sort().join(':')
    const list = groups.get(key) ?? []
    list.push(relationship)
    groups.set(key, list)
  }
  return groups
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

  const edges = relationshipPropagationEdges(model)
  const ambiguousPairs = findAmbiguousDirectedPairs(edges, model.tables.map((t) => t.id))
  for (const [source, target] of ambiguousPairs) {
    diagnostics.push({
      severity: 'error',
      code: 'AMBIGUOUS_FILTER_PATH',
      message: `More than one active relationship path can propagate a filter from "${label(source)}" to "${label(target)}". Filter propagation between them would be ambiguous — deactivate or remove one of the competing relationships.`,
      details: { source, target },
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
      message: `Multiple tables (${factLike.map(label).join(', ')}) are only ever on the "many" side of a one-to-many relationship. Verify this is intentional rather than a modeling mistake.`,
      details: { factLike },
    })
  }

  for (const modelTableId of mixedRole) {
    diagnostics.push({
      severity: 'warning',
      code: 'DIMENSION_ON_MANY_SIDE',
      message: `"${label(modelTableId)}" is the "1" side in some one-to-many relationships but the "many" side in others. Dimension tables usually stay on the "1" side — check the relationship direction.`,
      details: { modelTableId },
    })
  }

  for (const relationship of model.relationships) {
    if (relationship.crossFilterDirection === 'both' && relationship.cardinality !== 'one-to-one') {
      diagnostics.push({
        severity: 'warning',
        code: 'BIDIRECTIONAL_FILTERING_WARNING',
        message: `"${label(modelTableFor(model, relationship.left)?.id ?? '')}" ↔ "${label(modelTableFor(model, relationship.right)?.id ?? '')}" filters in both directions. This is a legitimate Power BI feature, but it can make filter propagation harder to predict — understand why before relying on it.`,
        details: { relationshipId: relationship.id },
      })
    }
    if (relationship.cardinality === 'many-to-many') {
      diagnostics.push({
        severity: 'warning',
        code: 'MANY_TO_MANY_WARNING',
        message: `The relationship between "${label(modelTableFor(model, relationship.left)?.id ?? '')}" and "${label(modelTableFor(model, relationship.right)?.id ?? '')}" is many-to-many — neither side is guaranteed unique, so treat aggregated results carefully.`,
        details: { relationshipId: relationship.id },
      })
    }
    if (!relationship.active) {
      diagnostics.push({
        severity: 'info',
        code: 'INACTIVE_RELATIONSHIP',
        message: `The relationship between "${label(modelTableFor(model, relationship.left)?.id ?? '')}" and "${label(modelTableFor(model, relationship.right)?.id ?? '')}" is inactive — it won't propagate filters unless a measure activates it with USERELATIONSHIP.`,
        details: { relationshipId: relationship.id },
      })
    }
  }

  for (const [, relationships] of relationshipsByTablePair(model)) {
    if (relationships.length < 2) continue
    const leftTable = modelTableFor(model, relationships[0].left)
    const rightTable = modelTableFor(model, relationships[0].right)
    diagnostics.push({
      severity: 'info',
      code: 'MULTIPLE_RELATIONSHIPS_BETWEEN_TABLES',
      message: `${relationships.length} relationships connect "${label(leftTable?.id ?? '')}" and "${label(rightTable?.id ?? '')}". Only one can be active at a time without creating an ambiguous filter path.`,
      details: { relationshipIds: relationships.map((r) => r.id) },
    })

    const activeCount = relationships.filter((r) => r.active).length
    if (activeCount === 1 && relationships.length - activeCount >= 1) {
      diagnostics.push({
        severity: 'info',
        code: 'ROLE_PLAYING_RELATIONSHIP_PATTERN',
        message: `"${label(leftTable?.id ?? '')}" plays multiple roles for "${label(rightTable?.id ?? '')}" (e.g. Order Date vs. Ship Date) — one relationship is active, the rest are available via USERELATIONSHIP.`,
        details: { relationshipIds: relationships.map((r) => r.id) },
      })
    }
  }

  return diagnostics
}
