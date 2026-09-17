import type { Dataset } from '../../domain/data'
import type { Measure, SemanticModel } from '../../domain/model'
import { diagnostic, hasError, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { bindMeasureExpression } from '../../expression/measureBinder'
import { parseExpression } from '../../expression/parser'
import { generateId } from '../../lib/ids'
import { resolveTableRef } from '../model/modelRuntime'
import { detectMeasureDependencyCycle } from './dependencyGraph'
import { evaluateMeasure as evaluateMeasureExecution, type MeasureExecution } from './measureEvaluator'

export { evaluateMeasure } from './measureEvaluator'
export type { MeasureExecution } from './measureEvaluator'

export interface MeasureInput {
  homeModelTableId: string
  name: string
  expression: string
}

export interface MeasureValidation {
  diagnostics: ExpressionDiagnostic[]
}

function hasColumnConflict(model: SemanticModel, datasets: Record<string, Dataset>, homeModelTableId: string, name: string): boolean {
  const modelTable = model.tables.find((t) => t.id === homeModelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const lower = name.toLowerCase()
  const physical = resolved?.table.columns.some((c) => c.name.toLowerCase() === lower) ?? false
  const calculated = model.calculatedColumns.some((c) => c.modelTableId === homeModelTableId && c.name.toLowerCase() === lower)
  return physical || calculated
}

function hasMeasureConflict(model: SemanticModel, name: string, excludeId?: string): boolean {
  const lower = name.toLowerCase()
  return model.measures.some((m) => m.id !== excludeId && m.name.toLowerCase() === lower)
}

/**
 * Returns a model with `candidate` inserted (or replacing an existing
 * measure of the same id). Used only for validation: binding and dependency
 * checks must see the proposed definition so a self-reference resolves (as a
 * `BoundMeasureReference`) instead of failing as `UNKNOWN_MEASURE`, letting
 * the dependency graph catch it as an explicit cycle instead
 * (docs/MEASURES.md "Dependency cycles").
 */
function withCandidateMeasure(model: SemanticModel, candidate: Measure): SemanticModel {
  const exists = model.measures.some((m) => m.id === candidate.id)
  const measures = exists ? model.measures.map((m) => (m.id === candidate.id ? candidate : m)) : [...model.measures, candidate]
  return { ...model, measures }
}

/**
 * Parses, binds, name-checks and dependency-checks a measure candidate
 * without mutating the model — the measure counterpart of
 * `validateCalculatedColumn`. Shared by create/update and by the UI for live
 * diagnostics; an invalid draft never reaches `SemanticModel.measures`.
 */
export function validateMeasure(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  input: MeasureInput & { excludeMeasureId?: string },
): MeasureValidation {
  const diagnostics: ExpressionDiagnostic[] = []
  const trimmedName = input.name.trim()

  if (trimmedName === '') {
    diagnostics.push(diagnostic('error', 'SYNTAX_ERROR', 'The measure needs a name.'))
  } else {
    if (hasMeasureConflict(model, trimmedName, input.excludeMeasureId)) {
      diagnostics.push(diagnostic('error', 'DUPLICATE_MEASURE', `"${trimmedName}" is already used by another measure in this model.`))
    }
    if (hasColumnConflict(model, datasets, input.homeModelTableId, trimmedName)) {
      diagnostics.push(
        diagnostic(
          'error',
          'DUPLICATE_MEASURE',
          `"${trimmedName}" already exists as a column on this table. Measure and column names must stay unambiguous.`,
        ),
      )
    }
  }

  const parsed = parseExpression(input.expression)
  diagnostics.push(...parsed.diagnostics)
  if (!parsed.expression) return { diagnostics }

  const candidateId = input.excludeMeasureId ?? generateId('measure')
  const now = new Date().toISOString()
  const candidate: Measure = {
    id: candidateId,
    homeModelTableId: input.homeModelTableId,
    name: trimmedName,
    expression: input.expression,
    dataType: 'unknown',
    createdAt: now,
    updatedAt: now,
  }
  const candidateModel = withCandidateMeasure(model, candidate)

  const bound = bindMeasureExpression(parsed.expression, { model: candidateModel, datasets })
  diagnostics.push(...bound.diagnostics)
  if (!bound.bound) return { diagnostics }

  const cycle = detectMeasureDependencyCycle(candidateModel)
  if (cycle.found && cycle.path.includes(candidateId)) {
    const names = cycle.path.map((id) => candidateModel.measures.find((m) => m.id === id)?.name ?? id)
    diagnostics.push(
      diagnostic('error', 'MEASURE_DEPENDENCY_CYCLE', `Measure dependency cycle: ${names.join(' → ')}.`, undefined, { path: names }),
    )
  }

  return { diagnostics }
}

export interface MeasureMutationResult {
  model: SemanticModel
  measure?: Measure
  execution?: MeasureExecution
  diagnostics: ExpressionDiagnostic[]
}

/**
 * validate -> store definition -> evaluate (unfiltered) -> infer type. A
 * syntax/binding/cycle-invalid expression never becomes canonical model
 * state — the model comes back unchanged when any diagnostic is an error.
 */
export function createMeasure(model: SemanticModel, datasets: Record<string, Dataset>, input: MeasureInput): MeasureMutationResult {
  const validation = validateMeasure(model, datasets, input)
  if (hasError(validation.diagnostics)) {
    return { model, diagnostics: validation.diagnostics }
  }

  const now = new Date().toISOString()
  const id = generateId('measure')
  const measure: Measure = {
    id,
    homeModelTableId: input.homeModelTableId,
    name: input.name.trim(),
    expression: input.expression,
    dataType: 'unknown',
    createdAt: now,
    updatedAt: now,
  }

  const modelWithMeasure: SemanticModel = { ...model, measures: [...model.measures, measure], updatedAt: now }
  const execution = evaluateMeasureExecution(modelWithMeasure, datasets, id)
  const finalMeasure: Measure = { ...measure, dataType: execution.dataType }
  const finalModel: SemanticModel = {
    ...modelWithMeasure,
    measures: modelWithMeasure.measures.map((m) => (m.id === id ? finalMeasure : m)),
  }

  return { model: finalModel, measure: finalMeasure, execution, diagnostics: validation.diagnostics }
}

export function updateMeasure(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  measureId: string,
  patch: { name?: string; expression?: string; homeModelTableId?: string },
): MeasureMutationResult {
  const existing = model.measures.find((m) => m.id === measureId)
  if (!existing) return { model, diagnostics: [] }

  const input: MeasureInput = {
    homeModelTableId: patch.homeModelTableId ?? existing.homeModelTableId,
    name: patch.name ?? existing.name,
    expression: patch.expression ?? existing.expression,
  }

  const validation = validateMeasure(model, datasets, { ...input, excludeMeasureId: measureId })
  if (hasError(validation.diagnostics)) {
    return { model, diagnostics: validation.diagnostics }
  }

  const now = new Date().toISOString()
  const updated: Measure = { ...existing, ...input, name: input.name.trim(), updatedAt: now }
  const modelWithMeasure: SemanticModel = {
    ...model,
    measures: model.measures.map((m) => (m.id === measureId ? updated : m)),
    updatedAt: now,
  }
  const execution = evaluateMeasureExecution(modelWithMeasure, datasets, measureId)
  const finalMeasure: Measure = { ...updated, dataType: execution.dataType }
  const finalModel: SemanticModel = {
    ...modelWithMeasure,
    measures: modelWithMeasure.measures.map((m) => (m.id === measureId ? finalMeasure : m)),
  }

  return { model: finalModel, measure: finalMeasure, execution, diagnostics: validation.diagnostics }
}

/** Removes a measure's definition. The caller is responsible for also removing any cell that references it. */
export function removeMeasure(model: SemanticModel, measureId: string): SemanticModel {
  return { ...model, measures: model.measures.filter((m) => m.id !== measureId), updatedAt: new Date().toISOString() }
}
