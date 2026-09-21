import type { ModelDiagnosticCode } from './model'

/**
 * Author-facing selectors — the Sprint 5 layer that lets an exercise
 * reference model concepts by stable, human-authored names instead of
 * generated runtime ids. Built-in datasets (e.g. the Retail sample)
 * generate a fresh id every time they're imported, so an authored
 * `ValidationSpec` can never store a `datasetId`/`tableId`/`columnId`
 * directly — it stores a selector and lets
 * `runtime/validation/selectorResolver.ts` resolve it against the current
 * model at validation time. See docs/VALIDATION_ENGINE.md "Author
 * selectors vs runtime ids".
 */
export interface TableSelector {
  tableName: string
  /**
   * Disambiguates when more than one table in the model shares
   * `tableName` (e.g. two imports of the same CSV). Matched against the
   * dataset's own source identity: a sample dataset's `source.key`, an
   * xlsx dataset's `source.sheetName`, or a csv dataset's `source.fileName`.
   */
  sourceKey?: string
}

export interface ColumnSelector {
  table: TableSelector
  columnName: string
}

export interface MeasureSelector {
  name: string
}

export interface CalculatedColumnSelector {
  table: TableSelector
  name: string
}

/**
 * Floating-point results are never compared with `===`. `absolute-or-relative`
 * (the default) passes if either bound is satisfied, which tolerates both
 * small totals (where a fixed absolute epsilon matters) and large totals
 * (where a fixed epsilon would be too strict) — see docs/VALIDATION_ENGINE.md
 * "Numeric tolerance".
 */
export type NumericTolerance =
  | { type: 'absolute'; value: number }
  | { type: 'relative'; value: number }
  | { type: 'absolute-or-relative'; absolute: number; relative: number }

export const DEFAULT_NUMERIC_TOLERANCE: NumericTolerance = {
  type: 'absolute-or-relative',
  absolute: 0.01,
  relative: 0.000001,
}

/** Sprint 5 supports exactly these scalar shapes for an expected result — see docs/VALIDATION_ENGINE.md "Scalar comparisons". */
export type ValidationScalar = number | string | boolean | null

export interface ValidationFilter {
  column: ColumnSelector
  /** Defaults to `'equals'` for a single value and `'in'` for more than one — see measureValidation.ts. */
  operator?: 'equals' | 'in'
  values: unknown[]
}

export type ValidationRuleType =
  | 'relationship'
  | 'model-health'
  | 'table-present'
  | 'calculated-column-result'
  | 'measure-result'
  | 'expression-semantics'
  | 'date-table'

export interface BaseValidationRule {
  id: string
  type: ValidationRuleType
  points: number
  /** A failed required rule blocks an overall PASS even if the score reaches `passingPercentage`. Use sparingly — see docs/VALIDATION_ENGINE.md "Required rules". */
  required?: boolean
  title: string
  /** Display-only grouping for the TestCell UI/report (e.g. "Model", "Measures"). Never read by scoring. */
  category?: string
}

export interface RelationshipValidationRule extends BaseValidationRule {
  type: 'relationship'
  one: ColumnSelector
  many: ColumnSelector
  /** Defaults to `true` — most exercises expect the relationship to be active. */
  active?: boolean
}

export interface ModelHealthValidationRule extends BaseValidationRule {
  type: 'model-health'
  /** Defaults to `true`: no `ACTIVE_CYCLE`/other error-severity model diagnostic. */
  requireValidGraph?: boolean
  requireStarSchema?: boolean
  forbidDiagnostics?: ModelDiagnosticCode[]
}

export interface TablePresenceValidationRule extends BaseValidationRule {
  type: 'table-present'
  table: TableSelector
}

/** Identifies a specific row by an equality match on one of its columns — never "the first row" (see docs/VALIDATION_ENGINE.md "Row identity"). */
export interface RowSelector {
  column: ColumnSelector
  equals: unknown
}

export interface CalculatedColumnValidationCase {
  id: string
  title?: string
  row: RowSelector
  expected: ValidationScalar
  tolerance?: NumericTolerance
}

export interface CalculatedColumnResultRule extends BaseValidationRule {
  type: 'calculated-column-result'
  column: CalculatedColumnSelector
  cases: CalculatedColumnValidationCase[]
}

export interface MeasureValidationCase {
  id: string
  title: string
  filters: ValidationFilter[]
  expected: ValidationScalar
  tolerance?: NumericTolerance
  /** Relative contribution to the rule's partial credit. Defaults to `1` (equal weighting) — see docs/VALIDATION_ENGINE.md "Partial credit". */
  weight?: number
}

export interface MeasureResultValidationRule extends BaseValidationRule {
  type: 'measure-result'
  measure: MeasureSelector
  cases: MeasureValidationCase[]
}

export type ExpressionSemanticAssertion =
  | { kind: 'uses-function'; functionName: string }
  | { kind: 'references-measure'; measureName: string }
  | { kind: 'references-column'; column: ColumnSelector }
  | { kind: 'not-constant-only' }

export interface ExpressionSemanticValidationRule extends BaseValidationRule {
  type: 'expression-semantics'
  target: { kind: 'measure'; measure: MeasureSelector } | { kind: 'calculated-column'; column: CalculatedColumnSelector }
  assertions: ExpressionSemanticAssertion[]
}

/**
 * Sprint 10: checks that `table` is marked as a Date Table using exactly
 * `dateColumn` as its canonical date column, and that the marking is
 * currently valid (contiguous, unique, non-blank — see
 * `runtime/dateTable/dateTableRuntime.ts`). See docs/DATE_TABLES.md
 * "Validation Engine integration".
 */
export interface DateTableValidationRule extends BaseValidationRule {
  type: 'date-table'
  table: TableSelector
  dateColumn: ColumnSelector
}

export type ValidationRule =
  | RelationshipValidationRule
  | ModelHealthValidationRule
  | TablePresenceValidationRule
  | CalculatedColumnResultRule
  | MeasureResultValidationRule
  | ExpressionSemanticValidationRule
  | DateTableValidationRule

/**
 * The canonical, persisted validation contract — lives on a `TestCell`
 * (`domain/notebook.ts`). Never contains generated runtime ids; every
 * target is an author selector resolved fresh at validation time.
 */
export interface ValidationSpec {
  id: string
  title: string
  passingPercentage: number
  rules: ValidationRule[]
}

export type ValidationRuleStatus = 'passed' | 'partial' | 'failed' | 'error'

export interface ValidationFeedback {
  severity: 'success' | 'info' | 'warning' | 'error'
  code: string
  message: string
  hint?: string
}

/** Machine-readable diagnostic detail (resolved ids, per-case actual/expected/delta). Never shown to the learner directly — see docs/VALIDATION_ENGINE.md "Evidence vs feedback". */
export type ValidationEvidence = Record<string, unknown>

export interface ValidationRuleResult {
  ruleId: string
  title: string
  category?: string
  status: ValidationRuleStatus
  pointsEarned: number
  pointsPossible: number
  required: boolean
  feedback: ValidationFeedback[]
  evidence?: ValidationEvidence
}

/**
 * The result of one `runValidation()` call. Never persisted — recomputed on
 * every "Check solution" click (see docs/VALIDATION_ENGINE.md "Persistence
 * boundaries"). `fingerprint` lets the UI detect when the model has changed
 * since this run and the score is no longer trustworthy.
 */
export interface ValidationRun {
  testCellId: string
  pointsEarned: number
  pointsPossible: number
  percentage: number
  passed: boolean
  ruleResults: ValidationRuleResult[]
  fingerprint: string
}
