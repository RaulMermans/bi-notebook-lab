export type DataType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'null'
  | 'unknown'

export interface DataColumn {
  id: string
  name: string
  dataType: DataType
  nullable: boolean
}

export interface DataTable {
  id: string
  name: string
  columns: DataColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
}

export type DatasetSource =
  | { type: 'csv'; fileName: string }
  | { type: 'xlsx'; fileName: string; sheetName: string }
  | { type: 'sample'; key: string }
  /**
   * Sprint 12: the dataset is a Power Query output, not a raw import.
   * `revision` is the query's semantic fingerprint rolled up through its
   * dependencies (`runtime/query/queryFingerprint.ts`) — it changes exactly
   * when re-evaluating the query would produce different output, and is
   * folded into the Validation Engine fingerprint (docs/POWER_QUERY_RUNTIME.md
   * "Validation staleness").
   */
  | { type: 'query'; queryId: string; revision: string }

export interface Dataset {
  id: string
  name: string
  source: DatasetSource
  tables: DataTable[]
  createdAt: string
}

/**
 * Sprint 1 imports always produce one table per dataset (one CSV file, one
 * selected sheet, or one sample table). `tables` stays an array so a dataset
 * can represent a multi-table source in a later sprint without a contract
 * change.
 */
export function primaryTable(dataset: Dataset): DataTable {
  const table = dataset.tables[0]
  if (!table) {
    throw new Error(`Dataset "${dataset.name}" has no tables.`)
  }
  return table
}

export const DATA_LIMITS = {
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxRowsPerTable: 100_000,
  maxColumns: 200,
} as const
