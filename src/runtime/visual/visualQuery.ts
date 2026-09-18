import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { BarVisualSpec, KpiVisualSpec, LineVisualSpec, TableVisualSpec } from '../../domain/visual'
import { VISUAL_CARDINALITY_LIMITS } from '../../domain/visual'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import { resolveColumnRef } from '../model/modelRuntime'
import type { FilterContext } from '../measure/filterContext'
import { evaluateMeasure } from '../measure/measureRuntime'
import { evaluateGroupedRows, getDistinctVisualMembers } from './grouping'
import { sortBarRows, sortLineRows } from './sorting'
import {
  hasVisualError,
  visualDiagnostic,
  type KpiQueryResult,
  type VisualDataRow,
  type VisualDiagnostic,
  type VisualQueryResult,
} from './types'

function mapExpressionDiagnostics(diagnostics: ExpressionDiagnostic[]): VisualDiagnostic[] {
  return diagnostics.map((d) =>
    visualDiagnostic('error', d.code === 'FILTER_GRAPH_INVALID' ? 'VISUAL_FILTER_GRAPH_INVALID' : 'VISUAL_QUERY_FAILED', d.message),
  )
}

function errorResult(code: VisualDiagnostic['code'], message: string): VisualQueryResult {
  return { status: 'error', rows: [], diagnostics: [visualDiagnostic('error', code, message)] }
}

function isNumericLike(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'number'
}

/**
 * KPI execution (Sprint 7 brief §5/§23): `NotebookVisualContext` →
 * `evaluateMeasure` → format result. No fabricated zero — a missing
 * measure or an evaluation error is surfaced as a diagnostic, never a
 * silent `0`.
 */
export function runKpiVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: KpiVisualSpec,
  notebookContext: FilterContext,
): KpiQueryResult {
  const measure = model.measures.find((m) => m.id === spec.measureId)
  if (!measure) {
    return {
      status: 'error',
      value: undefined,
      dataType: 'unknown',
      diagnostics: [visualDiagnostic('error', 'VISUAL_MEASURE_NOT_FOUND', 'This KPI references a measure that no longer exists in the model.')],
    }
  }

  const execution = evaluateMeasure(model, datasets, measure.id, notebookContext)
  const diagnostics = mapExpressionDiagnostics(execution.diagnostics)
  return {
    status: hasVisualError(diagnostics) ? 'error' : 'success',
    value: hasVisualError(diagnostics) ? undefined : execution.value,
    dataType: execution.dataType,
    diagnostics,
    trace: execution.trace,
  }
}

/** Shared preflight: measure exists, and evaluates cleanly (no FILTER_GRAPH_INVALID/etc) under the current context, before doing any N x M grouping work. */
function preflightMeasures(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  measureIds: string[],
  notebookContext: FilterContext,
): VisualDiagnostic[] {
  for (const measureId of measureIds) {
    const measure = model.measures.find((m) => m.id === measureId)
    if (!measure) {
      return [visualDiagnostic('error', 'VISUAL_MEASURE_NOT_FOUND', 'This visual references a measure that no longer exists in the model.')]
    }
    const execution = evaluateMeasure(model, datasets, measureId, notebookContext)
    const diagnostics = mapExpressionDiagnostics(execution.diagnostics)
    if (hasVisualError(diagnostics)) return diagnostics
  }
  return []
}

function applyLimit(rows: VisualDataRow[], limit: number): { rows: VisualDataRow[]; truncated?: { shown: number; total: number } } {
  if (rows.length <= limit) return { rows }
  return { rows: rows.slice(0, limit), truncated: { shown: limit, total: rows.length } }
}

function truncationDiagnostic(kind: string, truncated: { shown: number; total: number } | undefined): VisualDiagnostic[] {
  if (!truncated) return []
  return [
    visualDiagnostic(
      'info',
      'VISUAL_HIGH_CARDINALITY',
      `Showing top ${truncated.shown} of ${truncated.total} ${kind}.`,
    ),
  ]
}

/** Bar chart execution — grouped measure evaluation over `Products[Category]`-style dimensions (Sprint 7 brief §6/§24/§30). */
export function runBarVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: BarVisualSpec,
  notebookContext: FilterContext,
): VisualQueryResult {
  const columnResolved = resolveColumnRef(datasets, spec.category)
  if (!columnResolved) {
    return errorResult('VISUAL_COLUMN_NOT_FOUND', 'This bar chart references a category column that no longer exists.')
  }

  const preflight = preflightMeasures(model, datasets, [spec.measureId], notebookContext)
  if (hasVisualError(preflight)) return { status: 'error', rows: [], diagnostics: preflight }

  const baseline = evaluateMeasure(model, datasets, spec.measureId, notebookContext)
  const diagnostics: VisualDiagnostic[] = []
  if (!isNumericLike(baseline.value)) {
    return errorResult('VISUAL_NON_NUMERIC_MEASURE', 'This bar chart’s measure did not return a number, so it cannot be charted.')
  }

  const members = getDistinctVisualMembers(datasets, spec.category)!
  const rawRows = evaluateGroupedRows(model, datasets, spec.category, [spec.measureId], notebookContext, members)
  const sorted = sortBarRows(rawRows, spec.measureId, spec.sort ?? 'value-desc', columnResolved.column.dataType)
  const limit = spec.limit ?? VISUAL_CARDINALITY_LIMITS.bar
  const { rows, truncated } = applyLimit(sorted, limit)
  diagnostics.push(...truncationDiagnostic('categories', truncated))

  return { status: 'success', rows, diagnostics, truncated }
}

/** Line chart execution — grouped measure evaluation over a chronologically/numerically sorted axis (Sprint 7 brief §7/§20/§31). */
export function runLineVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: LineVisualSpec,
  notebookContext: FilterContext,
): VisualQueryResult {
  const columnResolved = resolveColumnRef(datasets, spec.axis)
  if (!columnResolved) {
    return errorResult('VISUAL_COLUMN_NOT_FOUND', 'This line chart references an axis column that no longer exists.')
  }

  const preflight = preflightMeasures(model, datasets, [spec.measureId], notebookContext)
  if (hasVisualError(preflight)) return { status: 'error', rows: [], diagnostics: preflight }

  const baseline = evaluateMeasure(model, datasets, spec.measureId, notebookContext)
  if (!isNumericLike(baseline.value)) {
    return errorResult('VISUAL_NON_NUMERIC_MEASURE', 'This line chart’s measure did not return a number, so it cannot be charted.')
  }

  const diagnostics: VisualDiagnostic[] = []
  const axisType = columnResolved.column.dataType
  if (axisType === 'boolean' || axisType === 'unknown' || axisType === 'null') {
    diagnostics.push(
      visualDiagnostic('warning', 'VISUAL_INVALID_AXIS_TYPE', `"${columnResolved.column.name}" is a ${axisType} column, which is an unusual choice for a line chart axis.`),
    )
  }

  const members = getDistinctVisualMembers(datasets, spec.axis)!
  const rawRows = evaluateGroupedRows(model, datasets, spec.axis, [spec.measureId], notebookContext, members)
  const sorted = sortLineRows(rawRows, spec.sort ?? 'axis-asc', axisType)
  const limit = VISUAL_CARDINALITY_LIMITS.line
  const { rows, truncated } = applyLimit(sorted, limit)
  diagnostics.push(...truncationDiagnostic('points', truncated))

  return { status: 'success', rows, diagnostics, truncated }
}

/** Table with a configured dimension: one row per distinct member, one column per measure (Sprint 7 brief §8/§25/§32). */
export function runGroupedTableVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: TableVisualSpec & { dimension: NonNullable<TableVisualSpec['dimension']> },
  notebookContext: FilterContext,
): VisualQueryResult {
  const columnResolved = resolveColumnRef(datasets, spec.dimension)
  if (!columnResolved) {
    return errorResult('VISUAL_COLUMN_NOT_FOUND', 'This table references a row dimension column that no longer exists.')
  }

  const preflight = preflightMeasures(model, datasets, spec.measureIds, notebookContext)
  if (hasVisualError(preflight)) return { status: 'error', rows: [], diagnostics: preflight }

  const members = getDistinctVisualMembers(datasets, spec.dimension)!
  const rawRows = evaluateGroupedRows(model, datasets, spec.dimension, spec.measureIds, notebookContext, members)
  const limit = spec.limit ?? VISUAL_CARDINALITY_LIMITS.table
  const { rows, truncated } = applyLimit(rawRows, limit)
  const diagnostics = truncationDiagnostic('rows', truncated)

  return { status: 'success', rows, diagnostics, truncated }
}

/** Table with no dimension configured: one row per measure, evaluated once under the shared context (Sprint 7 brief §8 "If no dimension is configured"). */
export function runScalarTableVisual(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: TableVisualSpec,
  notebookContext: FilterContext,
): VisualQueryResult {
  const preflight = preflightMeasures(model, datasets, spec.measureIds, notebookContext)
  if (hasVisualError(preflight)) return { status: 'error', rows: [], diagnostics: preflight }

  const rows: VisualDataRow[] = spec.measureIds.map((measureId) => {
    const measure = model.measures.find((m) => m.id === measureId)!
    const execution = evaluateMeasure(model, datasets, measureId, notebookContext)
    return { dimensionLabel: measure.name, measureValues: { [measureId]: execution.value } }
  })

  return { status: 'success', rows, diagnostics: [] }
}
