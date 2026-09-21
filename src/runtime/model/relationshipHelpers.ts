import type { ColumnRef, CrossFilterDirection, ModelTable, Relationship, RelationshipSide, SemanticModel } from '../../domain/model'
import { modelTableFor } from './modelTableLookup'

/**
 * Sprint 11's single centralized module for relationship orientation. No
 * other runtime file may read `relationship.left`/`.right` and decide
 * "which side is the one/many/source/target side" on its own — every such
 * decision routes through here, so cardinality/direction semantics are
 * defined exactly once (sprint brief §4).
 */

export function relationshipEndpoint(relationship: Relationship, side: RelationshipSide): ColumnRef {
  return side === 'left' ? relationship.left : relationship.right
}

export function relationshipOtherSide(side: RelationshipSide): RelationshipSide {
  return side === 'left' ? 'right' : 'left'
}

/** Only meaningful for `one-to-many` — `undefined` for `one-to-one`/`many-to-many`, which have no unique "1" side. */
export function relationshipOneEndpoint(relationship: Relationship): ColumnRef | undefined {
  if (relationship.cardinality !== 'one-to-many' || !relationship.oneSide) return undefined
  return relationshipEndpoint(relationship, relationship.oneSide)
}

/** Only meaningful for `one-to-many` — the "*" side, the opposite of `relationshipOneEndpoint`. */
export function relationshipManyEndpoint(relationship: Relationship): ColumnRef | undefined {
  if (relationship.cardinality !== 'one-to-many' || !relationship.oneSide) return undefined
  return relationshipEndpoint(relationship, relationshipOtherSide(relationship.oneSide))
}

export function relationshipEndpointTables(
  model: SemanticModel,
  relationship: Relationship,
): { leftTable: ModelTable | undefined; rightTable: ModelTable | undefined } {
  return { leftTable: modelTableFor(model, relationship.left), rightTable: modelTableFor(model, relationship.right) }
}

function sameColumn(a: ColumnRef, b: ColumnRef): boolean {
  return a.datasetId === b.datasetId && a.tableId === b.tableId && a.columnId === b.columnId
}

/** True if `relationship` connects exactly `{a, b}` (in either order) — the "which relationship does this column pair name" test USERELATIONSHIP/CROSSFILTER/duplicate-detection all need. */
export function relationshipConnectsColumns(relationship: Relationship, a: ColumnRef, b: ColumnRef): boolean {
  const direct = sameColumn(relationship.left, a) && sameColumn(relationship.right, b)
  const swapped = sameColumn(relationship.left, b) && sameColumn(relationship.right, a)
  return direct || swapped
}

/** True if `relationship`'s two endpoint tables are exactly `{tableIdA, tableIdB}` (in either order) — used to find "sibling" relationships between the same table pair (role-playing detection, USERELATIONSHIP conflict suppression). */
export function relationshipConnectsTables(model: SemanticModel, relationship: Relationship, tableIdA: string, tableIdB: string): boolean {
  const { leftTable, rightTable } = relationshipEndpointTables(model, relationship)
  if (!leftTable || !rightTable) return false
  const direct = leftTable.id === tableIdA && rightTable.id === tableIdB
  const swapped = leftTable.id === tableIdB && rightTable.id === tableIdA
  return direct || swapped
}

/** Every other relationship (excluding `relationship` itself) connecting the same two endpoint tables, regardless of column or active state — the "role-playing siblings" set (sprint brief §19, §27, §46). */
export function siblingRelationships(model: SemanticModel, relationship: Relationship): Relationship[] {
  const { leftTable, rightTable } = relationshipEndpointTables(model, relationship)
  if (!leftTable || !rightTable) return []
  return model.relationships.filter(
    (r) => r.id !== relationship.id && relationshipConnectsTables(model, r, leftTable.id, rightTable.id),
  )
}

/**
 * Scoped, per-call override state a `USERELATIONSHIP`/`CROSSFILTER`
 * `CALCULATE` modifier writes into (`runtime/measure/contextModifier.ts`'s
 * `EffectiveContext`) — never the persisted `SemanticModel` (sprint brief
 * §25-26). `directionOverrides` only ever holds `'left-to-right'`/
 * `'right-to-left'` members (never `'both'`) so a 1:1 `USERELATIONSHIP`'s
 * single-direction semantics stay bounded (sprint brief §31): two opposing
 * invocations union to both directions being present, never silently
 * treated as `'both'` by construction.
 */
export interface EffectiveRelationshipState {
  activatedRelationshipIds: Set<string>
  suppressedRelationshipIds: Set<string>
  directionOverrides: Map<string, Set<Exclude<CrossFilterDirection, 'both'>>>
}

export function createEmptyRelationshipState(): EffectiveRelationshipState {
  return { activatedRelationshipIds: new Set(), suppressedRelationshipIds: new Set(), directionOverrides: new Map() }
}

export function cloneRelationshipState(state: EffectiveRelationshipState): EffectiveRelationshipState {
  return {
    activatedRelationshipIds: new Set(state.activatedRelationshipIds),
    suppressedRelationshipIds: new Set(state.suppressedRelationshipIds),
    directionOverrides: new Map([...state.directionOverrides].map(([id, dirs]) => [id, new Set(dirs)])),
  }
}

/** Whether `relationship` participates in propagation right now, folding the model's persisted `active` flag with this call's activation/suppression overrides — suppression always wins (sprint brief §26-27). */
export function isRelationshipEffectivelyActive(relationship: Relationship, state: EffectiveRelationshipState): boolean {
  if (state.suppressedRelationshipIds.has(relationship.id)) return false
  if (state.activatedRelationshipIds.has(relationship.id)) return true
  return relationship.active
}

export interface RelationshipPropagationEdge {
  relationshipId: string
  sourceModelTableId: string
  sourceColumn: ColumnRef
  targetModelTableId: string
  targetColumn: ColumnRef
  direction: Exclude<CrossFilterDirection, 'both'>
}

function edgeFor(
  relationship: Relationship,
  model: SemanticModel,
  from: RelationshipSide,
): RelationshipPropagationEdge | undefined {
  const to = relationshipOtherSide(from)
  const sourceTable = modelTableFor(model, relationshipEndpoint(relationship, from))
  const targetTable = modelTableFor(model, relationshipEndpoint(relationship, to))
  if (!sourceTable || !targetTable) return undefined
  return {
    relationshipId: relationship.id,
    sourceModelTableId: sourceTable.id,
    sourceColumn: relationshipEndpoint(relationship, from),
    targetModelTableId: targetTable.id,
    targetColumn: relationshipEndpoint(relationship, to),
    direction: from === 'left' ? 'left-to-right' : 'right-to-left',
  }
}

/**
 * Derives every directed propagation edge implied by the model's effective
 * relationship graph — the single source of truth `propagate()` (filter
 * propagation) and the directed-ambiguity walk (`graphAnalysis.ts`) both
 * consume, so no runtime file computes propagation direction independently
 * (sprint brief §11-14). `relationshipState` defaults to "no overrides",
 * i.e. exactly the persisted model's own active/inactive state — this is
 * what every model-level diagnostic (`validateModel`, relationship
 * creation/activation validation) means by "the graph".
 *
 * Edge count per relationship (sprint brief §12):
 * - `one-to-many`, single direction: 1 edge, one → many.
 * - `one-to-many`, both: 2 edges.
 * - `one-to-one` (always `both`, enforced at validation time): 2 edges,
 *   unless a `USERELATIONSHIP` direction override narrows it to 1 (sprint
 *   brief §31 — the only case `directionOverrides` can produce fewer edges
 *   than the persisted `crossFilterDirection` would otherwise imply).
 * - `many-to-many`, one direction: 1 edge. `both`: 2 edges.
 */
export function relationshipPropagationEdges(
  model: SemanticModel,
  relationshipState: EffectiveRelationshipState = createEmptyRelationshipState(),
): RelationshipPropagationEdge[] {
  const edges: RelationshipPropagationEdge[] = []

  for (const relationship of model.relationships) {
    if (!isRelationshipEffectivelyActive(relationship, relationshipState)) continue

    const override = relationshipState.directionOverrides.get(relationship.id)
    if (override && override.size > 0) {
      for (const direction of override) {
        const edge = edgeFor(relationship, model, direction === 'left-to-right' ? 'left' : 'right')
        if (edge) edges.push(edge)
      }
      continue
    }

    const direction = relationship.crossFilterDirection
    if (direction === 'both') {
      const leftToRight = edgeFor(relationship, model, 'left')
      const rightToLeft = edgeFor(relationship, model, 'right')
      if (leftToRight) edges.push(leftToRight)
      if (rightToLeft) edges.push(rightToLeft)
    } else {
      const edge = edgeFor(relationship, model, direction === 'left-to-right' ? 'left' : 'right')
      if (edge) edges.push(edge)
    }
  }

  return edges
}

/**
 * Directed adjacency built from effective propagation edges: `source ->
 * [{to, relationshipId}]`, keeping every parallel edge between the same
 * table pair distinct (two simultaneously-active relationships between the
 * same two tables — e.g. OrderDate + ShipDate both active — are two
 * separate 1-hop paths, not one).
 */
function directedEdgeAdjacency(edges: RelationshipPropagationEdge[]): Map<string, { to: string; relationshipId: string }[]> {
  const adjacency = new Map<string, { to: string; relationshipId: string }[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.sourceModelTableId) ?? []
    list.push({ to: edge.targetModelTableId, relationshipId: edge.relationshipId })
    adjacency.set(edge.sourceModelTableId, list)
  }
  return adjacency
}

/**
 * Distinct simple-path count from `start` to `end`: node-simple (no table
 * revisited within one path), but deliberately *not* edge-deduplicated — two
 * parallel edges from the same source to the same immediate neighbor are two
 * distinct 1-hop paths, matching "how many ways can this filter propagate"
 * rather than "how many distinct neighbors are reachable". A legal
 * bidirectional `A ↔ B` is never mistaken for ambiguity this way: it
 * contributes exactly one A→B edge and one B→A edge, each a single-hop path
 * in its own direction (sprint brief §15-17/§66). Stops at 2 — callers only
 * need ">1".
 */
function countSimplePaths(adjacency: Map<string, { to: string; relationshipId: string }[]>, start: string, end: string): number {
  let count = 0
  const visited = new Set<string>([start])

  function walk(node: string) {
    for (const { to } of adjacency.get(node) ?? []) {
      if (count >= 2) return
      if (to === end) {
        count += 1
        continue
      }
      if (visited.has(to)) continue
      visited.add(to)
      walk(to)
      visited.delete(to)
    }
  }

  walk(start)
  return count
}

/** Every ordered table pair reachable by more than one distinct directed propagation path (sprint brief §16-17). Shared by `graphAnalysis.ts`'s model-wide diagnostics and `modelRuntime.ts`'s create/activate-time validation — one algorithm, not two. */
export function findAmbiguousDirectedPairs(edges: RelationshipPropagationEdge[], tableIds: string[]): [string, string][] {
  const adjacency = directedEdgeAdjacency(edges)
  const ambiguous: [string, string][] = []

  for (const start of tableIds) {
    for (const end of tableIds) {
      if (start === end) continue
      if (countSimplePaths(adjacency, start, end) > 1) ambiguous.push([start, end])
    }
  }

  return ambiguous
}

/** Convenience boolean form — used wherever a caller only needs "would this model's effective graph be ambiguous", not the specific pairs (relationship creation/activation validation, sprint brief §18/§20). */
export function hasAmbiguousDirectedPath(model: SemanticModel, relationshipState?: EffectiveRelationshipState): boolean {
  const edges = relationshipPropagationEdges(model, relationshipState)
  return findAmbiguousDirectedPairs(edges, model.tables.map((t) => t.id)).length > 0
}
