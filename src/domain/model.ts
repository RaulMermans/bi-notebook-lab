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

export interface SemanticModel {
  id: string
  name: string
  tables: ModelTable[]
  relationships: Relationship[]
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
