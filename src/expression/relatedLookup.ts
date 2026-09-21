import type { Dataset, DataColumn, DataTable } from '../domain/data'
import type { ColumnRef, Relationship, SemanticModel } from '../domain/model'
import { resolveColumnRef } from '../runtime/model/modelRuntime'
import { relationshipConnectsTables, relationshipEndpoint, relationshipOtherSide } from '../runtime/model/relationshipHelpers'

export type RelatedFailureCode =
  | 'RELATED_NO_RELATIONSHIP'
  | 'RELATED_INACTIVE_RELATIONSHIP'
  | 'RELATED_WRONG_DIRECTION'
  | 'RELATED_AMBIGUOUS_RELATIONSHIP'
  | 'RELATED_UNSUPPORTED_CARDINALITY'

export type ResolveRelatedResult = { relationship: Relationship; targetSide: 'left' | 'right' } | { code: RelatedFailureCode }

/**
 * Finds the single active relationship that lets a `RELATED` call evaluated
 * on `currentModelTableId`'s rows reach `targetModelTableId` (sprint brief
 * §43-44):
 *
 * - `one-to-many`: unchanged from Sprint 3 — only the many→one direction is
 *   ever valid (a many-side row unambiguously looks up its one-side row;
 *   the reverse has no such guarantee).
 * - `one-to-one`: both sides are unique, so lookup is valid in either
 *   direction — `currentModelTableId` may be either endpoint.
 * - `many-to-many`: neither side is guaranteed unique, so `RELATED` could
 *   only ever pick an arbitrary matching row — always rejected with
 *   `RELATED_UNSUPPORTED_CARDINALITY` rather than silently choosing one
 *   (sprint brief §43 "Do not select an arbitrary related row").
 *
 * Deliberately ignores `crossFilterDirection` — `RELATED` is a row-context
 * lookup concept, not a visual filter-propagation concept (sprint brief
 * §44).
 */
export function resolveRelatedRelationship(
  model: SemanticModel,
  currentModelTableId: string,
  targetModelTableId: string,
): ResolveRelatedResult {
  const candidates = model.relationships.filter((r) => relationshipConnectsTables(model, r, currentModelTableId, targetModelTableId))
  if (candidates.length === 0) return { code: 'RELATED_NO_RELATIONSHIP' }

  const manyToMany = candidates.filter((r) => r.cardinality === 'many-to-many')
  if (manyToMany.length > 0) return { code: 'RELATED_UNSUPPORTED_CARDINALITY' }

  const oneToOne = candidates.filter((r) => r.cardinality === 'one-to-one')
  if (oneToOne.length > 0) {
    const active = oneToOne.filter((r) => r.active)
    if (active.length === 1) return { relationship: active[0], targetSide: sideOfTable(model, active[0], targetModelTableId) }
    if (active.length > 1) return { code: 'RELATED_AMBIGUOUS_RELATIONSHIP' }
    return { code: 'RELATED_INACTIVE_RELATIONSHIP' }
  }

  // one-to-many: only many -> one is a valid RELATED direction.
  const correctDirection = candidates.filter((r) => manySideTableId(model, r) === currentModelTableId)
  const reversedDirection = candidates.filter((r) => manySideTableId(model, r) === targetModelTableId)

  const activeCorrect = correctDirection.filter((r) => r.active)
  if (activeCorrect.length === 1) return { relationship: activeCorrect[0], targetSide: activeCorrect[0].oneSide! }
  if (activeCorrect.length > 1) return { code: 'RELATED_AMBIGUOUS_RELATIONSHIP' }
  if (correctDirection.length > 0) return { code: 'RELATED_INACTIVE_RELATIONSHIP' }
  if (reversedDirection.length > 0) return { code: 'RELATED_WRONG_DIRECTION' }
  return { code: 'RELATED_NO_RELATIONSHIP' }
}

function manySideTableId(model: SemanticModel, relationship: Relationship): string | undefined {
  if (!relationship.oneSide) return undefined
  const manySide = relationshipOtherSide(relationship.oneSide)
  const ref = relationshipEndpoint(relationship, manySide)
  return model.tables.find((t) => t.datasetId === ref.datasetId && t.tableId === ref.tableId)?.id
}

function sideOfTable(model: SemanticModel, relationship: Relationship, modelTableId: string): 'left' | 'right' {
  const leftTable = model.tables.find((t) => t.datasetId === relationship.left.datasetId && t.tableId === relationship.left.tableId)
  return leftTable?.id === modelTableId ? 'left' : 'right'
}

/**
 * Builds a `foreign key value -> target-side row` index for a relationship,
 * so `RELATED` lookups across an entire calculated-column evaluation are
 * O(n) rather than re-scanning the target table per row. Runtime-only —
 * never persisted, and rebuilt (cheaply, via a per-evaluation cache)
 * whenever a column is evaluated.
 */
export function buildRelatedIndex(targetTable: DataTable, targetColumn: DataColumn): Map<unknown, Record<string, unknown>> {
  const index = new Map<unknown, Record<string, unknown>>()
  for (const row of targetTable.rows) {
    const value = row[targetColumn.name]
    if (value === null || value === undefined) continue
    index.set(value, row)
  }
  return index
}

function sideMatchingColumnRef(relationship: Relationship, ref: ColumnRef): 'left' | 'right' {
  return relationship.left.datasetId === ref.datasetId && relationship.left.tableId === ref.tableId ? 'left' : 'right'
}

/**
 * Resolves everything one `RELATED(Table[Column])` lookup needs, generic
 * across every cardinality RELATED supports (sprint brief §43-44):
 * `indexTable`/`indexColumn` is the relationship's own key column on
 * whichever side `targetColumnRef` lives on (what the index is built from —
 * `targetColumnRef` itself is a *different* column read off the matched row
 * after lookup, e.g. `RELATED(Products[UnitCost])`'s join key is
 * `ProductID`, not `UnitCost`); `keyColumn` is the relationship's key column
 * on the *other* side — the current row's own foreign-key column the lookup
 * value comes from.
 */
export function resolveRelatedIndexAndKey(
  datasets: Record<string, Dataset>,
  relationship: Relationship,
  targetColumnRef: ColumnRef,
): { indexTable: DataTable; indexColumn: DataColumn; keyColumn: DataColumn } | undefined {
  const targetSide = sideMatchingColumnRef(relationship, targetColumnRef)
  const keySide = relationshipOtherSide(targetSide)
  const indexResolved = resolveColumnRef(datasets, relationshipEndpoint(relationship, targetSide))
  const keyResolved = resolveColumnRef(datasets, relationshipEndpoint(relationship, keySide))
  if (!indexResolved || !keyResolved) return undefined
  return { indexTable: indexResolved.table, indexColumn: indexResolved.column, keyColumn: keyResolved.column }
}
