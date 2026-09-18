import type { Dataset } from '../../domain/data'
import type { ContextAnalysis } from '../../domain/context'
import type { SemanticModel } from '../../domain/model'
import { EMPTY_FILTER_CONTEXT, type ColumnFilter, type FilterContext } from '../measure/filterContext'
import { evaluateMeasure } from '../measure/measureRuntime'
import { compareMeasureResults } from './comparison'
import { buildRelationshipStates, buildTableStates } from './graphAdapter'
import { buildBeginnerExplanation, buildContextNarrative } from './narrative'

export interface AnalyzeMeasureContextInput {
  model: SemanticModel
  datasets: Record<string, Dataset>
  measureId: string
  filterContext: FilterContext
}

/**
 * The single entry point for the Context Explorer (Sprint 6). Composes
 * exactly two real Sprint 4 `evaluateMeasure` calls — one unfiltered
 * ("baseline"), one under the learner's current `FilterContext` — plus the
 * presentation adapters in `graphAdapter.ts`/`narrative.ts`/`comparison.ts`.
 * This function performs no filtering, propagation or aggregation itself;
 * see docs/CONTEXT_VISUALIZER.md "Runtime-truth reuse" for why that
 * boundary matters (Sprint 6 brief §30/§37).
 */
export function analyzeMeasureContext({ model, datasets, measureId, filterContext }: AnalyzeMeasureContextInput): ContextAnalysis {
  const measure = model.measures.find((m) => m.id === measureId)
  const measureName = measure?.name ?? 'Unknown measure'
  const measureExpression = measure?.expression ?? ''
  const filters: ColumnFilter[] = filterContext.filters

  const baseline = evaluateMeasure(model, datasets, measureId, EMPTY_FILTER_CONTEXT)
  const current = filters.length === 0 ? baseline : evaluateMeasure(model, datasets, measureId, filterContext)

  const comparison = compareMeasureResults(baseline.value, current.value)

  const base: ContextAnalysis = {
    measureId,
    measureName,
    measureExpression,
    filters,
    baseline: { measureId, value: baseline.value, dataType: baseline.dataType, trace: baseline.trace },
    current: { measureId, value: current.value, dataType: current.dataType, trace: current.trace },
    comparison,
    narrative: [],
    beginnerExplanation: '',
  }

  if (!current.filterState || !current.filterState.valid) {
    const invalidDiagnostic = current.filterState?.diagnostics[0]
    return {
      ...base,
      invalid: {
        code: invalidDiagnostic?.code ?? 'FILTER_GRAPH_INVALID',
        message:
          invalidDiagnostic?.message ??
          "This model's relationship graph is invalid, so filter propagation can't be resolved deterministically. Fix the model diagnostics first.",
      },
    }
  }

  const state = current.filterState
  const tables = buildTableStates(model, state)
  const relationships = buildRelationshipStates(model, datasets, state)
  const narrative = buildContextNarrative(measureName, current.value, state, current.trace)
  const beginnerExplanation = buildBeginnerExplanation(measureName, current.value, state)

  return { ...base, tables, relationships, narrative, beginnerExplanation }
}
