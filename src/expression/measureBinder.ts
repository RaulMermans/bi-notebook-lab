import type { DataType, Dataset } from '../domain/data'
import type { SemanticModel } from '../domain/model'
import { resolveLogicalColumn, type LogicalColumnRef } from '../runtime/measure/logicalColumn'
import { resolveTableRef } from '../runtime/model/modelRuntime'
import type { BinaryOperator, Expression, FunctionCallNode, SourceSpan, UnaryOperator } from './ast'
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

export type BoundMeasureExpression =
  | BoundMeasureLiteral
  | BoundMeasureUnary
  | BoundMeasureBinary
  | BoundMeasureReference
  | BoundAggregation
  | BoundCountRows
  | BoundDivide

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

function bindMeasureFunctionCall(node: FunctionCallNode, ctx: MeasureBindContext): MeasureBindResult {
  const name = node.name.toUpperCase()

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
