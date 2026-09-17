import type { DataType } from './data'

export interface TableRef {
  datasetId: string
  tableId: string
}

export interface ColumnRef {
  datasetId: string
  tableId: string
  columnId: string
}

export interface ModelTable {
  id: string
  datasetId: string
  tableId: string
  position?: {
    x: number
    y: number
  }
}

export type RelationshipCardinality = 'one-to-many'
export type CrossFilterDirection = 'single'

export interface Relationship {
  id: string
  one: ColumnRef
  many: ColumnRef
  cardinality: RelationshipCardinality
  crossFilterDirection: CrossFilterDirection
  active: boolean
  createdAt: string
}

/**
 * A row-level expression evaluated against every row of `modelTableId`. The
 * definition (this struct) is the only thing persisted — see
 * `CalculatedColumnExecution` in `runtime/calculatedColumn` for the
 * (unpersisted, recomputable) evaluated output. Belongs to the semantic
 * model, never to the underlying `Dataset`/`DataTable` — Sprint 3 never
 * mutates imported rows to fake a calculated column as a physical one.
 */
export interface CalculatedColumn {
  id: string
  modelTableId: string
  name: string
  expression: string
  dataType: DataType | 'unknown'
  createdAt: string
  updatedAt: string
}

/**
 * A scalar expression evaluated once per query/filter context, never once
 * per row — the Sprint 4 counterpart to `CalculatedColumn`. `homeModelTableId`
 * only decides where the measure is displayed (Power BI's "home table"
 * convention); its execution semantics are model-wide, since a measure's
 * whole point is to aggregate across whatever tables the current
 * `FilterContext` reaches. See docs/MEASURES.md.
 */
export interface Measure {
  id: string
  homeModelTableId: string
  name: string
  expression: string
  dataType: DataType | 'unknown'
  createdAt: string
  updatedAt: string
}

export interface SemanticModel {
  id: string
  name: string
  tables: ModelTable[]
  relationships: Relationship[]
  calculatedColumns: CalculatedColumn[]
  /**
   * Always populated at runtime — models persisted before Sprint 4 won't
   * have this field on disk, so every load path normalizes it through
   * `hydrateSemanticModel` (persistence/modelStore.ts) rather than letting
   * `undefined` leak into runtime code. See docs/MEASURES.md "Persistence".
   */
  measures: Measure[]
  createdAt: string
  updatedAt: string
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export type RelationshipDiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'SELF_RELATIONSHIP'
  | 'COLUMN_TYPE_MISMATCH'
  | 'ONE_SIDE_NOT_UNIQUE'
  | 'DUPLICATE_RELATIONSHIP'
  | 'UNMATCHED_FOREIGN_KEYS'

export type ModelDiagnosticCode =
  | 'ACTIVE_CYCLE'
  | 'AMBIGUOUS_PATH'
  | 'ISOLATED_TABLE'
  | 'STAR_SCHEMA_VALID'
  | 'MULTIPLE_FACT_TABLES'
  | 'DIMENSION_ON_MANY_SIDE'
  | RelationshipDiagnosticCode

export interface RelationshipDiagnostic {
  severity: DiagnosticSeverity
  code: RelationshipDiagnosticCode
  message: string
  details?: Record<string, unknown>
}

export interface ModelDiagnostic {
  severity: DiagnosticSeverity
  code: ModelDiagnosticCode
  message: string
  details?: Record<string, unknown>
}
