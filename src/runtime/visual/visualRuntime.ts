import type { Dataset } from '../../domain/data'
import type { ColumnRef, SemanticModel } from '../../domain/model'
import type { SlicerMode, TableVisualSpec, VisualSpec } from '../../domain/visual'
import { VISUAL_CARDINALITY_LIMITS } from '../../domain/visual'
import type { ColumnFilter, FilterContext } from '../measure/filterContext'
import { getDistinctVisualMembers } from './grouping'
import type { KpiQueryResult, VisualQueryResult } from './types'
import { runBarVisual, runGroupedTableVisual, runKpiVisual, runLineVisual, runScalarTableVisual } from './visualQuery'

export { mergeFilterContexts } from '../measure/filterContext'
export { getDistinctVisualMembers, evaluateGroupedRows, BLANK_MEMBER_LABEL } from './grouping'
export { runKpiVisual, runBarVisual, runLineVisual, runGroupedTableVisual, runScalarTableVisual } from './visualQuery'
export * from './types'

export function runTableVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: TableVisualSpec,
  notebookContext: FilterContext,
): VisualQueryResult {
  if (spec.dimension) {
    return runGroupedTableVisual(model, datasets, { ...spec, dimension: spec.dimension }, notebookContext)
  }
  return runScalarTableVisual(model, datasets, spec, notebookContext)
}

/**
 * Single entry point `VisualRenderer.tsx` uses for the four measure-backed
 * visual types. Slicers are excluded on purpose — they don't evaluate a
 * measure at all (see `runSlicerMembers` below).
 */
export function runVisualQuery(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: Exclude<VisualSpec, { type: 'slicer' }>,
  notebookContext: FilterContext,
): VisualQueryResult | KpiQueryResult {
  switch (spec.type) {
    case 'kpi':
      return runKpiVisual(model, datasets, spec, notebookContext)
    case 'bar':
      return runBarVisual(model, datasets, spec, notebookContext)
    case 'line':
      return runLineVisual(model, datasets, spec, notebookContext)
    case 'table':
      return runTableVisual(model, datasets, spec, notebookContext)
  }
}

export interface SlicerMembers {
  values: unknown[]
  hasBlank: boolean
  truncated?: { shown: number; total: number }
}

/** Resolves the selectable options for a Slicer visual, capped at the same 200-value limit as `ContextFilterEditor` (Sprint 7 brief §18/§33). */
export function runSlicerMembers(datasets: Record<string, Dataset>, spec: { column: ColumnRef }): SlicerMembers | undefined {
  const members = getDistinctVisualMembers(datasets, spec.column)
  if (!members) return undefined

  const limit = VISUAL_CARDINALITY_LIMITS.slicer
  if (members.values.length <= limit) {
    return { values: members.values, hasBlank: members.hasBlank }
  }
  return { values: members.values.slice(0, limit), hasBlank: members.hasBlank, truncated: { shown: limit, total: members.values.length } }
}

/**
 * Builds the canonical `ColumnFilter` a Slicer emits into the shared
 * `NotebookVisualContext` — always keyed by `{ datasetId, tableId,
 * columnId }` straight from the Slicer's own `ColumnRef`, never a
 * `ModelTable.id` (Sprint 7 brief §34, the explicit Sprint 4 regression to
 * avoid). Returns `undefined` for an empty selection ("All").
 */
export function buildSlicerFilter(
  column: ColumnRef,
  selectedValues: unknown[],
  mode: SlicerMode = 'single',
): ColumnFilter | undefined {
  if (selectedValues.length === 0) return undefined
  if (mode === 'single') return { column, operator: 'equals', values: [selectedValues[0]] }
  return { column, operator: 'in', values: selectedValues }
}
