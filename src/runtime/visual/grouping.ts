import type { Dataset } from '../../domain/data'
import type { ColumnRef, SemanticModel } from '../../domain/model'
import { resolveColumnRef } from '../model/modelRuntime'
import { mergeFilterContexts, type FilterContext } from '../measure/filterContext'
import { evaluateMeasure } from '../measure/measureRuntime'
import type { VisualDataRow } from './types'

export const BLANK_MEMBER_LABEL = '(Blank)'

export interface DistinctMembersResult {
  /** Deduped, non-blank raw values, in first-seen row order (stable, deterministic). */
  values: unknown[]
  hasBlank: boolean
  totalRows: number
}

/**
 * Resolves the real, distinct physical-column values a Visual can group by
 * — never derived from rendered labels (Sprint 7 brief §16). Blank
 * (`null`/`undefined`) values are tracked separately (`hasBlank`) rather
 * than folded into `values`, so callers decide explicitly whether to
 * surface a `"(Blank)"` group (brief §53).
 */
export function getDistinctVisualMembers(
  datasets: Record<string, Dataset>,
  column: ColumnRef,
): DistinctMembersResult | undefined {
  const resolved = resolveColumnRef(datasets, column)
  if (!resolved) return undefined

  const seen = new Set<unknown>()
  const values: unknown[] = []
  let hasBlank = false

  for (const row of resolved.table.rows) {
    const value = row[resolved.column.name]
    if (value === null || value === undefined) {
      hasBlank = true
      continue
    }
    if (!seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }

  return { values, hasBlank, totalRows: resolved.table.rowCount }
}

function formatMemberLabel(value: unknown): string {
  if (value === null || value === undefined) return BLANK_MEMBER_LABEL
  return String(value)
}

/**
 * The central Sprint 7 execution mechanism (brief §24): for each distinct
 * member of `dimension`, merges the notebook/slicer `FilterContext` with a
 * `dimension = member` filter and re-evaluates every measure in
 * `measureIds` under that merged context via the real, unmodified Sprint 4
 * `evaluateMeasure`. This is `N` distinct members `x` `M` measures calls —
 * the naive-but-correct strategy the brief explicitly accepts for bounded
 * MVP visuals (§57) rather than a second aggregation/group-by engine.
 *
 * Unsorted and unlimited — callers apply sorting/cardinality limits
 * (`sorting.ts`) on top of this, since the correct sort key (e.g. "value
 * descending") isn't known until every group has been evaluated once.
 */
export function evaluateGroupedRows(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  dimension: ColumnRef,
  measureIds: string[],
  notebookContext: FilterContext,
  members: DistinctMembersResult,
): VisualDataRow[] {
  const memberValues: (unknown | undefined)[] = [...members.values]
  if (members.hasBlank) memberValues.push(null)

  return memberValues.map((memberValue) => {
    const memberContext = mergeFilterContexts(notebookContext, {
      filters: [{ column: dimension, operator: 'equals', values: [memberValue] }],
    })

    const measureValues: Record<string, unknown> = {}
    for (const measureId of measureIds) {
      const execution = evaluateMeasure(model, datasets, measureId, memberContext)
      measureValues[measureId] = execution.value
    }

    return { dimensionValue: memberValue, dimensionLabel: formatMemberLabel(memberValue), measureValues }
  })
}
