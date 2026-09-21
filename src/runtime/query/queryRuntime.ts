import { DATA_LIMITS, type DataColumn, type DataTable, type Dataset } from '../../domain/data'
import type { QueryDefinition, QueryDiagnostic, QueryEvaluation, QuerySource, QueryStep } from '../../domain/query'
import { generateId } from '../../lib/ids'
import { errorDiagnostic } from './queryDiagnostics'
import { evaluateStepPipeline, type QueryLimits } from './queryEvaluator'
import { computeQueryFingerprint } from './queryFingerprint'
import type { QueryFrame } from './queryFrame'
import { buildQueryGraph, queryDependencyIds } from './queryGraph'
import { buildStep, type NewStepInput } from './queryStepFactory'
import type { ResolveSourceResult, StepContext } from './stepContext'

export interface QueryEvaluationDetail extends QueryEvaluation {
  /** `frames[0]` is the Source frame; `frames[i]` is the state after `query.steps[i - 1]`. Powers "select an Applied Step" (brief §13) without re-running transformation logic in React. */
  frames: QueryFrame[]
}

function resolveQuerySource(
  source: QuerySource,
  datasets: Record<string, Dataset>,
  results: Record<string, QueryEvaluationDetail>,
): ResolveSourceResult {
  if (source.kind === 'dataset-table') {
    const dataset = datasets[source.datasetId]
    const table = dataset?.tables.find((t) => t.id === source.tableId)
    if (!dataset || !table) {
      return {
        ok: false,
        diagnostic: errorDiagnostic('QUERY_SOURCE_NOT_FOUND', 'The source table could not be found.', {
          details: { datasetId: source.datasetId, tableId: source.tableId },
        }),
      }
    }
    return { ok: true, value: { columns: table.columns, rows: table.rows } }
  }

  const dependency = results[source.queryId]
  if (!dependency || !dependency.output) {
    return {
      ok: false,
      diagnostic: errorDiagnostic('QUERY_DEPENDENCY_NOT_FOUND', 'The referenced query has no available output yet.', {
        details: { queryId: source.queryId },
      }),
    }
  }
  const table = dependency.output.tables[0]
  return { ok: true, value: { columns: table.columns, rows: table.rows } }
}

/** Reads a source's current output schema — used by the UI/notebook actions to populate Merge/Append pickers before a step is even added. */
export function resolveSourceColumns(
  source: QuerySource,
  datasets: Record<string, Dataset>,
  queryResults: Record<string, QueryEvaluationDetail>,
): DataColumn[] | undefined {
  const resolution = resolveQuerySource(source, datasets, queryResults)
  return resolution.ok ? resolution.value.columns : undefined
}

interface EvaluateQueryContext {
  datasets: Record<string, Dataset>
  results: Record<string, QueryEvaluationDetail>
  limits: QueryLimits
}

function skippedResult(query: QueryDefinition): QueryEvaluation['stepResults'] {
  return query.steps.map((step) => ({ stepId: step.id, status: 'skipped' as const, inputRows: 0, outputRows: 0, outputColumns: 0, diagnostics: [] }))
}

function evaluateQuery(query: QueryDefinition, ctx: EvaluateQueryContext): QueryEvaluationDetail {
  const dependencyFingerprints: Record<string, string> = {}
  for (const depId of queryDependencyIds(query)) {
    const dep = ctx.results[depId]
    if (dep) dependencyFingerprints[depId] = dep.fingerprint
  }
  const fingerprint = computeQueryFingerprint(query, dependencyFingerprints)

  const sourceResolution = resolveQuerySource(query.source, ctx.datasets, ctx.results)
  if (!sourceResolution.ok) {
    return {
      queryId: query.id,
      status: 'error',
      output: undefined,
      stepResults: skippedResult(query),
      diagnostics: [sourceResolution.diagnostic],
      fingerprint,
      frames: [],
    }
  }

  const sourceFrame: QueryFrame = { columns: sourceResolution.value.columns, rows: sourceResolution.value.rows }
  const stepContext: StepContext = {
    resolveSource: (source) => resolveQuerySource(source, ctx.datasets, ctx.results),
    maxRows: ctx.limits.maxRowsPerTable,
    maxColumns: ctx.limits.maxColumns,
  }

  const pipeline = evaluateStepPipeline(sourceFrame, query.steps, stepContext, ctx.limits)
  const finalFrame = pipeline.frames[pipeline.frames.length - 1]

  const table: DataTable = {
    id: query.outputTableId,
    name: query.name,
    columns: finalFrame.columns,
    rows: finalFrame.rows,
    rowCount: finalFrame.rows.length,
  }
  const output: Dataset = {
    id: query.outputDatasetId,
    name: query.name,
    source: { type: 'query', queryId: query.id, revision: fingerprint },
    tables: [table],
    createdAt: query.createdAt,
  }

  return { queryId: query.id, status: pipeline.status, output, stepResults: pipeline.stepResults, diagnostics: pipeline.diagnostics, fingerprint, frames: pipeline.frames }
}

function blockedResult(query: QueryDefinition, diagnostic: QueryDiagnostic): QueryEvaluationDetail {
  return {
    queryId: query.id,
    status: 'error',
    output: undefined,
    stepResults: skippedResult(query),
    diagnostics: [diagnostic],
    fingerprint: computeQueryFingerprint(query, {}),
    frames: [],
  }
}

/**
 * Evaluates every query in dependency order (brief §52 hydration order:
 * queries evaluate before Semantic Models exist). A query in a dependency
 * cycle, or depending — directly or indirectly — on a missing/cyclic query,
 * never runs (docs/POWER_QUERY_RUNTIME.md "Dependency graph: fail closed").
 */
export function evaluateAllQueries(
  queries: Record<string, QueryDefinition>,
  datasets: Record<string, Dataset>,
  limits: QueryLimits = DATA_LIMITS,
): Record<string, QueryEvaluationDetail> {
  const graph = buildQueryGraph(queries)
  const results: Record<string, QueryEvaluationDetail> = {}

  for (const id of graph.order) {
    results[id] = evaluateQuery(queries[id], { datasets, results, limits })
  }

  for (const id of graph.blocked) {
    const query = queries[id]
    if (!query) continue

    const cycle = graph.cycles.find((c) => c.includes(id))
    if (cycle) {
      const path = cycle.map((cid) => queries[cid]?.name ?? cid).join(' → ')
      results[id] = blockedResult(query, errorDiagnostic('QUERY_DEPENDENCY_CYCLE', `Query dependency cycle: ${path}.`, { details: { cycle } }))
      continue
    }

    const missingEntry = graph.missing.find((m) => m.queryId === id)
    if (missingEntry) {
      results[id] = blockedResult(
        query,
        errorDiagnostic('QUERY_DEPENDENCY_NOT_FOUND', 'This query references a query that no longer exists.', {
          details: { missingDependencyId: missingEntry.missingDependencyId },
        }),
      )
      continue
    }

    results[id] = blockedResult(query, errorDiagnostic('QUERY_DEPENDENCY_NOT_FOUND', 'An upstream query could not be evaluated.', {}))
  }

  return results
}

/** `stepIndex` 0 = Source (before any step); `i` = the state after `query.steps[i - 1]` (brief §13). Undefined once a step failed/was skipped. */
export function frameAtStep(detail: QueryEvaluationDetail, stepIndex: number): QueryFrame | undefined {
  return detail.frames[stepIndex]
}

// ---------------------------------------------------------------------------
// Pure QueryDefinition mutations — every one returns a new object; none of
// them evaluate anything (evaluateAllQueries is always a separate pass).
// ---------------------------------------------------------------------------

export function createQueryDefinition(name: string, source: QuerySource): QueryDefinition {
  const now = new Date().toISOString()
  return {
    id: generateId('query'),
    name,
    source,
    steps: [],
    outputDatasetId: generateId('dataset'),
    outputTableId: generateId('table'),
    loadEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function renameQuery(query: QueryDefinition, name: string): QueryDefinition {
  return { ...query, name, updatedAt: new Date().toISOString() }
}

export function setQueryLoadEnabled(query: QueryDefinition, loadEnabled: boolean): QueryDefinition {
  return { ...query, loadEnabled, updatedAt: new Date().toISOString() }
}

export function addQueryStep(query: QueryDefinition, input: NewStepInput, name?: string): QueryDefinition {
  const step = buildStep(input, name)
  return { ...query, steps: [...query.steps, step], updatedAt: new Date().toISOString() }
}

/** Shallow-merges `patch` onto the existing step, always keeping the same `id`/`kind` — editing a step never requires delete/re-add (brief §60). */
export function updateQueryStep(query: QueryDefinition, stepId: string, patch: Record<string, unknown>): QueryDefinition {
  const steps = query.steps.map((step) => (step.id === stepId ? ({ ...step, ...patch, id: step.id, kind: step.kind } as QueryStep) : step))
  return { ...query, steps, updatedAt: new Date().toISOString() }
}

export function renameQueryStep(query: QueryDefinition, stepId: string, name: string): QueryDefinition {
  return { ...query, steps: query.steps.map((step) => (step.id === stepId ? { ...step, name } : step)), updatedAt: new Date().toISOString() }
}

/** The natural "undo" for Power Query: delete the step and every downstream step re-runs against the state before it (brief §71). */
export function removeQueryStep(query: QueryDefinition, stepId: string): QueryDefinition {
  return { ...query, steps: query.steps.filter((step) => step.id !== stepId), updatedAt: new Date().toISOString() }
}

export function moveQueryStep(query: QueryDefinition, stepId: string, toIndex: number): QueryDefinition {
  const steps = [...query.steps]
  const fromIndex = steps.findIndex((step) => step.id === stepId)
  if (fromIndex === -1) return query
  const [step] = steps.splice(fromIndex, 1)
  const clampedIndex = Math.max(0, Math.min(toIndex, steps.length))
  steps.splice(clampedIndex, 0, step)
  return { ...query, steps, updatedAt: new Date().toISOString() }
}

/** Queries that reference `queryId` — via source, Merge, or Append (used to block/warn on delete, brief §82). */
export function findDependentQueryIds(queries: Record<string, QueryDefinition>, queryId: string): string[] {
  return Object.values(queries)
    .filter((query) => queryDependencyIds(query).includes(queryId))
    .map((query) => query.id)
}
