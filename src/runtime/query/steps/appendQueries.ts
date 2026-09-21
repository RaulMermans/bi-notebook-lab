import type { DataColumn, DataType } from '../../../domain/data'
import type { AppendQueriesStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { ResolvedSource, StepContext, StepEvalResult } from '../stepContext'

type TypeCategory = 'numeric' | 'string' | 'boolean' | 'temporal' | 'other'

function categorize(dataType: DataType): TypeCategory {
  if (dataType === 'integer' || dataType === 'decimal') return 'numeric'
  if (dataType === 'boolean') return 'boolean'
  if (dataType === 'date' || dataType === 'datetime') return 'temporal'
  if (dataType === 'string') return 'string'
  return 'other'
}

/** Deterministic fallback id for a column name the step wasn't created with (brief §76: "no random column IDs during evaluation"). */
function fallbackColumnId(stepId: string, name: string): string {
  return `${stepId}::append::${name}`
}

/**
 * Type lattice for Append (brief §40): identical types pass through; a
 * numeric mix promotes to `decimal`; anything else that isn't identical is a
 * structured failure rather than a silent coercion.
 */
function unifyType(a: DataType, b: DataType): DataType | undefined {
  if (a === b) return a
  if (categorize(a) === 'numeric' && categorize(b) === 'numeric') return 'decimal'
  return undefined
}

export function evaluateAppendQueries(frame: QueryFrame, step: AppendQueriesStep, context: StepContext): StepEvalResult {
  if (step.sources.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'Append needs at least one other query.', { stepId: step.id })] }
  }

  const resolvedSources: ResolvedSource[] = [{ columns: frame.columns, rows: frame.rows }]
  for (const source of step.sources) {
    const resolution = context.resolveSource(source)
    if (!resolution.ok) return { diagnostics: [{ ...resolution.diagnostic, stepId: step.id }] }
    resolvedSources.push(resolution.value)
  }

  const nameToId = new Map(step.columns.map((c) => [c.name, c.outputColumnId]))
  const orderedNames: string[] = [...step.columns.map((c) => c.name)]
  for (const source of resolvedSources) {
    for (const column of source.columns) {
      if (!nameToId.has(column.name)) {
        nameToId.set(column.name, fallbackColumnId(step.id, column.name))
        orderedNames.push(column.name)
      }
    }
  }

  const outputColumns: DataColumn[] = []
  for (const name of orderedNames) {
    let dataType: DataType | undefined
    let nullable = false
    for (const source of resolvedSources) {
      const column = source.columns.find((c) => c.name === name)
      if (!column) {
        nullable = true
        continue
      }
      if (dataType === undefined) {
        dataType = column.dataType
      } else {
        const unified = unifyType(dataType, column.dataType)
        if (unified === undefined) {
          return {
            diagnostics: [
              errorDiagnostic(
                'QUERY_INVALID_STEP_CONFIG',
                `Column "${name}" has incompatible types across appended queries (${dataType} vs ${column.dataType}).`,
                { stepId: step.id, details: { column: name } },
              ),
            ],
          }
        }
        dataType = unified
      }
      nullable = nullable || column.nullable
    }
    outputColumns.push({ id: nameToId.get(name)!, name, dataType: dataType ?? 'unknown', nullable })
  }

  if (outputColumns.length > context.maxColumns) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_LIMIT_EXCEEDED', `Append output exceeds the ${context.maxColumns}-column limit.`, { stepId: step.id })] }
  }

  const rows: Record<string, unknown>[] = []
  for (const source of resolvedSources) {
    for (const row of source.rows) {
      const next: Record<string, unknown> = {}
      for (const name of orderedNames) next[name] = name in row ? row[name] : null
      rows.push(next)
      if (rows.length > context.maxRows) {
        return { diagnostics: [errorDiagnostic('QUERY_ROW_LIMIT_EXCEEDED', `Append output exceeds the ${context.maxRows.toLocaleString()}-row limit.`, { stepId: step.id })] }
      }
    }
  }

  return { frame: { columns: outputColumns, rows }, diagnostics: [] }
}
