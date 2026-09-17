import type { DataType, Dataset } from '../../domain/data'
import type { CalculatedColumn, SemanticModel } from '../../domain/model'
import { bind, type BoundExpression } from '../../expression/binder'
import { diagnostic, hasError, type ExpressionDiagnostic } from '../../expression/diagnostics'
import {
  DEFAULT_PREVIEW_LIMIT,
  evaluateBoundExpressionOverTable,
  type RowEvaluationError,
  type RowTrace,
} from '../../expression/evaluator'
import { parseExpression } from '../../expression/parser'
import { generateId } from '../../lib/ids'
import { inferColumnType } from '../../lib/profiling/inferType'
import { resolveTableRef } from '../model/modelRuntime'

/**
 * The (unpersisted, recomputable) output of evaluating a `CalculatedColumn`
 * against its target table's current rows. The definition is what's saved
 * (`CalculatedColumn`, in `SemanticModel.calculatedColumns`); this is
 * regenerated on demand (docs/CALCULATED_COLUMNS.md "Persistence").
 */
export interface CalculatedColumnExecution {
  calculatedColumnId: string
  dataType: DataType | 'unknown'
  values: unknown[]
  errors: RowEvaluationError[]
  previewTraces: RowTrace[]
  /**
   * Non-empty when the column's expression can no longer bind at all right
   * now (e.g. its RELATED relationship was disabled since it was saved) —
   * `values`/`errors`/`previewTraces` are empty in that case rather than
   * throwing.
   */
  columnDiagnostics: ExpressionDiagnostic[]
}

export interface CalculatedColumnValidation {
  diagnostics: ExpressionDiagnostic[]
  bound?: BoundExpression
}

export interface CalculatedColumnInput {
  modelTableId: string
  name: string
  expression: string
}

function hasPhysicalColumnConflict(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  name: string,
): boolean {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  return resolved?.table.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()) ?? false
}

function hasCalculatedColumnConflict(model: SemanticModel, modelTableId: string, name: string, excludeId?: string): boolean {
  return model.calculatedColumns.some(
    (c) => c.modelTableId === modelTableId && c.id !== excludeId && c.name.toLowerCase() === name.toLowerCase(),
  )
}

/**
 * Parses, binds and name-checks a calculated-column candidate without
 * mutating the model. Shared by create/update and by the UI for live
 * diagnostics while the learner is still editing (invalid drafts never
 * reach `SemanticModel` — see docs/CALCULATED_COLUMNS.md).
 */
export function validateCalculatedColumn(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  input: CalculatedColumnInput & { excludeCalculatedColumnId?: string },
): CalculatedColumnValidation {
  const diagnostics: ExpressionDiagnostic[] = []
  const trimmedName = input.name.trim()

  if (trimmedName === '') {
    diagnostics.push(diagnostic('error', 'SYNTAX_ERROR', 'The calculated column needs a name.'))
  } else {
    if (hasPhysicalColumnConflict(model, datasets, input.modelTableId, trimmedName)) {
      diagnostics.push(
        diagnostic('error', 'COLUMN_NAME_CONFLICT', `"${trimmedName}" already exists as a physical column on this table.`),
      )
    }
    if (hasCalculatedColumnConflict(model, input.modelTableId, trimmedName, input.excludeCalculatedColumnId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'DUPLICATE_CALCULATED_COLUMN',
          `"${trimmedName}" is already used by another calculated column on this table.`,
        ),
      )
    }
  }

  const parsed = parseExpression(input.expression)
  diagnostics.push(...parsed.diagnostics)
  if (!parsed.expression) {
    return { diagnostics }
  }

  const bound = bind(parsed.expression, { model, datasets, currentModelTableId: input.modelTableId })
  diagnostics.push(...bound.diagnostics)

  return { diagnostics, bound: bound.bound }
}

function evaluate(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  calculatedColumnId: string,
  modelTableId: string,
  bound: BoundExpression,
): CalculatedColumnExecution {
  const { values, errors, previewTraces } = evaluateBoundExpressionOverTable(
    bound,
    model,
    datasets,
    modelTableId,
    DEFAULT_PREVIEW_LIMIT,
  )
  const dataType = inferColumnType(values)
  return { calculatedColumnId, dataType, values, errors, previewTraces, columnDiagnostics: [] }
}

export interface CalculatedColumnMutationResult {
  model: SemanticModel
  calculatedColumn?: CalculatedColumn
  execution?: CalculatedColumnExecution
  diagnostics: ExpressionDiagnostic[]
}

/**
 * parse -> bind -> validate semantic references -> evaluate -> infer type
 * -> store definition if valid. A syntax- or binding-invalid expression
 * never becomes canonical model state: the model comes back unchanged,
 * with diagnostics, when any diagnostic is an error.
 */
export function createCalculatedColumn(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  input: CalculatedColumnInput,
): CalculatedColumnMutationResult {
  const validation = validateCalculatedColumn(model, datasets, input)
  if (hasError(validation.diagnostics) || !validation.bound) {
    return { model, diagnostics: validation.diagnostics }
  }

  const now = new Date().toISOString()
  const id = generateId('calc-column')
  const execution = evaluate(model, datasets, id, input.modelTableId, validation.bound)

  const calculatedColumn: CalculatedColumn = {
    id,
    modelTableId: input.modelTableId,
    name: input.name.trim(),
    expression: input.expression,
    dataType: execution.dataType,
    createdAt: now,
    updatedAt: now,
  }

  return {
    model: { ...model, calculatedColumns: [...model.calculatedColumns, calculatedColumn], updatedAt: now },
    calculatedColumn,
    execution,
    diagnostics: validation.diagnostics,
  }
}

export function updateCalculatedColumn(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  calculatedColumnId: string,
  patch: { name?: string; expression?: string },
): CalculatedColumnMutationResult {
  const existing = model.calculatedColumns.find((c) => c.id === calculatedColumnId)
  if (!existing) return { model, diagnostics: [] }

  const input: CalculatedColumnInput = {
    modelTableId: existing.modelTableId,
    name: patch.name ?? existing.name,
    expression: patch.expression ?? existing.expression,
  }

  const validation = validateCalculatedColumn(model, datasets, { ...input, excludeCalculatedColumnId: calculatedColumnId })
  if (hasError(validation.diagnostics) || !validation.bound) {
    return { model, diagnostics: validation.diagnostics }
  }

  const now = new Date().toISOString()
  const execution = evaluate(model, datasets, calculatedColumnId, input.modelTableId, validation.bound)

  const updated: CalculatedColumn = {
    ...existing,
    name: input.name.trim(),
    expression: input.expression,
    dataType: execution.dataType,
    updatedAt: now,
  }

  return {
    model: {
      ...model,
      calculatedColumns: model.calculatedColumns.map((c) => (c.id === calculatedColumnId ? updated : c)),
      updatedAt: now,
    },
    calculatedColumn: updated,
    execution,
    diagnostics: validation.diagnostics,
  }
}

/** Removes a calculated column's definition. The caller is responsible for also removing any cell that references it. */
export function removeCalculatedColumn(model: SemanticModel, calculatedColumnId: string): SemanticModel {
  return {
    ...model,
    calculatedColumns: model.calculatedColumns.filter((c) => c.id !== calculatedColumnId),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Recomputes a persisted calculated column's output from its stored
 * expression — used to re-run after reload/import, or whenever the model
 * changes underneath it (e.g. a relationship a RELATED column depends on
 * gets disabled). The definition may no longer bind even though it did when
 * it was saved; that surfaces as `columnDiagnostics` instead of throwing.
 */
export function evaluateCalculatedColumn(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  calculatedColumnId: string,
): CalculatedColumnExecution | undefined {
  const definition = model.calculatedColumns.find((c) => c.id === calculatedColumnId)
  if (!definition) return undefined

  const parsed = parseExpression(definition.expression)
  if (!parsed.expression) {
    return { calculatedColumnId, dataType: 'unknown', values: [], errors: [], previewTraces: [], columnDiagnostics: parsed.diagnostics }
  }

  const bound = bind(parsed.expression, { model, datasets, currentModelTableId: definition.modelTableId })
  if (!bound.bound) {
    return { calculatedColumnId, dataType: 'unknown', values: [], errors: [], previewTraces: [], columnDiagnostics: bound.diagnostics }
  }

  return evaluate(model, datasets, calculatedColumnId, definition.modelTableId, bound.bound)
}
