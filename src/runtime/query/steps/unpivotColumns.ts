import type { UnpivotColumnsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'
import { inferOutputType } from './inferOutputType'

/**
 * O(rows × selectedColumns). `columnIds` means "the columns to unpivot" in
 * `'selected'` mode, and "the columns to keep untouched" in
 * `'other-columns'` mode (mirrors Power Query's own two menu entries over
 * the same column selection). Untouched column ids are preserved exactly —
 * only the new attribute/value columns (generated once by
 * `queryStepFactory.ts`) are new identities.
 */
export function evaluateUnpivotColumns(frame: QueryFrame, step: UnpivotColumnsStep): StepEvalResult {
  const validIds = new Set(frame.columns.map((c) => c.id))
  const missing = step.columnIds.filter((id) => !validIds.has(id))
  if (missing.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_UNPIVOT_COLUMN_NOT_FOUND', 'Unpivot Columns references a column that no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
  }

  const unpivotIds = step.mode === 'selected' ? step.columnIds : frame.columns.filter((c) => !step.columnIds.includes(c.id)).map((c) => c.id)
  const keepColumns = frame.columns.filter((c) => !unpivotIds.includes(c.id))
  const unpivotColumns = frame.columns.filter((c) => unpivotIds.includes(c.id))

  if (unpivotColumns.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'Unpivot Columns has no columns to unpivot.', { stepId: step.id })] }
  }

  const existingKeepNames = new Set(keepColumns.map((c) => c.name.toLowerCase()))
  if (existingKeepNames.has(step.attributeColumnName.toLowerCase()) || existingKeepNames.has(step.valueColumnName.toLowerCase())) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', 'The unpivot attribute/value column names collide with a kept column.', { stepId: step.id })] }
  }

  const rows: Record<string, unknown>[] = []
  const values: unknown[] = []
  for (const row of frame.rows) {
    const kept: Record<string, unknown> = {}
    for (const column of keepColumns) kept[column.name] = row[column.name]
    for (const column of unpivotColumns) {
      const value = row[column.name] ?? null
      values.push(value)
      rows.push({ ...kept, [step.attributeColumnName]: column.name, [step.valueColumnName]: value })
    }
  }

  const inferred = inferOutputType(values)
  const valueDataType = inferred.ok ? inferred.dataType : 'unknown'

  const outputColumns = [
    ...keepColumns,
    { id: step.attributeColumnId, name: step.attributeColumnName, dataType: 'string' as const, nullable: false },
    { id: step.valueColumnId, name: step.valueColumnName, dataType: valueDataType, nullable: true },
  ]

  return { frame: { columns: outputColumns, rows }, diagnostics: [] }
}
