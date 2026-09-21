import type { DataColumn } from '../../domain/data'

/**
 * The in-flight shape every step operates on: a schema-only column list plus
 * plain row records, deliberately lighter than a full `Dataset`/`DataTable`
 * (no ids/names/rowCount bookkeeping) since it only exists between steps
 * inside one evaluation pass. Never mutated in place — every step returns a
 * new frame (docs/POWER_QUERY_RUNTIME.md "No in-place mutation").
 */
export interface QueryFrame {
  columns: DataColumn[]
  rows: Record<string, unknown>[]
}

export function cloneFrame(frame: QueryFrame): QueryFrame {
  return { columns: frame.columns.map((c) => ({ ...c })), rows: frame.rows.map((r) => ({ ...r })) }
}

export function findColumn(frame: QueryFrame, columnId: string): DataColumn | undefined {
  return frame.columns.find((c) => c.id === columnId)
}
