import type { DataColumn, DataType } from '../../../domain/data'
import type { GroupByAggregation, GroupByStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

const NUMERIC_TYPES = new Set<DataType>(['integer', 'decimal'])
const TEMPORAL_TYPES = new Set<DataType>(['date', 'datetime'])

function keyFor(row: Record<string, unknown>, columnNames: string[]): string {
  return JSON.stringify(columnNames.map((name) => row[name] ?? null))
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

/** This is a Power Query transformation — it never calls the DAX Measure Runtime (brief §31). */
export function evaluateGroupBy(frame: QueryFrame, step: GroupByStep): StepEvalResult {
  if (step.groupColumnIds.length === 0 && step.aggregations.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'Group By needs at least one grouping column or aggregation.', { stepId: step.id })] }
  }

  const missingGroup = step.groupColumnIds.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missingGroup.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A grouping column no longer exists.', { stepId: step.id, details: { columnIds: missingGroup } })] }
  }

  const sourceColumns = new Map<string, DataColumn>()
  for (const agg of step.aggregations) {
    if (agg.function === 'count-rows') continue
    const column = frame.columns.find((c) => c.id === agg.sourceColumnId)
    if (!column) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'An aggregation source column no longer exists.', { stepId: step.id, details: { columnId: agg.sourceColumnId } })] }
    }
    if (agg.function === 'sum' || agg.function === 'average') {
      if (!NUMERIC_TYPES.has(column.dataType)) {
        return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', `${agg.function.toUpperCase()} requires a numeric column; "${column.name}" is ${column.dataType}.`, { stepId: step.id })] }
      }
    }
    if (agg.function === 'min' || agg.function === 'max') {
      if (!NUMERIC_TYPES.has(column.dataType) && !TEMPORAL_TYPES.has(column.dataType)) {
        return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', `${agg.function.toUpperCase()} requires a numeric or date column; "${column.name}" is ${column.dataType}.`, { stepId: step.id })] }
      }
    }
    sourceColumns.set(agg.outputColumnId, column)
  }

  const groupColumns = step.groupColumnIds.map((id) => frame.columns.find((c) => c.id === id)!)
  const groupNames = groupColumns.map((c) => c.name)

  const groups = new Map<string, { key: Record<string, unknown>; rows: Record<string, unknown>[] }>()
  for (const row of frame.rows) {
    const key = keyFor(row, groupNames)
    let group = groups.get(key)
    if (!group) {
      const keyValues: Record<string, unknown> = {}
      for (const name of groupNames) keyValues[name] = row[name] ?? null
      group = { key: keyValues, rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }

  const outputColumns: DataColumn[] = [
    ...groupColumns,
    ...step.aggregations.map((agg) => aggregationColumn(agg, sourceColumns.get(agg.outputColumnId))),
  ]

  const rows = [...groups.values()].map((group) => {
    const row: Record<string, unknown> = { ...group.key }
    for (const agg of step.aggregations) {
      row[agg.outputName] = computeAggregate(agg, group.rows, sourceColumns.get(agg.outputColumnId))
    }
    return row
  })

  return { frame: { columns: outputColumns, rows }, diagnostics: [] }
}

function aggregationColumn(agg: GroupByAggregation, sourceColumn: DataColumn | undefined): DataColumn {
  if (agg.function === 'count-rows') return { id: agg.outputColumnId, name: agg.outputName, dataType: 'integer', nullable: false }
  if (agg.function === 'average') return { id: agg.outputColumnId, name: agg.outputName, dataType: 'decimal', nullable: true }
  return { id: agg.outputColumnId, name: agg.outputName, dataType: sourceColumn?.dataType ?? 'decimal', nullable: true }
}

function computeAggregate(agg: GroupByAggregation, rows: Record<string, unknown>[], sourceColumn: DataColumn | undefined): unknown {
  if (agg.function === 'count-rows') return rows.length
  const name = sourceColumn!.name
  const isTemporal = TEMPORAL_TYPES.has(sourceColumn!.dataType)

  if (isTemporal && (agg.function === 'min' || agg.function === 'max')) {
    const values = rows.map((r) => r[name]).filter((v): v is string => typeof v === 'string')
    if (values.length === 0) return null
    const sorted = [...values].sort()
    return agg.function === 'min' ? sorted[0] : sorted[sorted.length - 1]
  }

  const values = rows.map((r) => numeric(r[name])).filter((v): v is number => v !== undefined)
  if (values.length === 0) return null

  switch (agg.function) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'average':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    default:
      return null
  }
}
