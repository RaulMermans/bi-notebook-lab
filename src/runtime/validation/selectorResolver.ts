import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, Measure, ModelTable, SemanticModel } from '../../domain/model'
import type { CalculatedColumnSelector, ColumnSelector, MeasureSelector, TableSelector } from '../../domain/validation'
import { resolveTableRef } from '../model/modelRuntime'

export type SelectorTargetKind = 'table' | 'column' | 'measure' | 'calculated-column'
export type SelectorResolutionErrorCode = 'VALIDATION_TARGET_NOT_FOUND' | 'VALIDATION_TARGET_AMBIGUOUS'

export interface SelectorResolutionError {
  code: SelectorResolutionErrorCode
  targetKind: SelectorTargetKind
  message: string
  details?: Record<string, unknown>
}

export type SelectorResolution<T> = { ok: true; value: T } | { ok: false; error: SelectorResolutionError }

function ok<T>(value: T): SelectorResolution<T> {
  return { ok: true, value }
}

function fail<T>(
  targetKind: SelectorTargetKind,
  code: SelectorResolutionErrorCode,
  message: string,
  details?: Record<string, unknown>,
): SelectorResolution<T> {
  return { ok: false, error: { code, targetKind, message, details } }
}

/**
 * Whether a resolution failure reflects "the learner hasn't built this yet"
 * (safe to score as a normal rule failure) or "the selector/model state can't
 * be resolved deterministically" (a validation configuration error — see
 * docs/VALIDATION_ENGINE.md "Validation errors are not learner failures").
 *
 * A missing table/measure/calculated column is something the learner is
 * expected to create, so `VALIDATION_TARGET_NOT_FOUND` there is a normal
 * "failed" outcome. A missing *column* means the selector names a column
 * that should already exist on the underlying dataset (columns are never
 * learner-authored the way tables/measures/calculated columns are), so it's
 * always treated as a configuration error. Any ambiguity is always a
 * configuration error — see AGENTS.md "Do not silently select the first
 * match".
 */
export function classifySelectorFailure(error: SelectorResolutionError): 'failed' | 'error' {
  if (error.code === 'VALIDATION_TARGET_AMBIGUOUS') return 'error'
  if (error.targetKind === 'column') return 'error'
  return 'failed'
}

function sourceKeyOf(dataset: Dataset): string | undefined {
  const source = dataset.source
  if (source.type === 'sample') return source.key
  if (source.type === 'xlsx') return source.sheetName
  if (source.type === 'csv') return source.fileName
  return undefined
}

export interface ResolvedModelTable {
  modelTable: ModelTable
  dataset: Dataset
  tableName: string
}

/** Resolves a `TableSelector` to the (single) `ModelTable` it names — see docs/VALIDATION_ENGINE.md "Selector resolution". */
export function resolveTableSelector(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  selector: TableSelector,
): SelectorResolution<ResolvedModelTable> {
  const lowerName = selector.tableName.toLowerCase()
  const candidates: ResolvedModelTable[] = []

  for (const modelTable of model.tables) {
    const resolved = resolveTableRef(datasets, modelTable)
    if (!resolved) continue
    if (resolved.table.name.toLowerCase() !== lowerName) continue
    if (selector.sourceKey !== undefined && sourceKeyOf(resolved.dataset) !== selector.sourceKey) continue
    candidates.push({ modelTable, dataset: resolved.dataset, tableName: resolved.table.name })
  }

  if (candidates.length === 0) {
    return fail(
      'table',
      'VALIDATION_TARGET_NOT_FOUND',
      `"${selector.tableName}" is not in the model yet.`,
      { selector },
    )
  }
  if (candidates.length > 1) {
    return fail(
      'table',
      'VALIDATION_TARGET_AMBIGUOUS',
      `More than one table named "${selector.tableName}" is in the model${selector.sourceKey ? ` (source "${selector.sourceKey}")` : ''}.`,
      { selector, matchCount: candidates.length },
    )
  }
  return ok(candidates[0])
}

export interface ResolvedColumn {
  modelTable: ModelTable
  datasetId: string
  tableId: string
  columnId: string
  columnName: string
  tableName: string
}

/** Resolves a `ColumnSelector` to a specific physical `DataColumn` on the model. */
export function resolveColumnSelector(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  selector: ColumnSelector,
): SelectorResolution<ResolvedColumn> {
  const tableResolution = resolveTableSelector(model, datasets, selector.table)
  if (!tableResolution.ok) return tableResolution

  const { modelTable, dataset, tableName } = tableResolution.value
  const table = dataset.tables.find((t) => t.id === modelTable.tableId)
  if (!table) {
    return fail('column', 'VALIDATION_TARGET_NOT_FOUND', `Table "${tableName}" could not be resolved.`, { selector })
  }

  const lowerColumn = selector.columnName.toLowerCase()
  const matches = table.columns.filter((c) => c.name.toLowerCase() === lowerColumn)

  if (matches.length === 0) {
    return fail('column', 'VALIDATION_TARGET_NOT_FOUND', `"${tableName}" has no column named "${selector.columnName}".`, { selector })
  }
  if (matches.length > 1) {
    return fail('column', 'VALIDATION_TARGET_AMBIGUOUS', `"${tableName}" has more than one column named "${selector.columnName}".`, {
      selector,
      matchCount: matches.length,
    })
  }

  return ok({
    modelTable,
    datasetId: dataset.id,
    tableId: table.id,
    columnId: matches[0].id,
    columnName: matches[0].name,
    tableName,
  })
}

/** Resolves a `MeasureSelector` to a `Measure` by name (case-insensitive). */
export function resolveMeasureSelector(model: SemanticModel, selector: MeasureSelector): SelectorResolution<Measure> {
  const lower = selector.name.toLowerCase()
  const matches = model.measures.filter((m) => m.name.toLowerCase() === lower)

  if (matches.length === 0) {
    return fail('measure', 'VALIDATION_TARGET_NOT_FOUND', `Measure "${selector.name}" does not exist in the model yet.`, { selector })
  }
  if (matches.length > 1) {
    return fail('measure', 'VALIDATION_TARGET_AMBIGUOUS', `More than one measure named "${selector.name}" exists in the model.`, {
      selector,
      matchCount: matches.length,
    })
  }
  return ok(matches[0])
}

/** Resolves a `CalculatedColumnSelector` to a `CalculatedColumn` on the named table. */
export function resolveCalculatedColumnSelector(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  selector: CalculatedColumnSelector,
): SelectorResolution<CalculatedColumn> {
  const tableResolution = resolveTableSelector(model, datasets, selector.table)
  if (!tableResolution.ok) return tableResolution

  const lower = selector.name.toLowerCase()
  const matches = model.calculatedColumns.filter(
    (c) => c.modelTableId === tableResolution.value.modelTable.id && c.name.toLowerCase() === lower,
  )

  if (matches.length === 0) {
    return fail(
      'calculated-column',
      'VALIDATION_TARGET_NOT_FOUND',
      `Calculated column "${selector.name}" does not exist yet on "${tableResolution.value.tableName}".`,
      { selector },
    )
  }
  if (matches.length > 1) {
    return fail(
      'calculated-column',
      'VALIDATION_TARGET_AMBIGUOUS',
      `More than one calculated column named "${selector.name}" exists on "${tableResolution.value.tableName}".`,
      { selector, matchCount: matches.length },
    )
  }
  return ok(matches[0])
}
