import type { QueryDiagnostic, QueryStep, QueryStepResult, QueryStepStatus } from '../../domain/query'
import { errorDiagnostic } from './queryDiagnostics'
import type { QueryFrame } from './queryFrame'
import { evaluateAppendQueries } from './steps/appendQueries'
import { evaluateChangeType } from './steps/changeType'
import { evaluateFill } from './steps/fill'
import { evaluateFilterRows } from './steps/filterRows'
import { evaluateGroupBy } from './steps/groupBy'
import { evaluateMergeColumns } from './steps/mergeColumns'
import { evaluateMergeQueries } from './steps/mergeQueries'
import { evaluateRemoveColumns } from './steps/removeColumns'
import { evaluateRemoveDuplicates } from './steps/removeDuplicates'
import { evaluateRenameColumns } from './steps/renameColumns'
import { evaluateReorderColumns } from './steps/reorderColumns'
import { evaluateReplaceValues } from './steps/replaceValues'
import { evaluateSortRows } from './steps/sortRows'
import { evaluateSplitColumn } from './steps/splitColumn'
import type { StepContext, StepEvalResult } from './stepContext'

function runStep(frame: QueryFrame, step: QueryStep, context: StepContext): StepEvalResult {
  switch (step.kind) {
    case 'rename-columns':
      return evaluateRenameColumns(frame, step)
    case 'remove-columns':
      return evaluateRemoveColumns(frame, step)
    case 'reorder-columns':
      return evaluateReorderColumns(frame, step)
    case 'change-type':
      return evaluateChangeType(frame, step)
    case 'filter-rows':
      return evaluateFilterRows(frame, step)
    case 'replace-values':
      return evaluateReplaceValues(frame, step)
    case 'remove-duplicates':
      return evaluateRemoveDuplicates(frame, step)
    case 'sort-rows':
      return evaluateSortRows(frame, step)
    case 'fill':
      return evaluateFill(frame, step)
    case 'split-column':
      return evaluateSplitColumn(frame, step)
    case 'merge-columns':
      return evaluateMergeColumns(frame, step)
    case 'group-by':
      return evaluateGroupBy(frame, step)
    case 'merge-queries':
      return evaluateMergeQueries(frame, step, context)
    case 'append-queries':
      return evaluateAppendQueries(frame, step, context)
  }
}

export interface QueryLimits {
  maxRowsPerTable: number
  maxColumns: number
}

function checkLimits(frame: QueryFrame, stepId: string, limits: QueryLimits): QueryDiagnostic | undefined {
  if (frame.rows.length > limits.maxRowsPerTable) {
    return errorDiagnostic('QUERY_ROW_LIMIT_EXCEEDED', `Output exceeds the ${limits.maxRowsPerTable.toLocaleString()}-row limit.`, { stepId })
  }
  if (frame.columns.length > limits.maxColumns) {
    return errorDiagnostic('QUERY_COLUMN_LIMIT_EXCEEDED', `Output exceeds the ${limits.maxColumns}-column limit.`, { stepId })
  }
  return undefined
}

export interface StepPipelineResult {
  /** `frames[0]` is the Source frame; `frames[i]` is the state after `steps[i - 1]`. Shorter than `steps.length + 1` once a step fails — later entries simply don't exist. */
  frames: QueryFrame[]
  stepResults: QueryStepResult[]
  diagnostics: QueryDiagnostic[]
  status: 'success' | 'error'
}

/**
 * Runs every step in order against `sourceFrame`, stopping at the first
 * failure (brief §16 "Step Failure Boundary") — the pipeline never executes
 * a step against invalid upstream state. Pure: never mutates `sourceFrame`
 * or any intermediate frame (brief §75).
 */
export function evaluateStepPipeline(sourceFrame: QueryFrame, steps: QueryStep[], context: StepContext, limits: QueryLimits): StepPipelineResult {
  const frames: QueryFrame[] = [sourceFrame]
  const stepResults: QueryStepResult[] = []
  const diagnostics: QueryDiagnostic[] = []
  let failed = false

  for (const step of steps) {
    if (failed) {
      stepResults.push({ stepId: step.id, status: 'skipped', inputRows: 0, outputRows: 0, outputColumns: 0, diagnostics: [] })
      continue
    }

    const inputFrame = frames[frames.length - 1]
    const result = runStep(inputFrame, step, context)
    const limitDiagnostic = result.frame ? checkLimits(result.frame, step.id, limits) : undefined
    const stepDiagnostics = limitDiagnostic ? [...result.diagnostics, limitDiagnostic] : result.diagnostics
    const hasError = stepDiagnostics.some((d) => d.severity === 'error')

    if (!result.frame || hasError) {
      failed = true
      diagnostics.push(...stepDiagnostics)
      stepResults.push({ stepId: step.id, status: 'error', inputRows: inputFrame.rows.length, outputRows: 0, outputColumns: 0, diagnostics: stepDiagnostics })
      continue
    }

    diagnostics.push(...stepDiagnostics)
    frames.push(result.frame)
    stepResults.push({
      stepId: step.id,
      status: 'success' satisfies QueryStepStatus,
      inputRows: inputFrame.rows.length,
      outputRows: result.frame.rows.length,
      outputColumns: result.frame.columns.length,
      diagnostics: stepDiagnostics,
    })
  }

  return { frames, stepResults, diagnostics, status: failed ? 'error' : 'success' }
}
