import type { DataType, Dataset } from '../domain/data'
import type { ColumnRef, CrossFilterDirection, Relationship, SemanticModel } from '../domain/model'
import { bindPredicateExpression, dedupeColumnRefs, describeBoundPredicate, type BoundPredicateNode } from '../runtime/measure/booleanFilter'
import type { FilterModifier } from '../runtime/measure/contextModifier'
import { resolveLogicalColumn, type LogicalColumnRef } from '../runtime/measure/logicalColumn'
import { bindTableExpression } from '../runtime/tableExpression/tableExpressionBinder'
import type { BoundTableExpression, BoundTimeIntelligenceTable } from '../runtime/tableExpression/tableExpressionTypes'
import { bindDateColumnArgument } from '../runtime/timeIntelligence/timeIntelligenceBinder'
import { bindIteratorCall, isIteratorFunctionName } from '../runtime/iterator/iteratorBinder'
import type { BoundIteratorCall } from '../runtime/iterator/iteratorTypes'
import { resolveTableRef } from '../runtime/model/modelRuntime'
import { relationshipConnectsColumns, siblingRelationships } from '../runtime/model/relationshipHelpers'
import type { BinaryOperator, ComparisonOperator, Expression, FunctionCallNode, LogicalOperator, SourceSpan, UnaryOperator } from './ast'
import { findModelTableByName } from './binder'
import { diagnostic, type ExpressionDiagnostic, type ExpressionDiagnosticCode } from './diagnostics'

/**
 * Bound measure AST — the filter-context counterpart to `BoundExpression`
 * (calculated columns) in `binder.ts`. Shares the same parser/AST/diagnostics
 * (see docs/EXPRESSION_ENGINE.md "Expression strategy"); diverges only here,
 * at binding, because a measure has no row context: a bare column is
 * rejected, `[Name]` always means a measure reference, and aggregation/
 * table-scoped functions become their own bound-node kinds.
 */
export interface BoundMeasureLiteral {
  kind: 'Literal'
  value: number | string | boolean
  span: SourceSpan
}

export interface BoundMeasureUnary {
  kind: 'Unary'
  operator: UnaryOperator
  operand: BoundMeasureExpression
  span: SourceSpan
}

export interface BoundMeasureBinary {
  kind: 'Binary'
  operator: BinaryOperator
  left: BoundMeasureExpression
  right: BoundMeasureExpression
  span: SourceSpan
}

/** `[Measure Name]` — resolved to a stable measure id, never re-resolved by name during evaluation. */
export interface BoundMeasureReference {
  kind: 'MeasureReference'
  measureId: string
  measureName: string
  span: SourceSpan
}

export type AggregationFunction = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'DISTINCTCOUNT'

export interface BoundAggregation {
  kind: 'Aggregation'
  function: AggregationFunction
  modelTableId: string
  column: LogicalColumnRef
  label: string
  span: SourceSpan
}

export interface BoundCountRows {
  kind: 'CountRows'
  /** Sprint 9 generalizes COUNTROWS from a bare model table to any `BoundTableExpression` (sprint brief §14) — `COUNTROWS(Sales)` still binds to a plain `BaseTable`, so existing behavior is unchanged. */
  table: BoundTableExpression
  label: string
  span: SourceSpan
}

export interface BoundDivide {
  kind: 'Divide'
  numerator: BoundMeasureExpression
  denominator: BoundMeasureExpression
  alternate?: BoundMeasureExpression
  span: SourceSpan
}

/**
 * Sprint 8 additions. `Comparison`/`Logical` are general scalar boolean
 * results — any measure may return a boolean, the same way real DAX allows
 * `[X] > 100` as a measure body. `Calculate` is CALCULATE itself: an
 * expression evaluated under a *modified* filter context (docs/CALCULATE.md).
 */
export interface BoundMeasureComparison {
  kind: 'Comparison'
  operator: ComparisonOperator
  left: BoundMeasureExpression
  right: BoundMeasureExpression
  span: SourceSpan
}

export interface BoundMeasureLogical {
  kind: 'Logical'
  operator: LogicalOperator
  left: BoundMeasureExpression
  right: BoundMeasureExpression
  span: SourceSpan
}

export interface BoundCalculate {
  kind: 'Calculate'
  expression: BoundMeasureExpression
  modifiers: FilterModifier[]
  label: string
  span: SourceSpan
}

/**
 * Sprint 9 additions (sprint brief §29-§38): `IF`/`SWITCH`/`BLANK` close the
 * conditional-logic gap, `SELECTEDVALUE` reads the current FilterContext's
 * distinct-visible-values, and `Iterator` is `SUMX`/`AVERAGEX`/`MINX`/
 * `MAXX`/`COUNTX` (bound in `runtime/iterator/iteratorBinder.ts` — reused
 * here rather than duplicated, sprint brief §16 "measureEvaluator may
 * dispatch to the iterator runtime").
 */
export interface BoundMeasureIf {
  kind: 'If'
  condition: BoundMeasureExpression
  whenTrue: BoundMeasureExpression
  whenFalse?: BoundMeasureExpression
  span: SourceSpan
}

export interface BoundMeasureSwitchCase {
  value: BoundMeasureExpression
  result: BoundMeasureExpression
}

export interface BoundMeasureSwitch {
  kind: 'Switch'
  expression: BoundMeasureExpression
  cases: BoundMeasureSwitchCase[]
  defaultResult?: BoundMeasureExpression
  span: SourceSpan
}

export interface BoundMeasureBlank {
  kind: 'Blank'
  span: SourceSpan
}

export interface BoundSelectedValue {
  kind: 'SelectedValue'
  column: ColumnRef
  modelTableId: string
  columnName: string
  tableName: string
  alternate?: BoundMeasureExpression
  span: SourceSpan
}

/** Sprint 15 (VAR/RETURN) — see `binder.ts`'s `BoundVariableReference`/`BoundVarReturn` doc comments; the measure-context siblings. */
export interface BoundMeasureVariableReference {
  kind: 'VariableReference'
  name: string
  span: SourceSpan
}

export interface BoundMeasureVariableDeclaration {
  name: string
  value: BoundMeasureExpression
}

export interface BoundMeasureVarReturn {
  kind: 'VarReturn'
  variables: BoundMeasureVariableDeclaration[]
  body: BoundMeasureExpression
  span: SourceSpan
}

/** Sprint 15 (ISBLANK) — one-arg, no filter-context dependency, valid in both binders. */
export interface BoundIsBlank {
  kind: 'IsBlank'
  operand: BoundMeasureExpression
  span: SourceSpan
}

/** Sprint 15 (HASONEVALUE) — measure-only: "exactly one distinct visible value" under the current FilterContext. */
export interface BoundHasOneValue {
  kind: 'HasOneValue'
  column: ColumnRef
  modelTableId: string
  columnName: string
  tableName: string
  span: SourceSpan
}

export type BoundMeasureExpression =
  | BoundMeasureLiteral
  | BoundMeasureUnary
  | BoundMeasureBinary
  | BoundMeasureReference
  | BoundAggregation
  | BoundCountRows
  | BoundDivide
  | BoundMeasureComparison
  | BoundMeasureLogical
  | BoundCalculate
  | BoundMeasureIf
  | BoundMeasureSwitch
  | BoundMeasureBlank
  | BoundSelectedValue
  | BoundIteratorCall
  | BoundMeasureVariableReference
  | BoundMeasureVarReturn
  | BoundIsBlank
  | BoundHasOneValue

export interface MeasureBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  /**
   * Sprint 15 (VAR/RETURN). Optional because `MeasureBindContext` is
   * constructed as a plain `{model, datasets}` object literal by external
   * callers (`measureRuntime.ts`, etc.) — every read site defaults via
   * `??`. `bindMeasureExpression` (the real entry point) sets these
   * explicitly. See `binder.ts`'s `ResolvedBindContext` for the equivalent
   * fields in the calculated-column binder.
   */
  variables?: Map<string, BoundMeasureExpression>
  pendingVariables?: Set<string>
  inVariableScope?: boolean
}

export interface MeasureBindResult {
  bound?: BoundMeasureExpression
  diagnostics: ExpressionDiagnostic[]
}

const NUMERIC_TYPES = new Set<DataType>(['integer', 'decimal'])
const COMPARABLE_TYPES = new Set<DataType>(['integer', 'decimal', 'date', 'datetime'])

const AGGREGATION_FUNCTIONS: Record<string, AggregationFunction> = {
  SUM: 'SUM',
  AVERAGE: 'AVERAGE',
  MIN: 'MIN',
  MAX: 'MAX',
  COUNT: 'COUNT',
  DISTINCTCOUNT: 'DISTINCTCOUNT',
}

const STRICTLY_NUMERIC_AGGREGATIONS = new Set<AggregationFunction>(['SUM', 'AVERAGE'])
const COMPARISON_AGGREGATIONS = new Set<AggregationFunction>(['MIN', 'MAX'])

function tableDisplayName(ctx: MeasureBindContext, modelTableId: string): string {
  const modelTable = ctx.model.tables.find((t) => t.id === modelTableId)
  return (modelTable && resolveTableRef(ctx.datasets, modelTable)?.table.name) ?? modelTableId
}

function bindMeasureReference(name: string, span: SourceSpan, ctx: MeasureBindContext): MeasureBindResult {
  const target = ctx.model.measures.find((m) => m.name.toLowerCase() === name.toLowerCase())
  if (!target) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_MEASURE', `Unknown measure "${name}". It isn't defined in this model.`, span, { measure: name }),
      ],
    }
  }
  return { bound: { kind: 'MeasureReference', measureId: target.id, measureName: target.name, span }, diagnostics: [] }
}

function bindAggregationCall(name: string, fn: AggregationFunction, node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  const [arg] = node.args
  if (node.args.length !== 1 || arg.kind !== 'ColumnReference' || arg.table === null) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_AGGREGATION_ARGUMENT',
          `${name} expects exactly one argument in the form Table[Column], e.g. ${name}(Sales[Revenue]).`,
          node.span,
        ),
      ],
    }
  }

  const targetModelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
  if (!targetModelTable) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}". It isn't part of this model.`, arg.tableSpan ?? arg.span, {
          table: arg.table,
        }),
      ],
    }
  }

  const column = resolveLogicalColumn(ctx.model, ctx.datasets, targetModelTable.id, arg.column)
  if (!column) {
    const tableName = tableDisplayName(ctx, targetModelTable.id)
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${arg.column}" on "${tableName}".`, arg.columnSpan, {
          table: tableName,
          column: arg.column,
        }),
      ],
    }
  }

  if (STRICTLY_NUMERIC_AGGREGATIONS.has(fn) && !NUMERIC_TYPES.has(column.dataType as DataType)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'NON_NUMERIC_AGGREGATION',
          `${name} requires a numeric column, but "${column.name}" is ${column.dataType}.`,
          node.span,
          { column: column.name, dataType: column.dataType },
        ),
      ],
    }
  }

  if (COMPARISON_AGGREGATIONS.has(fn) && !COMPARABLE_TYPES.has(column.dataType as DataType)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'NON_NUMERIC_AGGREGATION',
          `${name} requires a numeric or date column, but "${column.name}" is ${column.dataType}.`,
          node.span,
          { column: column.name, dataType: column.dataType },
        ),
      ],
    }
  }

  const tableName = tableDisplayName(ctx, targetModelTable.id)
  return {
    bound: {
      kind: 'Aggregation',
      function: fn,
      modelTableId: targetModelTable.id,
      column,
      label: `${name}(${tableName}[${column.name}])`,
      span: node.span,
    },
    diagnostics: [],
  }
}

/** Sprint 9 generalizes COUNTROWS to accept any `BoundTableExpression` (sprint brief §14): `COUNTROWS(Sales)`, `COUNTROWS(FILTER(Sales, ...))`, `COUNTROWS(VALUES(Customers[Country]))`. */
function bindCountRows(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 1) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_AGGREGATION_ARGUMENT', 'COUNTROWS expects exactly one table argument, e.g. COUNTROWS(Sales).', node.span),
      ],
    }
  }

  const tableResult = bindTableExpression(node.args[0], ctx)
  if (!tableResult.bound) return { diagnostics: tableResult.diagnostics }

  return {
    bound: { kind: 'CountRows', table: tableResult.bound, label: `COUNTROWS(${describeTableExpression(tableResult.bound)})`, span: node.span },
    diagnostics: tableResult.diagnostics,
  }
}

function bindDivide(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length < 2 || node.args.length > 3) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_FUNCTION_ARGUMENT',
          'DIVIDE expects 2 or 3 arguments: DIVIDE(numerator, denominator) or DIVIDE(numerator, denominator, alternateResult).',
          node.span,
        ),
      ],
    }
  }

  const numerator = bindMeasureNode(node.args[0], ctx)
  const denominator = bindMeasureNode(node.args[1], ctx)
  const alternate = node.args[2] ? bindMeasureNode(node.args[2], ctx) : undefined
  const diagnostics = [...numerator.diagnostics, ...denominator.diagnostics, ...(alternate?.diagnostics ?? [])]

  if (!numerator.bound || !denominator.bound || (node.args[2] && !alternate?.bound)) {
    return { diagnostics }
  }

  return {
    bound: { kind: 'Divide', numerator: numerator.bound, denominator: denominator.bound, alternate: alternate?.bound, span: node.span },
    diagnostics,
  }
}

const UNSUPPORTED_CALCULATE_ADJACENT_FUNCTIONS = new Set([
  'KEEPFILTERS',
  'ALLEXCEPT',
  'ALLSELECTED',
  'CALCULATETABLE',
])

/** Sprint 15 (VAR/RETURN): `VAR`/`RETURN` themselves can't double as variable names. */
const INVALID_VARIABLE_NAME = /^(VAR|RETURN)$/i

/** Extracts `Column = Literal` (or `Literal = Column`) as a canonical `ColumnFilter` — sprint brief §16 "Equality can usually become a canonical ColumnFilter directly." */
function tryExtractEqualityColumnFilter(node: BoundPredicateNode): { column: ColumnRef; value: number | string | boolean } | undefined {
  if (node.kind !== 'Comparison' || node.operator !== '=') return undefined
  if (node.left.kind === 'Column' && node.right.kind === 'Literal') return { column: node.left.ref, value: node.right.value }
  if (node.right.kind === 'Column' && node.left.kind === 'Literal') return { column: node.right.ref, value: node.left.value }
  return undefined
}

/** Binds a direct CALCULATE boolean filter argument, e.g. `Customers[Country] = "Spain"` or `Products[Price] > 50 && Products[Category] = "Furniture"`. */
function bindDirectBooleanFilter(argNode: Expression, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  const result = bindPredicateExpression(argNode, ctx.model, ctx.datasets)
  if (!result.bound || !result.modelTableId) return { diagnostics: result.diagnostics }

  const equality = tryExtractEqualityColumnFilter(result.bound)
  if (equality) {
    return {
      modifier: {
        kind: 'ReplaceColumnFilter',
        column: equality.column,
        operator: 'equals',
        values: [equality.value],
        label: describeBoundPredicate(result.bound),
      },
      diagnostics: result.diagnostics,
    }
  }

  return {
    modifier: {
      kind: 'PredicateFilter',
      modelTableId: result.modelTableId,
      referencedColumns: dedupeColumnRefs(result.referencedColumns),
      predicate: result.bound,
      label: describeBoundPredicate(result.bound),
      tableWide: false,
    },
    diagnostics: result.diagnostics,
  }
}

/** Binds `REMOVEFILTERS()` / `REMOVEFILTERS(Table[Column], ...)` / `REMOVEFILTERS(Table)` (sprint brief §22-§25). */
function bindRemoveFilters(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length === 0) {
    return { modifier: { kind: 'ClearAllFilters', label: 'REMOVEFILTERS()' }, diagnostics: [] }
  }

  const diagnostics: ExpressionDiagnostic[] = []
  const columnTargets: ColumnRef[] = []
  const tableTargets: string[] = []

  for (const arg of node.args) {
    if (arg.kind === 'ColumnReference' && arg.table !== null) {
      const modelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
      if (!modelTable) {
        diagnostics.push(diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}".`, arg.tableSpan ?? arg.span, { table: arg.table }))
        continue
      }
      const resolved = resolveTableRef(ctx.datasets, modelTable)
      const column = resolved?.table.columns.find((c) => c.name.toLowerCase() === arg.column.toLowerCase())
      if (!resolved || !column) {
        diagnostics.push(
          diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${arg.column}" on "${arg.table}".`, arg.columnSpan, {
            table: arg.table,
            column: arg.column,
          }),
        )
        continue
      }
      columnTargets.push({ datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id })
    } else if (arg.kind === 'TableReference') {
      const modelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
      if (!modelTable) {
        diagnostics.push(diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}".`, arg.span, { table: arg.table }))
        continue
      }
      tableTargets.push(modelTable.id)
    } else {
      diagnostics.push(
        diagnostic(
          'error',
          'INVALID_REMOVEFILTERS_ARGUMENT',
          'REMOVEFILTERS expects column references (Table[Column]) or a single table reference (Table).',
          arg.span,
        ),
      )
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics }

  if (columnTargets.length > 0 && tableTargets.length === 0) {
    return {
      modifier: { kind: 'RemoveColumns', columns: columnTargets, label: `REMOVEFILTERS(${columnTargets.length} column(s))` },
      diagnostics,
    }
  }
  if (tableTargets.length > 0 && columnTargets.length === 0) {
    return { modifier: { kind: 'RemoveTables', modelTableIds: tableTargets, label: 'REMOVEFILTERS(table)' }, diagnostics }
  }
  return {
    diagnostics: [
      diagnostic(
        'error',
        'INVALID_REMOVEFILTERS_ARGUMENT',
        'REMOVEFILTERS supports either one or more columns, or a single table — not a mix of both.',
        node.span,
      ),
    ],
  }
}

/** Binds `ALL(Table)` / `ALL(Table[Column])` as a CALCULATE filter modifier (sprint brief §26-§27 — `ALL` ≈ remove filters for these supported forms only). */
function bindAll(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length !== 1) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_ALL_ARGUMENT', 'ALL expects exactly one argument: ALL(Table) or ALL(Table[Column]).', node.span),
      ],
    }
  }

  const [arg] = node.args
  if (arg.kind === 'TableReference') {
    const modelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
    if (!modelTable) {
      return { diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}".`, arg.span, { table: arg.table })] }
    }
    return { modifier: { kind: 'RemoveTables', modelTableIds: [modelTable.id], label: `ALL(${arg.table})` }, diagnostics: [] }
  }

  if (arg.kind === 'ColumnReference' && arg.table !== null) {
    const modelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
    if (!modelTable) {
      return { diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}".`, arg.tableSpan ?? arg.span, { table: arg.table })] }
    }
    const resolved = resolveTableRef(ctx.datasets, modelTable)
    const column = resolved?.table.columns.find((c) => c.name.toLowerCase() === arg.column.toLowerCase())
    if (!resolved || !column) {
      return {
        diagnostics: [
          diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${arg.column}" on "${arg.table}".`, arg.columnSpan, {
            table: arg.table,
            column: arg.column,
          }),
        ],
      }
    }
    return {
      modifier: {
        kind: 'RemoveColumns',
        columns: [{ datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id }],
        label: `ALL(${arg.table}[${arg.column}])`,
      },
      diagnostics: [],
    }
  }

  return {
    diagnostics: [
      diagnostic('error', 'INVALID_ALL_ARGUMENT', 'ALL expects a table (ALL(Products)) or a column (ALL(Products[Category])).', arg.span),
    ],
  }
}

function describeTableExpression(bound: BoundTableExpression): string {
  switch (bound.kind) {
    case 'BaseTable':
      return bound.tableName
    case 'FilterTable':
      return bound.label
    case 'ValuesTable':
      return `VALUES(${bound.tableName}[${bound.columnName}])`
    case 'DistinctTable':
      return `DISTINCT(${bound.tableName}[${bound.columnName}])`
    case 'TimeIntelligenceTable':
      return bound.label
  }
}

/**
 * Binds `FILTER(Table, predicate)` as a CALCULATE filter modifier (sprint
 * brief §17-§20). Delegates entirely to the shared table-expression binder
 * (`bindTableExpression` → `BoundFilterTable`) so CALCULATE's FILTER and the
 * standalone table-expression FILTER (used by COUNTROWS/iterators) are one
 * implementation, not two (sprint brief §6-§7). Always table-wide: it
 * replaces every existing filter on `Table` (docs/CALCULATE.md).
 */
function bindFilterFunction(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  const result = bindTableExpression(node, ctx)
  if (!result.bound || result.bound.kind !== 'FilterTable') return { diagnostics: result.diagnostics }

  return {
    modifier: {
      kind: 'PredicateFilter',
      modelTableId: result.bound.modelTableId,
      referencedColumns: result.bound.referencedColumns,
      predicate: result.bound.predicate,
      label: result.bound.label,
      tableWide: true,
    },
    diagnostics: result.diagnostics,
  }
}

const TIME_INTELLIGENCE_FUNCTION_NAMES = new Set(['SAMEPERIODLASTYEAR', 'DATEADD', 'PREVIOUSMONTH', 'PREVIOUSYEAR', 'DATESYTD'])

/**
 * Binds a Classic time-intelligence CALCULATE filter argument (sprint brief
 * §18-§27, §30-§34) — delegates to the shared table-expression binder
 * (`bindTableExpression` → `BoundTimeIntelligenceTable`), exactly like
 * `bindFilterFunction` does for `FILTER`, so CALCULATE's usage and the
 * standalone table-expression usage (`COUNTROWS(DATESYTD(...))`, sprint
 * brief §37) are one binder, not two. Always table-wide *replacement* of the
 * Date Table's own filters — see `DateTableReplaceModifier`
 * (contextModifier.ts).
 */
function bindTimeIntelligenceFilterModifier(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  const result = bindTableExpression(node, ctx)
  if (!result.bound || result.bound.kind !== 'TimeIntelligenceTable') return { diagnostics: result.diagnostics }

  return {
    modifier: { kind: 'DateTableReplace', bound: result.bound, label: result.bound.label },
    diagnostics: result.diagnostics,
  }
}

function sameColumnRef(a: ColumnRef, b: ColumnRef): boolean {
  return a.datasetId === b.datasetId && a.tableId === b.tableId && a.columnId === b.columnId
}

/** Resolves a `Table[Column]` argument to a physical `ColumnRef` — the shape `USERELATIONSHIP`/`CROSSFILTER` require for both arguments (sprint brief §23: "fully-qualified physical column references... No measure, expression, calculated result, literal"). */
function resolveQualifiedColumnArg(
  argNode: Expression,
  ctx: MeasureBindContext,
  invalidCode: ExpressionDiagnosticCode,
  invalidMessage: string,
): { resolved?: ColumnRef; label?: string; diagnostics: ExpressionDiagnostic[] } {
  if (argNode.kind !== 'ColumnReference' || argNode.table === null) {
    return { diagnostics: [diagnostic('error', invalidCode, invalidMessage, argNode.span)] }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, argNode.table)
  if (!modelTable) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${argNode.table}".`, argNode.tableSpan ?? argNode.span, { table: argNode.table })],
    }
  }
  const resolvedTable = resolveTableRef(ctx.datasets, modelTable)
  const column = resolvedTable?.table.columns.find((c) => c.name.toLowerCase() === argNode.column.toLowerCase())
  if (!resolvedTable || !column) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${argNode.column}" on "${argNode.table}".`, argNode.columnSpan, {
          table: argNode.table,
          column: argNode.column,
        }),
      ],
    }
  }

  return {
    resolved: { datasetId: resolvedTable.dataset.id, tableId: resolvedTable.table.id, columnId: column.id },
    label: `${resolvedTable.table.name}[${column.name}]`,
    diagnostics: [],
  }
}

function describeRelationshipLabel(model: SemanticModel, datasets: Record<string, Dataset>, relationship: Relationship): string {
  const left = resolveTableRefColumnLabel(model, datasets, relationship.left)
  const right = resolveTableRefColumnLabel(model, datasets, relationship.right)
  return `${left} ↔ ${right}`
}

function resolveTableRefColumnLabel(model: SemanticModel, datasets: Record<string, Dataset>, ref: ColumnRef): string {
  const modelTable = model.tables.find((t) => t.datasetId === ref.datasetId && t.tableId === ref.tableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const column = resolved?.table.columns.find((c) => c.id === ref.columnId)
  return `${resolved?.table.name ?? 'Unknown table'}[${column?.name ?? ref.columnId}]`
}

/** Finds the exactly-one relationship connecting `a`/`b` (either argument order) — shared resolution logic for both `USERELATIONSHIP` and `CROSSFILTER` (sprint brief §23, §70 "argument order may be reversed"). */
function resolveRelationshipArgumentPair(
  ctx: MeasureBindContext,
  a: { resolved?: ColumnRef; label?: string },
  b: { resolved?: ColumnRef; label?: string },
  notFoundCode: ExpressionDiagnosticCode,
  ambiguousCode: ExpressionDiagnosticCode,
  span: Expression['span'],
): { relationship?: Relationship; diagnostics: ExpressionDiagnostic[] } {
  const matches = ctx.model.relationships.filter((r) => relationshipConnectsColumns(r, a.resolved!, b.resolved!))
  if (matches.length === 0) {
    return { diagnostics: [diagnostic('error', notFoundCode, `No relationship connects "${a.label}" and "${b.label}".`, span)] }
  }
  if (matches.length > 1) {
    return { diagnostics: [diagnostic('error', ambiguousCode, `More than one relationship connects "${a.label}" and "${b.label}".`, span)] }
  }
  return { relationship: matches[0], diagnostics: [] }
}

/**
 * Binds `USERELATIONSHIP(Table1[Column], Table2[Column])` as a CALCULATE
 * filter modifier (sprint brief §22-§31). Only valid as a CALCULATE
 * argument. Resolves to exactly one existing relationship regardless of
 * argument order for one-to-many/many-to-many; for a one-to-one relationship
 * the argument order sets a single bounded direction — "arg2's table
 * filters arg1's table" (sprint brief §31) — never silently `'both'`.
 */
function bindUserRelationship(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'USERELATIONSHIP_INVALID_ARITY',
          'USERELATIONSHIP expects exactly two arguments: USERELATIONSHIP(Table1[Column], Table2[Column]).',
          node.span,
        ),
      ],
    }
  }

  const [argA, argB] = node.args
  const invalidMessage = 'USERELATIONSHIP arguments must be fully-qualified physical columns, e.g. Sales[ShipDate] — not a measure, expression, calculated result or literal.'
  const a = resolveQualifiedColumnArg(argA, ctx, 'USERELATIONSHIP_COLUMN_REQUIRED', invalidMessage)
  const b = resolveQualifiedColumnArg(argB, ctx, 'USERELATIONSHIP_COLUMN_REQUIRED', invalidMessage)
  const diagnostics = [...a.diagnostics, ...b.diagnostics]
  if (!a.resolved || !b.resolved) return { diagnostics }

  const found = resolveRelationshipArgumentPair(ctx, a, b, 'USERELATIONSHIP_RELATIONSHIP_NOT_FOUND', 'USERELATIONSHIP_AMBIGUOUS_RELATIONSHIP', node.span)
  diagnostics.push(...found.diagnostics)
  if (!found.relationship) return { diagnostics }

  const relationship = found.relationship
  const siblings = siblingRelationships(ctx.model, relationship)
  const conflictingLabels = siblings.map((s) => describeRelationshipLabel(ctx.model, ctx.datasets, s))
  const modelStateLabel = relationship.active ? 'Active' : 'Inactive'

  let directions: Exclude<CrossFilterDirection, 'both'>[] | undefined
  if (relationship.cardinality === 'one-to-one') {
    const aIsLeft = sameColumnRef(relationship.left, a.resolved)
    directions = [aIsLeft ? 'right-to-left' : 'left-to-right']
  }

  return {
    modifier: {
      kind: 'RelationshipOverride',
      sourceFunction: 'USERELATIONSHIP',
      relationshipId: relationship.id,
      action: directions ? 'direction' : 'activate',
      directions,
      conflictingRelationshipIds: siblings.map((s) => s.id),
      requestedLabel: `${a.label} ↔ ${b.label}`,
      modelStateLabel,
      conflictingLabels,
      label: `USERELATIONSHIP(${a.label}, ${b.label})`,
    },
    diagnostics,
  }
}

const CROSSFILTER_DIRECTION_KEYWORDS = new Set(['NONE', 'BOTH', 'ONEWAY', 'ONEWAY_LEFTFILTERSRIGHT', 'ONEWAY_RIGHTFILTERSLEFT'])

/**
 * Binds `CROSSFILTER(Table1[Column], Table2[Column], direction)` as a
 * CALCULATE filter modifier (sprint brief §32-§34). The direction argument
 * parses as a bare identifier (`TableReference` node, same as `DATEADD`'s
 * `YEAR`/`QUARTER`/`MONTH`/`DAY` — no grammar change needed) and is
 * validated against the resolved relationship's cardinality.
 */
function bindCrossFilter(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length !== 3) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'CROSSFILTER_INVALID_ARITY',
          'CROSSFILTER expects exactly three arguments: CROSSFILTER(Table1[Column], Table2[Column], NONE|BOTH|ONEWAY|ONEWAY_LEFTFILTERSRIGHT|ONEWAY_RIGHTFILTERSLEFT).',
          node.span,
        ),
      ],
    }
  }

  const [argA, argB, directionArg] = node.args
  const invalidMessage = 'CROSSFILTER arguments must be fully-qualified physical columns, e.g. Customers[CustomerID] — not a measure, expression, calculated result or literal.'
  const a = resolveQualifiedColumnArg(argA, ctx, 'CROSSFILTER_COLUMN_REQUIRED', invalidMessage)
  const b = resolveQualifiedColumnArg(argB, ctx, 'CROSSFILTER_COLUMN_REQUIRED', invalidMessage)
  const diagnostics = [...a.diagnostics, ...b.diagnostics]

  let directionKeyword: string | undefined
  if (directionArg.kind === 'TableReference' && CROSSFILTER_DIRECTION_KEYWORDS.has(directionArg.table.toUpperCase())) {
    directionKeyword = directionArg.table.toUpperCase()
  } else {
    diagnostics.push(
      diagnostic(
        'error',
        'CROSSFILTER_INVALID_DIRECTION',
        "CROSSFILTER's third argument must be one of NONE, BOTH, ONEWAY, ONEWAY_LEFTFILTERSRIGHT or ONEWAY_RIGHTFILTERSLEFT (unquoted).",
        directionArg.span,
      ),
    )
  }

  if (!a.resolved || !b.resolved || !directionKeyword) return { diagnostics }

  const found = resolveRelationshipArgumentPair(ctx, a, b, 'CROSSFILTER_RELATIONSHIP_NOT_FOUND', 'CROSSFILTER_AMBIGUOUS_RELATIONSHIP', node.span)
  diagnostics.push(...found.diagnostics)
  if (!found.relationship) return { diagnostics }

  const relationship = found.relationship

  if (directionKeyword === 'ONEWAY' && relationship.cardinality !== 'one-to-many') {
    diagnostics.push(
      diagnostic(
        'error',
        'CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY',
        'ONEWAY is only valid for a one-to-many relationship — use ONEWAY_LEFTFILTERSRIGHT/ONEWAY_RIGHTFILTERSLEFT for many-to-many, or BOTH/NONE for one-to-one.',
        directionArg.span,
      ),
    )
  }
  if ((directionKeyword === 'ONEWAY_LEFTFILTERSRIGHT' || directionKeyword === 'ONEWAY_RIGHTFILTERSLEFT') && relationship.cardinality !== 'many-to-many') {
    diagnostics.push(
      diagnostic(
        'error',
        'CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY',
        `${directionKeyword} is only valid for a many-to-many relationship.`,
        directionArg.span,
      ),
    )
  }
  if (relationship.cardinality === 'one-to-one' && directionKeyword !== 'NONE' && directionKeyword !== 'BOTH') {
    diagnostics.push(
      diagnostic('error', 'CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY', 'A one-to-one relationship only supports CROSSFILTER NONE or BOTH.', directionArg.span),
    )
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics }

  const siblings = directionKeyword === 'NONE' ? [] : siblingRelationships(ctx.model, relationship)
  const modelStateLabel = relationship.active ? `Active (${relationship.crossFilterDirection})` : 'Inactive'
  const requestedLabel = `${a.label} ↔ ${b.label} (${directionKeyword})`
  const label = `CROSSFILTER(${a.label}, ${b.label}, ${directionKeyword})`
  const conflictingLabels = siblings.map((s) => describeRelationshipLabel(ctx.model, ctx.datasets, s))
  const conflictingRelationshipIds = siblings.map((s) => s.id)

  if (directionKeyword === 'NONE') {
    return {
      modifier: {
        kind: 'RelationshipOverride',
        sourceFunction: 'CROSSFILTER',
        relationshipId: relationship.id,
        action: 'suppress',
        conflictingRelationshipIds: [],
        requestedLabel,
        modelStateLabel,
        conflictingLabels: [],
        label,
      },
      diagnostics,
    }
  }

  const directions: Exclude<CrossFilterDirection, 'both'>[] =
    directionKeyword === 'BOTH'
      ? ['left-to-right', 'right-to-left']
      : directionKeyword === 'ONEWAY'
        ? [relationship.oneSide === 'left' ? 'left-to-right' : 'right-to-left']
        : directionKeyword === 'ONEWAY_LEFTFILTERSRIGHT'
          ? ['left-to-right']
          : ['right-to-left']

  return {
    modifier: {
      kind: 'RelationshipOverride',
      sourceFunction: 'CROSSFILTER',
      relationshipId: relationship.id,
      action: 'direction',
      directions,
      conflictingRelationshipIds,
      requestedLabel,
      modelStateLabel,
      conflictingLabels,
      label,
    },
    diagnostics,
  }
}

/**
 * Binds `KEEPFILTERS(Table[Column] = value)` (Sprint 15, bounded — see
 * docs/CALCULATE.md "KEEPFILTERS"). Only a direct equality filter is
 * supported: binding delegates to `bindDirectBooleanFilter` and rejects
 * anything that doesn't collapse to a `ReplaceColumnFilter` (a comparison
 * or compound predicate) with a specific diagnostic rather than silently
 * misinterpreting it.
 */
function bindKeepFilters(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length !== 1) {
    return {
      diagnostics: [
        diagnostic('error', 'UNSUPPORTED_KEEPFILTERS_SHAPE', 'KEEPFILTERS expects exactly one argument, e.g. KEEPFILTERS(Table[Column] = value).', node.span),
      ],
    }
  }

  const result = bindDirectBooleanFilter(node.args[0], ctx)
  if (!result.modifier) return result
  if (result.modifier.kind !== 'ReplaceColumnFilter') {
    return {
      diagnostics: [
        ...result.diagnostics,
        diagnostic(
          'error',
          'UNSUPPORTED_KEEPFILTERS_SHAPE',
          'KEEPFILTERS is only supported around a direct equality filter in this release, e.g. KEEPFILTERS(Table[Column] = value) — not a comparison or compound predicate.',
          node.span,
        ),
      ],
    }
  }

  return { modifier: { ...result.modifier, keepFilters: true, label: `KEEPFILTERS(${result.modifier.label})` }, diagnostics: result.diagnostics }
}

/** Binds one CALCULATE filter argument — dispatches to REMOVEFILTERS/ALL/FILTER/time-intelligence/USERELATIONSHIP/CROSSFILTER/KEEPFILTERS, or tries it as a direct boolean filter expression (sprint brief §12-§21, §22-§34). */
function bindCalculateFilterArgument(argNode: Expression, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (argNode.kind === 'FunctionCall') {
    const name = argNode.name.toUpperCase()
    if (name === 'REMOVEFILTERS') return bindRemoveFilters(argNode, ctx)
    if (name === 'ALL') return bindAll(argNode, ctx)
    if (name === 'FILTER') return bindFilterFunction(argNode, ctx)
    if (name === 'USERELATIONSHIP') return bindUserRelationship(argNode, ctx)
    if (name === 'CROSSFILTER') return bindCrossFilter(argNode, ctx)
    if (name === 'KEEPFILTERS') return bindKeepFilters(argNode, ctx)
    if (TIME_INTELLIGENCE_FUNCTION_NAMES.has(name)) return bindTimeIntelligenceFilterModifier(argNode, ctx)
    if (UNSUPPORTED_CALCULATE_ADJACENT_FUNCTIONS.has(name)) {
      return {
        diagnostics: [
          diagnostic(
            'error',
            'UNSUPPORTED_FUNCTION',
            `"${argNode.name}" is not supported yet as a CALCULATE filter argument. Sprint 8 supports boolean comparisons, FILTER, REMOVEFILTERS and ALL.`,
            argNode.nameSpan,
          ),
        ],
      }
    }
    return {
      diagnostics: [
        diagnostic(
          'error',
          'CALCULATE_INVALID_FILTER_ARGUMENT',
          `"${argNode.name}(...)" is not a recognized CALCULATE filter argument.`,
          argNode.span,
        ),
      ],
    }
  }

  return bindDirectBooleanFilter(argNode, ctx)
}

/**
 * Binds `CALCULATE(expression, filter1, filter2, ...)` (sprint brief §12-§13,
 * §28). Filter arguments are optional — `CALCULATE(SUM(Sales[Revenue]))`
 * with none is valid (and must equal the plain expression's result, sprint
 * brief §53); only zero arguments total (`CALCULATE()`) is rejected.
 */
function bindCalculate(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length < 1) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_CALCULATE_ARITY',
          'CALCULATE expects at least an expression, e.g. CALCULATE([Total Revenue], Customers[Country] = "Spain").',
          node.span,
        ),
      ],
    }
  }

  const exprResult = bindMeasureNode(node.args[0], ctx)
  const diagnostics = [...exprResult.diagnostics]
  const modifiers: FilterModifier[] = []

  for (const argNode of node.args.slice(1)) {
    const modifierResult = bindCalculateFilterArgument(argNode, ctx)
    diagnostics.push(...modifierResult.diagnostics)
    if (modifierResult.modifier) modifiers.push(modifierResult.modifier)
  }

  if (!exprResult.bound || diagnostics.some((d) => d.severity === 'error')) return { diagnostics }

  return {
    bound: { kind: 'Calculate', expression: exprResult.bound, modifiers, label: 'CALCULATE(...)', span: node.span },
    diagnostics,
  }
}

/** Binds `IF(condition, whenTrue, [whenFalse])` in measure context (sprint brief §30-§31). Missing `whenFalse` evaluates to BLANK at runtime — no diagnostic needed for omitting it. */
function bindIfMeasure(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 2 && node.args.length !== 3) {
    return {
      diagnostics: [diagnostic('error', 'IF_INVALID_ARITY', 'IF expects IF(condition, valueIfTrue) or IF(condition, valueIfTrue, valueIfFalse).', node.span)],
    }
  }
  const condition = bindMeasureNode(node.args[0], ctx)
  const whenTrue = bindMeasureNode(node.args[1], ctx)
  const whenFalse = node.args[2] ? bindMeasureNode(node.args[2], ctx) : undefined
  const diagnostics = [...condition.diagnostics, ...whenTrue.diagnostics, ...(whenFalse?.diagnostics ?? [])]
  if (!condition.bound || !whenTrue.bound || (node.args[2] && !whenFalse?.bound)) return { diagnostics }
  return { bound: { kind: 'If', condition: condition.bound, whenTrue: whenTrue.bound, whenFalse: whenFalse?.bound, span: node.span }, diagnostics }
}

/** Binds `SWITCH(expression, value1, result1, ..., [default])`, including the canonical `SWITCH(TRUE(), cond1, r1, ...)` shape (sprint brief §34-§35). */
function bindSwitchMeasure(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length < 3) {
    return {
      diagnostics: [diagnostic('error', 'INVALID_SWITCH_ARGUMENT', 'SWITCH expects SWITCH(expression, value1, result1, ..., [default]).', node.span)],
    }
  }

  const exprResult = bindMeasureNode(node.args[0], ctx)
  const rest = node.args.slice(1)
  const hasDefault = rest.length % 2 === 1
  const pairArgs = hasDefault ? rest.slice(0, -1) : rest
  const defaultArg = hasDefault ? rest[rest.length - 1] : undefined

  const diagnostics: ExpressionDiagnostic[] = [...exprResult.diagnostics]
  const cases: BoundMeasureSwitchCase[] = []
  for (let i = 0; i < pairArgs.length; i += 2) {
    const value = bindMeasureNode(pairArgs[i], ctx)
    const result = bindMeasureNode(pairArgs[i + 1], ctx)
    diagnostics.push(...value.diagnostics, ...result.diagnostics)
    if (value.bound && result.bound) cases.push({ value: value.bound, result: result.bound })
  }
  const defaultResult = defaultArg ? bindMeasureNode(defaultArg, ctx) : undefined
  if (defaultResult) diagnostics.push(...defaultResult.diagnostics)

  if (!exprResult.bound || diagnostics.some((d) => d.severity === 'error')) return { diagnostics }

  return { bound: { kind: 'Switch', expression: exprResult.bound, cases, defaultResult: defaultResult?.bound, span: node.span }, diagnostics }
}

/** Binds `SELECTEDVALUE(Table[Column], [alternateResult])` (sprint brief §37-§39). */
function bindSelectedValue(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 1 && node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic('error', 'SELECTEDVALUE_INVALID_ARGUMENT', 'SELECTEDVALUE expects SELECTEDVALUE(Table[Column]) or SELECTEDVALUE(Table[Column], alternateResult).', node.span),
      ],
    }
  }

  const [columnArg, alternateArg] = node.args
  if (columnArg.kind !== 'ColumnReference' || columnArg.table === null) {
    return {
      diagnostics: [
        diagnostic('error', 'SELECTEDVALUE_INVALID_ARGUMENT', 'The first argument to SELECTEDVALUE must be a column, e.g. SELECTEDVALUE(Customers[Country]).', columnArg.span),
      ],
    }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, columnArg.table)
  if (!modelTable) {
    return { diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${columnArg.table}".`, columnArg.tableSpan ?? columnArg.span, { table: columnArg.table })] }
  }
  const resolved = resolveTableRef(ctx.datasets, modelTable)
  const column = resolved?.table.columns.find((c) => c.name.toLowerCase() === columnArg.column.toLowerCase())
  if (!resolved || !column) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${columnArg.column}" on "${columnArg.table}".`, columnArg.columnSpan, { table: columnArg.table, column: columnArg.column })],
    }
  }

  const alternate = alternateArg ? bindMeasureNode(alternateArg, ctx) : undefined
  if (alternateArg && !alternate?.bound) return { diagnostics: alternate?.diagnostics ?? [] }

  return {
    bound: {
      kind: 'SelectedValue',
      column: { datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id },
      modelTableId: modelTable.id,
      columnName: column.name,
      tableName: resolved.table.name,
      alternate: alternate?.bound,
      span: node.span,
    },
    diagnostics: alternate?.diagnostics ?? [],
  }
}

/** Binds `ISBLANK(expression)` (Sprint 15) — a scalar wrapper, valid anywhere any other measure expression is. */
function bindIsBlankMeasure(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 1) {
    return { diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'ISBLANK expects exactly one argument, e.g. ISBLANK([Total Revenue]).', node.span)] }
  }
  const operand = bindMeasureNode(node.args[0], ctx)
  if (!operand.bound) return { diagnostics: operand.diagnostics }
  return { bound: { kind: 'IsBlank', operand: operand.bound, span: node.span }, diagnostics: operand.diagnostics }
}

/**
 * Binds `HASONEVALUE(Table[Column])` (Sprint 15) — measure-only (needs
 * `FilterContext`): "exactly one distinct visible value" under the current
 * context. Binds identically to `bindSelectedValue` (arity 1, no
 * alternate); evaluation shares the same "distinct visible values"
 * computation, see `measureEvaluator.ts`.
 */
function bindHasOneValue(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 1) {
    return { diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'HASONEVALUE expects exactly one argument, e.g. HASONEVALUE(Customers[Country]).', node.span)] }
  }
  const [columnArg] = node.args
  if (columnArg.kind !== 'ColumnReference' || columnArg.table === null) {
    return {
      diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'HASONEVALUE expects a column, e.g. HASONEVALUE(Customers[Country]).', columnArg.span)],
    }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, columnArg.table)
  if (!modelTable) {
    return { diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${columnArg.table}".`, columnArg.tableSpan ?? columnArg.span, { table: columnArg.table })] }
  }
  const resolved = resolveTableRef(ctx.datasets, modelTable)
  const column = resolved?.table.columns.find((c) => c.name.toLowerCase() === columnArg.column.toLowerCase())
  if (!resolved || !column) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${columnArg.column}" on "${columnArg.table}".`, columnArg.columnSpan, { table: columnArg.table, column: columnArg.column })],
    }
  }

  return {
    bound: {
      kind: 'HasOneValue',
      column: { datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id },
      modelTableId: modelTable.id,
      columnName: column.name,
      tableName: resolved.table.name,
      span: node.span,
    },
    diagnostics: [],
  }
}

const TABLE_PRODUCING_FUNCTION_NAMES = new Set([
  'FILTER',
  'VALUES',
  'DISTINCT',
  'ALL',
  'ALLEXCEPT',
  'ALLSELECTED',
  'REMOVEFILTERS',
  'CALCULATETABLE',
  'SUMMARIZE',
  'ADDCOLUMNS',
  'SELECTCOLUMNS',
])

/**
 * Binds `VAR name1 = expr1 [VAR name2 = expr2 ...] RETURN body` in measure
 * context (Sprint 15, scalar-only — see docs/EXPRESSION_ENGINE.md
 * "Variables" and `binder.ts`'s `bindVarReturn`, which this mirrors).
 * `TABLE_PRODUCING_FUNCTION_NAMES` is a syntactic pre-check: measures (unlike
 * calculated columns) have genuine table-producing functions, so a
 * `VAR t = FILTER(...)`-shaped declaration must be rejected explicitly
 * rather than falling through to whatever generic error the function would
 * otherwise produce when bound as a plain scalar.
 */
function bindMeasureVarReturn(node: Extract<Expression, { kind: 'VarReturn' }>, ctx: MeasureBindContext): MeasureBindResult {
  const diagnostics: ExpressionDiagnostic[] = []
  const declaredNames = new Set<string>()
  const pendingVariables = new Set<string>()

  for (const decl of node.variables) {
    const lower = decl.name.toLowerCase()
    if (INVALID_VARIABLE_NAME.test(decl.name)) {
      diagnostics.push(diagnostic('error', 'INVALID_VARIABLE_NAME', `"${decl.name}" can't be used as a variable name.`, decl.nameSpan, { name: decl.name }))
      continue
    }
    if (declaredNames.has(lower)) {
      diagnostics.push(diagnostic('error', 'DUPLICATE_VARIABLE', `Variable "${decl.name}" is already declared in this VAR block.`, decl.nameSpan, { name: decl.name }))
      continue
    }
    declaredNames.add(lower)
    pendingVariables.add(lower)
  }

  let variables = ctx.variables ?? new Map<string, BoundMeasureExpression>()
  const boundDeclarations: BoundMeasureVariableDeclaration[] = []
  const resolvedNames = new Set<string>()

  for (const decl of node.variables) {
    const lower = decl.name.toLowerCase()
    if (resolvedNames.has(lower) || INVALID_VARIABLE_NAME.test(decl.name)) continue
    resolvedNames.add(lower)

    if (decl.value.kind === 'FunctionCall' && TABLE_PRODUCING_FUNCTION_NAMES.has(decl.value.name.toUpperCase())) {
      pendingVariables.delete(lower)
      diagnostics.push(
        diagnostic(
          'error',
          'TABLE_VARIABLE_NOT_SUPPORTED',
          `"${decl.name}" would hold a table, but Sprint 15 only supports scalar variables — ${decl.value.name}(...) can't be used as a VAR value.`,
          decl.value.span,
          { name: decl.name },
        ),
      )
      continue
    }

    // Still pending while binding its own value — a self-reference (`VAR x = x + 1`)
    // must read as forward-reference, not "unknown," so the delete happens after.
    const declResult = bindMeasureNode(decl.value, { ...ctx, variables, pendingVariables, inVariableScope: true })
    pendingVariables.delete(lower)
    diagnostics.push(...declResult.diagnostics)
    if (declResult.bound) {
      variables = new Map(variables)
      variables.set(lower, declResult.bound)
      boundDeclarations.push({ name: decl.name, value: declResult.bound })
    }
  }

  const bodyResult = bindMeasureNode(node.body, { ...ctx, variables, pendingVariables: new Set(), inVariableScope: true })
  diagnostics.push(...bodyResult.diagnostics)
  if (!bodyResult.bound) return { diagnostics }

  return { bound: { kind: 'VarReturn', variables: boundDeclarations, body: bodyResult.bound, span: node.span }, diagnostics }
}

/**
 * Binds `TOTALYTD(expression, Table[DateColumn])` (sprint brief §35-§36) as
 * the semantic equivalent of `CALCULATE(expression, DATESYTD(Table[DateColumn]))`
 * — literally the same `Calculate`/`DateTableReplace` bound shape, so
 * evaluation reuses `evaluateCalculate` with zero new runtime code (sprint
 * brief §35 "Do not duplicate YTD execution logic"). The first argument may
 * be any measure expression, not only a plain aggregation (sprint brief §36).
 */
function bindTotalYtd(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  if (node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'TOTALYTD_INVALID_ARGUMENT',
          'TOTALYTD expects exactly two arguments: TOTALYTD(expression, Table[DateColumn]).',
          node.span,
        ),
      ],
    }
  }

  const exprResult = bindMeasureNode(node.args[0], ctx)
  const { resolved, diagnostics: dateDiagnostics } = bindDateColumnArgument(node.args[1], ctx, 'TOTALYTD')
  const diagnostics = [...exprResult.diagnostics, ...dateDiagnostics]
  if (!exprResult.bound || !resolved) return { diagnostics }

  const boundTable: BoundTimeIntelligenceTable = {
    kind: 'TimeIntelligenceTable',
    operation: 'dates-ytd',
    modelTableId: resolved.modelTableId,
    dateColumn: resolved.dateColumn,
    dateColumnName: resolved.dateColumnName,
    tableName: resolved.tableName,
    label: `DATESYTD(${resolved.tableName}[${resolved.dateColumnName}])`,
    span: node.args[1].span,
  }
  const modifier: FilterModifier = { kind: 'DateTableReplace', bound: boundTable, label: boundTable.label }

  return {
    bound: { kind: 'Calculate', expression: exprResult.bound, modifiers: [modifier], label: 'TOTALYTD(...)', span: node.span },
    diagnostics,
  }
}

function bindMeasureFunctionCall(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  const name = node.name.toUpperCase()

  if (name === 'CALCULATE') {
    return bindCalculate(node, ctx)
  }

  if (UNSUPPORTED_CALCULATE_ADJACENT_FUNCTIONS.has(name)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" is not supported yet. Sprint 8 supports CALCULATE, FILTER, REMOVEFILTERS and ALL (as a CALCULATE filter modifier).`,
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'REMOVEFILTERS' || name === 'ALL') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" is only supported as a CALCULATE filter argument, e.g. CALCULATE([Total Revenue], ${node.name}(...)).`,
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'FILTER') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          'FILTER is only supported as a CALCULATE filter argument or as the table argument to COUNTROWS/an iterator function (SUMX, AVERAGEX, MINX, MAXX, COUNTX), e.g. CALCULATE([Total Revenue], FILTER(...)) or SUMX(FILTER(...), ...).',
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'USERELATIONSHIP') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'USERELATIONSHIP_INVALID_CONTEXT',
          'USERELATIONSHIP is only supported as a CALCULATE filter argument, e.g. CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipDate], Calendar[Date])). It does not return a value on its own.',
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'CROSSFILTER') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'CROSSFILTER_INVALID_CONTEXT',
          'CROSSFILTER is only supported as a CALCULATE filter argument, e.g. CALCULATE([Total Revenue], CROSSFILTER(Customers[CustomerID], Sales[CustomerID], BOTH)). It does not return a value on its own.',
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'VALUES' || name === 'DISTINCT') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" is only supported as the table argument to COUNTROWS or an iterator function, e.g. COUNTROWS(${node.name}(Customers[Country])) or SUMX(${node.name}(Products[Category]), [Total Revenue]).`,
          node.nameSpan,
        ),
      ],
    }
  }

  if (TIME_INTELLIGENCE_FUNCTION_NAMES.has(name)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" produces a table of dates — it's only supported as a CALCULATE filter argument or the table argument to COUNTROWS, e.g. CALCULATE([Total Revenue], ${node.name}(...)) or COUNTROWS(${node.name}(...)).`,
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'TOTALYTD') return bindTotalYtd(node, ctx)

  if (name === 'IF') return bindIfMeasure(node, ctx)
  if (name === 'SWITCH') return bindSwitchMeasure(node, ctx)
  if (name === 'SELECTEDVALUE') return bindSelectedValue(node, ctx)
  if (name === 'ISBLANK') return bindIsBlankMeasure(node, ctx)
  if (name === 'HASONEVALUE') return bindHasOneValue(node, ctx)
  if (name === 'BLANK') {
    if (node.args.length !== 0) {
      return { diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'BLANK() takes no arguments.', node.span)] }
    }
    return { bound: { kind: 'Blank', span: node.span }, diagnostics: [] }
  }
  if (isIteratorFunctionName(name)) {
    return bindIteratorCall(name, node, ctx)
  }

  if (name === 'RELATED') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'RELATED_REQUIRES_ROW_CONTEXT',
          'RELATED requires row context. Measures are evaluated in filter context — use an aggregation over the related table instead.',
          node.nameSpan,
        ),
      ],
    }
  }

  if (name in AGGREGATION_FUNCTIONS) {
    return bindAggregationCall(name, AGGREGATION_FUNCTIONS[name], node, ctx)
  }

  if (name === 'COUNTROWS') {
    return bindCountRows(node, ctx)
  }

  if (name === 'DIVIDE') {
    return bindDivide(node, ctx)
  }

  return {
    diagnostics: [
      diagnostic(
        'error',
        'UNSUPPORTED_FUNCTION',
        `"${node.name}" is not supported in measures. Sprint 4 measures support SUM, AVERAGE, MIN, MAX, COUNT, COUNTROWS, DISTINCTCOUNT, DIVIDE and measure references.`,
        node.nameSpan,
      ),
    ],
  }
}

function bindMeasureNode(node: Expression, ctx: MeasureBindContext): MeasureBindResult {
  switch (node.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return { bound: { kind: 'Literal', value: node.value, span: node.span }, diagnostics: [] }

    case 'ColumnReference': {
      if (node.table === null) {
        return bindMeasureReference(node.column, node.span, ctx)
      }
      return {
        diagnostics: [
          diagnostic(
            'error',
            'COLUMN_REQUIRES_AGGREGATION',
            `"${node.table}[${node.column}]" can't be used directly in a measure. Measures do not have row context — wrap it in an aggregation such as SUM(${node.table}[${node.column}]).`,
            node.span,
            { table: node.table, column: node.column },
          ),
        ],
      }
    }

    case 'UnaryExpression': {
      const operand = bindMeasureNode(node.operand, ctx)
      if (!operand.bound) return { diagnostics: operand.diagnostics }
      return {
        bound: { kind: 'Unary', operator: node.operator, operand: operand.bound, span: node.span },
        diagnostics: operand.diagnostics,
      }
    }

    case 'BinaryExpression': {
      const left = bindMeasureNode(node.left, ctx)
      const right = bindMeasureNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Binary', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }

    case 'ComparisonExpression': {
      const left = bindMeasureNode(node.left, ctx)
      const right = bindMeasureNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Comparison', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }

    case 'LogicalExpression': {
      const left = bindMeasureNode(node.left, ctx)
      const right = bindMeasureNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Logical', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }

    case 'FunctionCall':
      return bindMeasureFunctionCall(node, ctx)

    case 'TableReference': {
      const lower = node.table.toLowerCase()
      const variable = ctx.variables?.get(lower)
      if (variable) {
        return { bound: { kind: 'VariableReference', name: node.table, span: node.span }, diagnostics: [] }
      }
      if (ctx.pendingVariables?.has(lower)) {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'FORWARD_VARIABLE_REFERENCE',
              `"${node.table}" can't be used here — a VAR can only reference variables declared earlier in the same VAR block, not itself or one declared later.`,
              node.span,
              { name: node.table },
            ),
          ],
        }
      }
      if (ctx.inVariableScope) {
        const modelTable = findModelTableByName(ctx.model, ctx.datasets, node.table)
        if (modelTable) {
          return {
            diagnostics: [
              diagnostic(
                'error',
                'TABLE_VARIABLE_NOT_SUPPORTED',
                `"${node.table}" is a table — table-valued variables aren't supported yet. Only scalar VAR is supported this release.`,
                node.span,
                { table: node.table },
              ),
            ],
          }
        }
        return { diagnostics: [diagnostic('error', 'UNKNOWN_VARIABLE', `Unknown variable "${node.table}".`, node.span, { name: node.table })] }
      }
      return {
        diagnostics: [
          diagnostic(
            'error',
            'BARE_TABLE_REFERENCE',
            `"${node.table}" is a table, not a value here. Use COUNTROWS(${node.table}) to count its rows.`,
            node.span,
            { table: node.table },
          ),
        ],
      }
    }

    case 'VarReturn':
      return bindMeasureVarReturn(node, ctx)

    default:
      return { diagnostics: [] }
  }
}

/**
 * Binds a parsed expression as a Measure — the filter-context sibling of
 * `bind()` in `binder.ts`. No `currentModelTableId` is needed: a measure's
 * home table only decides where it's displayed (see `Measure.homeModelTableId`
 * in domain/model.ts), never what it can read.
 */
export function bindMeasureExpression(expression: Expression, ctx: MeasureBindContext): MeasureBindResult {
  return bindMeasureNode(expression, {
    model: ctx.model,
    datasets: ctx.datasets,
    variables: ctx.variables ?? new Map(),
    pendingVariables: ctx.pendingVariables ?? new Set(),
    inVariableScope: ctx.inVariableScope ?? false,
  })
}
