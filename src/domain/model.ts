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

export type RelationshipCardinality = 'one-to-many' | 'one-to-one' | 'many-to-many'
export type RelationshipSide = 'left' | 'right'
export type CrossFilterDirection = 'left-to-right' | 'right-to-left' | 'both'

/**
 * Sprint 11's canonical relationship shape — generic across 1:*, 1:1 and *:*,
 * single-direction and bidirectional cross-filter, active and inactive. No
 * runtime code may read fields named `one`/`many`; see
 * `runtime/model/relationshipHelpers.ts` for the orientation helpers every
 * consumer goes through instead. Models persisted before Sprint 11 (which
 * stored `{ one, many, cardinality: 'one-to-many', crossFilterDirection:
 * 'single' }`) are converted to this shape by `hydrateSemanticModel`
 * (docs/ADVANCED_RELATIONSHIPS.md "Legacy hydration") — never at rest.
 */
export interface Relationship {
  id: string
  left: ColumnRef
  right: ColumnRef
  cardinality: RelationshipCardinality
  /** Which side is the unique "1" side — required for `one-to-many`, absent for `one-to-one`/`many-to-many` (docs/ADVANCED_RELATIONSHIPS.md). */
  oneSide?: RelationshipSide
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

/**
 * Marks `modelTableId` as a Classic Power BI-style Date Table with
 * `dateColumn` as its canonical date column — the marking Sprint 10's
 * time-intelligence functions (`SAMEPERIODLASTYEAR`, `DATEADD`, ...) require
 * before they'll operate on a column (docs/DATE_TABLES.md). A model may
 * contain more than one marked date table (Power BI allows role-playing date
 * dimensions), so this is a plural, normalized list rather than a single
 * `dateTableId` on `SemanticModel` — never hardcode "the" Calendar table.
 */
export interface DateTableDefinition {
  modelTableId: string
  dateColumn: ColumnRef
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
  /**
   * Always populated at runtime — models persisted before Sprint 10 won't
   * have this field on disk, normalized to `[]` by `hydrateSemanticModel`
   * exactly like `measures` above. See docs/DATE_TABLES.md "Persistence".
   */
  dateTables: DateTableDefinition[]
  createdAt: string
  updatedAt: string
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export type RelationshipDiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'SELF_RELATIONSHIP'
  | 'COLUMN_TYPE_MISMATCH'
  | 'ONE_SIDE_NOT_UNIQUE'
  | 'LEFT_SIDE_NOT_UNIQUE'
  | 'RIGHT_SIDE_NOT_UNIQUE'
  | 'INVALID_CARDINALITY'
  | 'INVALID_CROSS_FILTER_DIRECTION'
  | 'ONE_TO_ONE_REQUIRES_BOTH'
  | 'MANY_TO_MANY_RELATIONSHIP'
  | 'BIDIRECTIONAL_RELATIONSHIP'
  | 'DUPLICATE_RELATIONSHIP'
  | 'UNMATCHED_FOREIGN_KEYS'
  | 'ONE_TO_ONE_COVERAGE'
  | 'RELATIONSHIP_CREATES_AMBIGUOUS_PATH'

/**
 * Sprint 11 (§15-18): `ACTIVE_CYCLE` is retired — a legal bidirectional
 * relationship is a 2-node directed cycle, so simple directed-cycle
 * detection is the wrong tool once bidirectional cross-filter exists. The
 * only graph-invalidating condition now is `AMBIGUOUS_FILTER_PATH` (more
 * than one distinct directed propagation path between an ordered table
 * pair) — see `runtime/model/graphAnalysis.ts` and docs/ADVANCED_RELATIONSHIPS.md
 * "Ambiguity detection".
 */
export type ModelDiagnosticCode =
  | 'AMBIGUOUS_FILTER_PATH'
  | 'PROPAGATION_DID_NOT_CONVERGE'
  | 'ISOLATED_TABLE'
  | 'STAR_SCHEMA_VALID'
  | 'MULTIPLE_FACT_TABLES'
  | 'DIMENSION_ON_MANY_SIDE'
  | 'MULTIPLE_RELATIONSHIPS_BETWEEN_TABLES'
  | 'INACTIVE_RELATIONSHIP'
  | 'ROLE_PLAYING_RELATIONSHIP_PATTERN'
  | 'BIDIRECTIONAL_FILTERING_WARNING'
  | 'MANY_TO_MANY_WARNING'
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
