import type { Dataset } from '../../domain/data'
import type { ColumnRef, SemanticModel } from '../../domain/model'
import { findModelTableByName } from '../../expression/binder'
import type { Expression, FunctionCallNode } from '../../expression/ast'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { resolveRelatedRelationship, type RelatedFailureCode } from '../../expression/relatedLookup'
import { resolveLogicalColumn } from '../measure/logicalColumn'
import { bindTableExpression } from '../tableExpression/tableExpressionBinder'
import { resolveColumnRef, resolveTableRef } from '../model/modelRuntime'
import type { BoundIteratorCall, BoundIteratorExpression, BoundIteratorSwitchCase, IteratorFunction } from './iteratorTypes'

export interface IteratorBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
}

export interface IteratorBindResult {
  bound?: BoundIteratorCall
  diagnostics: ExpressionDiagnostic[]
}

interface RowBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  rowKind: 'model' | 'value'
  modelTableId: string
  tableName: string
  sourceColumn?: ColumnRef
  sourceColumnName?: string
}

interface RowBindResult {
  bound?: BoundIteratorExpression
  diagnostics: ExpressionDiagnostic[]
}

function bindMeasureReferenceInRow(name: string, span: Expression['span'], ctx: RowBindContext): RowBindResult {
  const target = ctx.model.measures.find((m) => m.name.toLowerCase() === name.toLowerCase())
  if (!target) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_MEASURE', `Unknown measure "${name}". It isn't defined in this model.`, span, { measure: name })],
    }
  }
  return { bound: { kind: 'MeasureReference', measureId: target.id, measureName: target.name, span }, diagnostics: [] }
}

const RELATED_MESSAGES: Record<RelatedFailureCode, (current: string, target: string) => string> = {
  RELATED_NO_RELATIONSHIP: (current, target) => `There is no relationship between "${current}" and "${target}" in this model.`,
  RELATED_INACTIVE_RELATIONSHIP: (current, target) =>
    `The relationship between "${current}" and "${target}" exists but is currently inactive.`,
  RELATED_WRONG_DIRECTION: (current, target) =>
    `"${target}" is on the "many" side relative to "${current}" — RELATED can only look up from the many side to the one side.`,
  RELATED_AMBIGUOUS_RELATIONSHIP: (current, target) =>
    `More than one active relationship connects "${current}" to "${target}", so RELATED doesn't know which one to use.`,
}

function bindRelatedInRow(node: FunctionCallNode, ctx: RowBindContext): RowBindResult {
  if (ctx.rowKind === 'value') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'ITERATOR_ROW_SCOPE_VIOLATION',
          'RELATED requires a physical row — a VALUES/DISTINCT virtual row only carries one column value, not a full row to traverse relationships from.',
          node.span,
        ),
      ],
    }
  }

  const [arg] = node.args
  if (node.args.length !== 1 || arg.kind !== 'ColumnReference' || arg.table === null) {
    return {
      diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'RELATED expects exactly one argument in the form Table[Column].', node.span)],
    }
  }

  const targetModelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
  if (!targetModelTable) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}". It isn't part of this model.`, arg.tableSpan ?? arg.span, { table: arg.table })],
    }
  }

  const targetResolved = resolveTableRef(ctx.datasets, targetModelTable)
  const column = targetResolved?.table.columns.find((c) => c.name.toLowerCase() === arg.column.toLowerCase())
  if (!targetResolved || !column) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${arg.column}" on "${arg.table}".`, arg.columnSpan, { table: arg.table, column: arg.column })],
    }
  }

  const related = resolveRelatedRelationship(ctx.model, ctx.modelTableId, targetModelTable.id)
  if ('code' in related) {
    return {
      diagnostics: [diagnostic('error', related.code, RELATED_MESSAGES[related.code](ctx.tableName, targetResolved.table.name), node.span)],
    }
  }

  const manyColumn = resolveColumnRef(ctx.datasets, related.relationship.many)
  if (!manyColumn) {
    return { diagnostics: [diagnostic('error', 'RELATED_NO_RELATIONSHIP', 'The relationship\'s foreign-key column could not be resolved.', node.span)] }
  }

  return {
    bound: {
      kind: 'Related',
      relationshipId: related.relationship.id,
      targetColumnRef: { datasetId: targetResolved.dataset.id, tableId: targetResolved.table.id, columnId: column.id },
      manyColumnName: manyColumn.column.name,
      targetColumnName: column.name,
      label: `RELATED(${targetResolved.table.name}[${column.name}])`,
      span: node.span,
    },
    diagnostics: [],
  }
}

function bindIf(node: FunctionCallNode, ctx: RowBindContext): RowBindResult {
  if (node.args.length !== 2 && node.args.length !== 3) {
    return {
      diagnostics: [diagnostic('error', 'IF_INVALID_ARITY', 'IF expects IF(condition, valueIfTrue) or IF(condition, valueIfTrue, valueIfFalse).', node.span)],
    }
  }
  const condition = bindIteratorRowExpression(node.args[0], ctx)
  const whenTrue = bindIteratorRowExpression(node.args[1], ctx)
  const whenFalse = node.args[2] ? bindIteratorRowExpression(node.args[2], ctx) : undefined
  const diagnostics = [...condition.diagnostics, ...whenTrue.diagnostics, ...(whenFalse?.diagnostics ?? [])]
  if (!condition.bound || !whenTrue.bound || (node.args[2] && !whenFalse?.bound)) return { diagnostics }
  return { bound: { kind: 'If', condition: condition.bound, whenTrue: whenTrue.bound, whenFalse: whenFalse?.bound, span: node.span }, diagnostics }
}

function bindSwitch(node: FunctionCallNode, ctx: RowBindContext): RowBindResult {
  if (node.args.length < 3) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_SWITCH_ARGUMENT', 'SWITCH expects SWITCH(expression, value1, result1, ..., [default]).', node.span),
      ],
    }
  }

  const exprResult = bindIteratorRowExpression(node.args[0], ctx)
  const rest = node.args.slice(1)
  const hasDefault = rest.length % 2 === 1
  const pairArgs = hasDefault ? rest.slice(0, -1) : rest
  const defaultArg = hasDefault ? rest[rest.length - 1] : undefined

  const diagnostics: ExpressionDiagnostic[] = [...exprResult.diagnostics]
  const cases: BoundIteratorSwitchCase[] = []
  for (let i = 0; i < pairArgs.length; i += 2) {
    const value = bindIteratorRowExpression(pairArgs[i], ctx)
    const result = bindIteratorRowExpression(pairArgs[i + 1], ctx)
    diagnostics.push(...value.diagnostics, ...result.diagnostics)
    if (value.bound && result.bound) cases.push({ value: value.bound, result: result.bound })
  }
  const defaultResult = defaultArg ? bindIteratorRowExpression(defaultArg, ctx) : undefined
  if (defaultResult) diagnostics.push(...defaultResult.diagnostics)

  if (!exprResult.bound || diagnostics.some((d) => d.severity === 'error')) return { diagnostics }

  return {
    bound: { kind: 'Switch', expression: exprResult.bound, cases, defaultResult: defaultResult?.bound, span: node.span },
    diagnostics,
  }
}

function bindIteratorFunctionCall(node: FunctionCallNode, ctx: RowBindContext): RowBindResult {
  const name = node.name.toUpperCase()
  if (name === 'RELATED') return bindRelatedInRow(node, ctx)
  if (name === 'IF') return bindIf(node, ctx)
  if (name === 'SWITCH') return bindSwitch(node, ctx)
  if (name === 'BLANK') {
    if (node.args.length !== 0) {
      return { diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'BLANK() takes no arguments.', node.span)] }
    }
    return { bound: { kind: 'Blank', span: node.span }, diagnostics: [] }
  }
  return {
    diagnostics: [
      diagnostic('error', 'UNSUPPORTED_FUNCTION', `"${node.name}" is not supported inside an iterator row expression.`, node.nameSpan),
    ],
  }
}

/**
 * Binds one iterator "row expression" argument — sprint brief §18
 * ("literals, arithmetic, comparison, logical operators, column reads,
 * RELATED, IF, SWITCH, BLANK, measure references"). Column references are
 * scoped to the iterator's own table (`ctx.modelTableId`/`ctx.sourceColumn`)
 * — no implicit relationship traversal (use RELATED). Bracket-only `[Name]`
 * always means a measure reference here, never a row column (sprint brief
 * §19), matching the rest of measure-mode grammar.
 */
export function bindIteratorRowExpression(expr: Expression, ctx: RowBindContext): RowBindResult {
  switch (expr.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return { bound: { kind: 'Literal', value: expr.value, span: expr.span }, diagnostics: [] }

    case 'ColumnReference': {
      if (expr.table === null) return bindMeasureReferenceInRow(expr.column, expr.span, ctx)

      const targetModelTable = findModelTableByName(ctx.model, ctx.datasets, expr.table)
      if (!targetModelTable) {
        return {
          diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${expr.table}". It isn't part of this model.`, expr.tableSpan ?? expr.span, { table: expr.table })],
        }
      }

      if (targetModelTable.id !== ctx.modelTableId) {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'ITERATOR_ROW_SCOPE_VIOLATION',
              `"${expr.table}[${expr.column}]" is outside the current iterator row context. This row expression can only read "${ctx.tableName}"'s own columns — use RELATED(${expr.table}[${expr.column}]) to reach another table.`,
              expr.span,
            ),
          ],
        }
      }

      if (ctx.rowKind === 'value') {
        if (!ctx.sourceColumnName || expr.column.toLowerCase() !== ctx.sourceColumnName.toLowerCase()) {
          return {
            diagnostics: [
              diagnostic(
                'error',
                'ITERATOR_ROW_SCOPE_VIOLATION',
                `A VALUES/DISTINCT virtual row only carries "${ctx.tableName}[${ctx.sourceColumnName}]" — "${expr.column}" isn't part of it.`,
                expr.span,
              ),
            ],
          }
        }
        const column = resolveLogicalColumn(ctx.model, ctx.datasets, ctx.modelTableId, expr.column)
        if (!column) {
          return { diagnostics: [diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${expr.column}" on "${ctx.tableName}".`, expr.columnSpan)] }
        }
        return { bound: { kind: 'Column', column, label: `${ctx.tableName}[${column.name}]`, span: expr.span }, diagnostics: [] }
      }

      const column = resolveLogicalColumn(ctx.model, ctx.datasets, ctx.modelTableId, expr.column)
      if (!column) {
        return {
          diagnostics: [diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${expr.column}" on "${ctx.tableName}".`, expr.columnSpan, { table: ctx.tableName, column: expr.column })],
        }
      }
      return { bound: { kind: 'Column', column, label: `${ctx.tableName}[${column.name}]`, span: expr.span }, diagnostics: [] }
    }

    case 'UnaryExpression': {
      const operand = bindIteratorRowExpression(expr.operand, ctx)
      if (!operand.bound) return { diagnostics: operand.diagnostics }
      return { bound: { kind: 'Unary', operator: expr.operator, operand: operand.bound, span: expr.span }, diagnostics: operand.diagnostics }
    }

    case 'BinaryExpression': {
      const left = bindIteratorRowExpression(expr.left, ctx)
      const right = bindIteratorRowExpression(expr.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Binary', operator: expr.operator, left: left.bound, right: right.bound, span: expr.span }, diagnostics }
    }

    case 'ComparisonExpression': {
      const left = bindIteratorRowExpression(expr.left, ctx)
      const right = bindIteratorRowExpression(expr.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Comparison', operator: expr.operator, left: left.bound, right: right.bound, span: expr.span }, diagnostics }
    }

    case 'LogicalExpression': {
      const left = bindIteratorRowExpression(expr.left, ctx)
      const right = bindIteratorRowExpression(expr.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Logical', operator: expr.operator, left: left.bound, right: right.bound, span: expr.span }, diagnostics }
    }

    case 'FunctionCall':
      return bindIteratorFunctionCall(expr, ctx)

    case 'TableReference':
      return {
        diagnostics: [diagnostic('error', 'BARE_TABLE_REFERENCE', `"${expr.table}" is a table, not a value here.`, expr.span, { table: expr.table })],
      }

    default:
      return { diagnostics: [] }
  }
}

const ITERATOR_FUNCTION_NAMES: Record<string, IteratorFunction> = {
  SUMX: 'SUMX',
  AVERAGEX: 'AVERAGEX',
  MINX: 'MINX',
  MAXX: 'MAXX',
  COUNTX: 'COUNTX',
}

export function isIteratorFunctionName(name: string): boolean {
  return name.toUpperCase() in ITERATOR_FUNCTION_NAMES
}

function tableDisplayName(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string): string {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  return (modelTable && resolveTableRef(datasets, modelTable)?.table.name) ?? modelTableId
}

const TABLE_SHAPED_FUNCTIONS = new Set(['FILTER', 'VALUES', 'DISTINCT'])

/**
 * Binds `SUMX(table, rowExpression)` (and AVERAGEX/MINX/MAXX/COUNTX) — sprint
 * brief §15-§21. `MAXX`/`MINX`'s optional third (`variant`) argument isn't
 * implemented (sprint brief §24) and is reported as an arity error rather
 * than silently ignored.
 */
export function bindIteratorCall(name: string, node: FunctionCallNode, ctx: IteratorBindContext): IteratorBindResult {
  const fn = ITERATOR_FUNCTION_NAMES[name.toUpperCase()]
  if (node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_ITERATOR_ARGUMENT',
          `${fn} expects exactly two arguments: ${fn}(table, expression)${node.args.length > 2 ? ' — the optional variant argument is not supported yet' : ''}.`,
          node.span,
        ),
      ],
    }
  }

  const [tableArg, rowArg] = node.args
  const isTableShaped = tableArg.kind === 'TableReference' || (tableArg.kind === 'FunctionCall' && TABLE_SHAPED_FUNCTIONS.has(tableArg.name.toUpperCase()))
  if (!isTableShaped) {
    return {
      diagnostics: [
        diagnostic('error', 'ITERATOR_TABLE_REQUIRED', `The first argument to ${fn} must be a table — a model table, FILTER(...), VALUES(...) or DISTINCT(...).`, tableArg.span),
      ],
    }
  }

  const tableResult = bindTableExpression(tableArg, ctx)
  if (!tableResult.bound) return { diagnostics: tableResult.diagnostics }

  const rowCtx: RowBindContext =
    tableResult.bound.kind === 'ValuesTable' || tableResult.bound.kind === 'DistinctTable'
      ? {
          model: ctx.model,
          datasets: ctx.datasets,
          rowKind: 'value',
          modelTableId: tableResult.bound.modelTableId,
          tableName: tableResult.bound.tableName,
          sourceColumn: tableResult.bound.column,
          sourceColumnName: tableResult.bound.columnName,
        }
      : {
          model: ctx.model,
          datasets: ctx.datasets,
          rowKind: 'model',
          modelTableId: tableResult.bound.modelTableId,
          tableName: tableDisplayName(ctx.model, ctx.datasets, tableResult.bound.modelTableId),
        }

  const rowResult = bindIteratorRowExpression(rowArg, rowCtx)
  const diagnostics = [...tableResult.diagnostics, ...rowResult.diagnostics]
  if (!rowResult.bound) return { diagnostics }

  const tableLabel = tableResult.bound.kind === 'BaseTable' ? tableResult.bound.tableName : rowCtx.tableName
  return {
    bound: {
      kind: 'Iterator',
      function: fn,
      table: tableResult.bound,
      rowExpression: rowResult.bound,
      rowKind: rowCtx.rowKind,
      sourceColumn: rowCtx.sourceColumn,
      label: `${fn}(${tableLabel}, ...)`,
      span: node.span,
    },
    diagnostics,
  }
}
