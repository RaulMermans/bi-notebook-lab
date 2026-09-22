import type { DataColumn, DataType } from '../../../domain/data'
import type { PivotColumnStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'
import { canonicalPivotKey, pivotDisplayName, pivotOutputColumnId } from './pivotIdentity'

const NUMERIC_TYPES = new Set<DataType>(['integer', 'decimal'])
const TEMPORAL_TYPES = new Set<DataType>(['date', 'datetime'])

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function groupKeyFor(row: Record<string, unknown>, columnNames: string[]): string {
  return JSON.stringify(columnNames.map((name) => row[name] ?? null))
}

function aggregate(step: PivotColumnStep, values: unknown[], sourceType: DataType): unknown {
  if (step.aggregation === 'count') return values.length
  if (step.aggregation === 'first') return values[0] ?? null

  const numbers = values.map(numeric).filter((v): v is number => v !== undefined)
  if (numbers.length === 0) return null
  if (step.aggregation === 'sum') return numbers.reduce((a, b) => a + b, 0)
  if (step.aggregation === 'min') return sourceType === 'date' || sourceType === 'datetime' ? [...values].sort()[0] : Math.min(...numbers)
  return sourceType === 'date' || sourceType === 'datetime' ? [...values].sort()[values.length - 1] : Math.max(...numbers)
}

/**
 * Single grouping pass + one output-materialization pass (brief §40
 * "single grouping/index pass"). Generated pivot-column ids are derived,
 * never stored — see `pivotIdentity.ts` and docs/POWER_QUERY_RUNTIME.md
 * "Pivot column identity". Non-pivot/non-value columns become the grouping
 * columns, exactly like Group By.
 */
export function evaluatePivotColumn(frame: QueryFrame, step: PivotColumnStep): StepEvalResult {
  const pivotColumn = frame.columns.find((c) => c.id === step.pivotColumnId)
  if (!pivotColumn) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'The pivot column no longer exists.', { stepId: step.id, details: { columnId: step.pivotColumnId } })] }
  }
  const valueColumn = frame.columns.find((c) => c.id === step.valueColumnId)
  if (!valueColumn) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'The value column no longer exists.', { stepId: step.id, details: { columnId: step.valueColumnId } })] }
  }
  if (pivotColumn.id === valueColumn.id) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'The pivot column and value column must be different.', { stepId: step.id })] }
  }

  if (step.aggregation === 'sum' && !NUMERIC_TYPES.has(valueColumn.dataType)) {
    return {
      diagnostics: [
        errorDiagnostic('QUERY_PIVOT_AGGREGATION_INVALID', `SUM requires a numeric value column; "${valueColumn.name}" is ${valueColumn.dataType}.`, { stepId: step.id }),
      ],
    }
  }
  if ((step.aggregation === 'min' || step.aggregation === 'max') && !NUMERIC_TYPES.has(valueColumn.dataType) && !TEMPORAL_TYPES.has(valueColumn.dataType)) {
    return {
      diagnostics: [
        errorDiagnostic(
          'QUERY_PIVOT_AGGREGATION_INVALID',
          `${step.aggregation.toUpperCase()} requires a numeric or date value column; "${valueColumn.name}" is ${valueColumn.dataType}.`,
          { stepId: step.id },
        ),
      ],
    }
  }

  const groupColumns = frame.columns.filter((c) => c.id !== pivotColumn.id && c.id !== valueColumn.id)
  const groupNames = groupColumns.map((c) => c.name)

  // First pass: group rows and collect (canonical pivot key -> raw values) per group.
  const groups = new Map<string, { keyValues: Record<string, unknown>; buckets: Map<string, unknown[]> }>()
  const canonicalToRawSample = new Map<string, unknown>()

  for (const row of frame.rows) {
    const groupKey = groupKeyFor(row, groupNames)
    let group = groups.get(groupKey)
    if (!group) {
      const keyValues: Record<string, unknown> = {}
      for (const name of groupNames) keyValues[name] = row[name] ?? null
      group = { keyValues, buckets: new Map() }
      groups.set(groupKey, group)
    }

    const pivotValue = row[pivotColumn.name]
    const canonicalKey = canonicalPivotKey(pivotValue)
    if (!canonicalToRawSample.has(canonicalKey)) canonicalToRawSample.set(canonicalKey, pivotValue)

    const bucket = group.buckets.get(canonicalKey)
    const value = row[valueColumn.name]
    if (bucket) bucket.push(value)
    else group.buckets.set(canonicalKey, [value])
  }

  // Determine the full, deterministic (row-order-independent) set of output pivot columns.
  const canonicalKeys = [...canonicalToRawSample.keys()].sort()
  const displayNameByCanonicalKey = new Map(canonicalKeys.map((key) => [key, pivotDisplayName(canonicalToRawSample.get(key))]))

  const usedDisplayNames = new Map<string, string>()
  for (const key of canonicalKeys) {
    const displayName = displayNameByCanonicalKey.get(key)!
    const collidesWithGroup = groupNames.some((n) => n.toLowerCase() === displayName.toLowerCase())
    const collidesWithAnotherPivotValue = usedDisplayNames.has(displayName.toLowerCase()) && usedDisplayNames.get(displayName.toLowerCase()) !== key
    if (collidesWithGroup || collidesWithAnotherPivotValue) {
      return {
        diagnostics: [
          errorDiagnostic('QUERY_PIVOT_SCHEMA_COLLISION', `Pivoting "${pivotColumn.name}" would produce more than one column named "${displayName}".`, {
            stepId: step.id,
            details: { displayName },
          }),
        ],
      }
    }
    usedDisplayNames.set(displayName.toLowerCase(), key)
  }

  const pivotOutputColumns: DataColumn[] = canonicalKeys.map((key) => ({
    id: pivotOutputColumnId(step.id, key),
    name: displayNameByCanonicalKey.get(key)!,
    dataType: step.aggregation === 'count' ? 'integer' : valueColumn.dataType,
    nullable: true,
  }))

  const rows = [...groups.values()].map((group) => {
    const row: Record<string, unknown> = { ...group.keyValues }
    for (let i = 0; i < canonicalKeys.length; i += 1) {
      const key = canonicalKeys[i]
      const bucket = group.buckets.get(key)
      row[pivotOutputColumns[i].name] = bucket ? aggregate(step, bucket, valueColumn.dataType) : null
    }
    return row
  })

  return { frame: { columns: [...groupColumns, ...pivotOutputColumns], rows }, diagnostics: [] }
}
