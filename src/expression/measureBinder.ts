import type { DataType, Dataset } from '../domain/data'
import type { ColumnRef, SemanticModel } from '../domain/model'
import { bindPredicateExpression, dedupeColumnRefs, describeBoundPredicate, type BoundPredicateNode } from '../runtime/measure/booleanFilter'
import type { FilterModifier } from '../runtime/measure/contextModifier'
import { resolveLogicalColumn, type LogicalColumnRef } from '../runtime/measure/logicalColumn'
import { resolveTableRef } from '../runtime/model/modelRuntime'
import type { BinaryOperator, ComparisonOperator, Expression, FunctionCallNode, LogicalOperator, SourceSpan, UnaryOperator } from './ast'
import { findModelTableByName } from './binder'
import { diagnostic, type ExpressionDiagnostic } from './diagnostics'

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
  modelTableId: string
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

export interface MeasureBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
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

function bindCountRows(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  const [arg] = node.args
  if (node.args.length !== 1 || arg.kind !== 'TableReference') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_AGGREGATION_ARGUMENT',
          'COUNTROWS expects exactly one table argument, e.g. COUNTROWS(Sales).',
          node.span,
        ),
      ],
    }
  }

  const targetModelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
  if (!targetModelTable) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}". It isn't part of this model.`, arg.span, {
          table: arg.table,
        }),
      ],
    }
  }

  return {
    bound: { kind: 'CountRows', modelTableId: targetModelTable.id, label: `COUNTROWS(${arg.table})`, span: node.span },
    diagnostics: [],
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
  'USERELATIONSHIP',
  'CROSSFILTER',
])

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

/** Binds `FILTER(Table, predicate)` (sprint brief §17-§20). Always table-wide: it replaces every existing filter on `Table` (docs/CALCULATE.md). */
function bindFilterFunction(node: FunctionCallNode, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'FILTER expects exactly two arguments: FILTER(Table, predicate).', node.span),
      ],
    }
  }

  const [tableArg, predicateArg] = node.args
  if (tableArg.kind !== 'TableReference') {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'The first argument to FILTER must be a table, e.g. FILTER(Products, ...).', tableArg.span),
      ],
    }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, tableArg.table)
  if (!modelTable) {
    return { diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${tableArg.table}".`, tableArg.span, { table: tableArg.table })] }
  }

  const tableName = tableDisplayName(ctx, modelTable.id)
  const result = bindPredicateExpression(predicateArg, ctx.model, ctx.datasets, { modelTableId: modelTable.id, tableName })
  if (!result.bound) return { diagnostics: result.diagnostics }

  return {
    modifier: {
      kind: 'PredicateFilter',
      modelTableId: modelTable.id,
      referencedColumns: dedupeColumnRefs(result.referencedColumns),
      predicate: result.bound,
      label: `FILTER(${tableName}, ${describeBoundPredicate(result.bound)})`,
      tableWide: true,
    },
    diagnostics: result.diagnostics,
  }
}

/** Binds one CALCULATE filter argument — dispatches to REMOVEFILTERS/ALL/FILTER, or tries it as a direct boolean filter expression (sprint brief §12-§21). */
function bindCalculateFilterArgument(argNode: Expression, ctx: MeasureBindContext): { modifier?: FilterModifier; diagnostics: ExpressionDiagnostic[] } {
  if (argNode.kind === 'FunctionCall') {
    const name = argNode.name.toUpperCase()
    if (name === 'REMOVEFILTERS') return bindRemoveFilters(argNode, ctx)
    if (name === 'ALL') return bindAll(argNode, ctx)
    if (name === 'FILTER') return bindFilterFunction(argNode, ctx)
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

  if (name === 'FILTER' || name === 'REMOVEFILTERS' || name === 'ALL') {
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

    case 'TableReference':
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
  return bindMeasureNode(expression, ctx)
}
