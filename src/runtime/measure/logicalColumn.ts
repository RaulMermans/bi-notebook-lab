import type { DataType, Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import { evaluateCalculatedColumn } from '../calculatedColumn/calculatedColumnRuntime'
import { resolveTableRef } from '../model/modelRuntime'

/**
 * A column a measure can aggregate: either a physical column on the
 * underlying `DataTable`, or a Sprint 3 `CalculatedColumn` on the model.
 * Aggregation binding resolves through this abstraction instead of two
 * separate code paths, and evaluation never mutates `DataTable.columns` to
 * fake a calculated column as physical (see docs/MEASURES.md "Logical column
 * access").
 */
export interface LogicalColumnRef {
  modelTableId: string
  kind: 'physical' | 'calculated'
  /** Physical `DataColumn.id`, or Sprint 3 `CalculatedColumn.id`. */
  columnId: string
  name: string
  dataType: DataType | 'unknown'
}

/** Resolves a column name against a model table's physical columns first, then its calculated columns. */
export function resolveLogicalColumn(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  columnName: string,
): LogicalColumnRef | undefined {
  const lower = columnName.toLowerCase()
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined

  const physical = resolved?.table.columns.find((c) => c.name.toLowerCase() === lower)
  if (physical) {
    return { modelTableId, kind: 'physical', columnId: physical.id, name: physical.name, dataType: physical.dataType }
  }

  const calculated = model.calculatedColumns.find((c) => c.modelTableId === modelTableId && c.name.toLowerCase() === lower)
  if (calculated) {
    return { modelTableId, kind: 'calculated', columnId: calculated.id, name: calculated.name, dataType: calculated.dataType }
  }

  return undefined
}

/**
 * The column's values, aligned to its target table's row order (index `i`
 * is the value for row `i`). Calculated-column values are obtained by
 * reusing the Sprint 3 evaluator (`evaluateCalculatedColumn`), never
 * reimplemented here.
 */
export function getLogicalColumnValues(model: SemanticModel, datasets: Record<string, Dataset>, ref: LogicalColumnRef): unknown[] {
  if (ref.kind === 'physical') {
    const modelTable = model.tables.find((t) => t.id === ref.modelTableId)
    const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
    return resolved?.table.rows.map((row) => row[ref.name] ?? null) ?? []
  }

  const execution = evaluateCalculatedColumn(model, datasets, ref.columnId)
  return execution?.values ?? []
}
