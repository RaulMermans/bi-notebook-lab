import type { Dataset, DataColumn, DataTable } from '../domain/data'
import type { ModelTable, Relationship, SemanticModel } from '../domain/model'
import { resolveColumnRef } from '../runtime/model/modelRuntime'

export type RelatedFailureCode =
  | 'RELATED_NO_RELATIONSHIP'
  | 'RELATED_INACTIVE_RELATIONSHIP'
  | 'RELATED_WRONG_DIRECTION'
  | 'RELATED_AMBIGUOUS_RELATIONSHIP'

export type ResolveRelatedResult = { relationship: Relationship } | { code: RelatedFailureCode }

function tableRefOf(relationshipSide: { datasetId: string; tableId: string }, model: SemanticModel): ModelTable | undefined {
  return model.tables.find((t) => t.datasetId === relationshipSide.datasetId && t.tableId === relationshipSide.tableId)
}

/**
 * Finds the single active many->one relationship that lets a `RELATED` call
 * evaluated on `currentModelTableId`'s rows reach `targetModelTableId`.
 * Sprint 3 only supports a direct, active, unambiguous many-side lookup
 * (see docs/CALCULATED_COLUMNS.md "RELATED rules").
 */
export function resolveRelatedRelationship(
  model: SemanticModel,
  currentModelTableId: string,
  targetModelTableId: string,
): ResolveRelatedResult {
  const correctDirection = model.relationships.filter((r) => {
    const many = tableRefOf(r.many, model)
    const one = tableRefOf(r.one, model)
    return many?.id === currentModelTableId && one?.id === targetModelTableId
  })
  const reversedDirection = model.relationships.filter((r) => {
    const many = tableRefOf(r.many, model)
    const one = tableRefOf(r.one, model)
    return many?.id === targetModelTableId && one?.id === currentModelTableId
  })

  const activeCorrect = correctDirection.filter((r) => r.active)
  if (activeCorrect.length === 1) return { relationship: activeCorrect[0] }
  if (activeCorrect.length > 1) return { code: 'RELATED_AMBIGUOUS_RELATIONSHIP' }
  if (correctDirection.length > 0) return { code: 'RELATED_INACTIVE_RELATIONSHIP' }
  if (reversedDirection.length > 0) return { code: 'RELATED_WRONG_DIRECTION' }
  return { code: 'RELATED_NO_RELATIONSHIP' }
}

/**
 * Builds a `foreign key value -> one-side row` index for a relationship, so
 * `RELATED` lookups across an entire calculated-column evaluation are
 * O(n) rather than re-scanning the one-side table per row. Runtime-only —
 * never persisted, and rebuilt (cheaply, via a per-evaluation cache) whenever
 * a column is evaluated.
 */
export function buildRelatedIndex(oneTable: DataTable, oneColumn: DataColumn): Map<unknown, Record<string, unknown>> {
  const index = new Map<unknown, Record<string, unknown>>()
  for (const row of oneTable.rows) {
    const value = row[oneColumn.name]
    if (value === null || value === undefined) continue
    index.set(value, row)
  }
  return index
}

export function resolveOneSideTable(
  datasets: Record<string, Dataset>,
  relationship: Relationship,
): { table: DataTable; column: DataColumn } | undefined {
  const resolved = resolveColumnRef(datasets, relationship.one)
  if (!resolved) return undefined
  return { table: resolved.table, column: resolved.column }
}

export function resolveManySideColumn(
  datasets: Record<string, Dataset>,
  relationship: Relationship,
): DataColumn | undefined {
  return resolveColumnRef(datasets, relationship.many)?.column
}
