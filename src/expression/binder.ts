import type { DataType, Dataset } from '../domain/data'
import type { ColumnRef, ModelTable, SemanticModel } from '../domain/model'
import { resolveTableRef, type ResolvedTableRef } from '../runtime/model/modelRuntime'
import type { ComparisonOperator, LogicalOperator } from './ast'
import type { BinaryOperator, ColumnReferenceNode, Expression, FunctionCallNode, SourceSpan, UnaryOperator } from './ast'
import { diagnostic, type ExpressionDiagnostic } from './diagnostics'
import { resolveRelatedRelationship, type RelatedFailureCode } from './relatedLookup'

export interface BoundLiteral {
  kind: 'Literal'
  value: number | string | boolean
  span: SourceSpan
}

export interface BoundColumnReference {
  kind: 'ColumnReference'
  ref: ColumnRef
  dataType: DataType
  /** Table/column names as written, for trace labels. */
  label: string
  span: SourceSpan
}

export interface BoundUnary {
  kind: 'Unary'
  operator: UnaryOperator
  operand: BoundExpression
  span: SourceSpan
}

export interface BoundBinary {
  kind: 'Binary'
  operator: BinaryOperator
  left: BoundExpression
  right: BoundExpression
  span: SourceSpan
}

export interface BoundRelated {
  kind: 'Related'
  relationshipId: string
  targetColumnRef: ColumnRef
  dataType: DataType
  label: string
  span: SourceSpan
}

/**
 * Sprint 9 additions (sprint brief §32-§36): calculated columns gain
 * comparison/logical operators and `IF`/`SWITCH`/`BLANK` — real DAX allows
 * conditional row-level logic in calculated columns (no context transition
 * needed, unlike CALCULATE). Scalar semantics are shared with measures via
 * `compareScalarValues` (`runtime/measure/booleanFilter.ts`), not
 * reimplemented (sprint brief §33).
 */
export interface BoundComparison {
  kind: 'Comparison'
  operator: ComparisonOperator
  left: BoundExpression
  right: BoundExpression
  span: SourceSpan
}

export interface BoundLogical {
  kind: 'Logical'
  operator: LogicalOperator
  left: BoundExpression
  right: BoundExpression
  span: SourceSpan
}

export interface BoundIf {
  kind: 'If'
  condition: BoundExpression
  whenTrue: BoundExpression
  whenFalse?: BoundExpression
  span: SourceSpan
}

export interface BoundSwitchCase {
  value: BoundExpression
  result: BoundExpression
}

export interface BoundSwitch {
  kind: 'Switch'
  expression: BoundExpression
  cases: BoundSwitchCase[]
  defaultResult?: BoundExpression
  span: SourceSpan
}

export interface BoundBlank {
  kind: 'Blank'
  span: SourceSpan
}

export type BoundExpression =
  | BoundLiteral
  | BoundColumnReference
  | BoundUnary
  | BoundBinary
  | BoundRelated
  | BoundComparison
  | BoundLogical
  | BoundIf
  | BoundSwitch
  | BoundBlank

export interface BindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  /** The calculated column's own table — the only table plain `Table[Column]`/`[Column]` refs may read from. */
  currentModelTableId: string
}

export interface BindResult {
  bound?: BoundExpression
  diagnostics: ExpressionDiagnostic[]
}

interface ResolvedBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  currentTable: ModelTable
  currentResolved: ResolvedTableRef
}

export function findModelTableByName(model: SemanticModel, datasets: Record<string, Dataset>, name: string): ModelTable | undefined {
  const lower = name.toLowerCase()
  return model.tables.find((t) => resolveTableRef(datasets, t)?.table.name.toLowerCase() === lower)
}

function bindColumnReference(node: ColumnReferenceNode, ctx: ResolvedBindContext): BindResult {
  const isCurrentTable = node.table === null || node.table.toLowerCase() === ctx.currentResolved.table.name.toLowerCase()

  if (!isCurrentTable) {
    const found = findModelTableByName(ctx.model, ctx.datasets, node.table as string)
    if (!found) {
      return {
        diagnostics: [
          diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${node.table}". It isn't part of this model.`, node.tableSpan ?? node.span, {
            table: node.table,
          }),
        ],
      }
    }
    return {
      diagnostics: [
        diagnostic(
          'error',
          'COLUMN_OUTSIDE_ROW_CONTEXT',
          `"${node.table}[${node.column}]" is outside the current row context. A calculated column on "${ctx.currentResolved.table.name}" can only read "${ctx.currentResolved.table.name}"'s own columns directly — use RELATED(${node.table}[${node.column}]) to reach another table through a relationship.`,
          node.span,
          { table: node.table, column: node.column },
        ),
      ],
    }
  }

  const column = ctx.currentResolved.table.columns.find((c) => c.name.toLowerCase() === node.column.toLowerCase())
  if (!column) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNKNOWN_COLUMN',
          `Unknown column "${node.column}" on "${ctx.currentResolved.table.name}".`,
          node.columnSpan,
          { table: ctx.currentResolved.table.name, column: node.column },
        ),
      ],
    }
  }

  return {
    bound: {
      kind: 'ColumnReference',
      ref: { datasetId: ctx.currentResolved.dataset.id, tableId: ctx.currentResolved.table.id, columnId: column.id },
      dataType: column.dataType,
      label: `${ctx.currentResolved.table.name}[${column.name}]`,
      span: node.span,
    },
    diagnostics: [],
  }
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

/**
 * Sprint 8's CALCULATE is bound in **measure context only** — see
 * `measureBinder.ts`'s `bindCalculate`. Using it (or a CALCULATE filter
 * modifier) inside a calculated column would require row-context ->
 * filter-context transition, which sprint brief §34 explicitly defers rather
 * than implement a "fake partial" version of. Reported with a dedicated code
 * so the message is precise instead of the generic "only RELATED" one below.
 */
const CALCULATE_CONTEXT_TRANSITION_FUNCTIONS = new Set(['CALCULATE', 'FILTER', 'REMOVEFILTERS', 'ALL'])

function bindIf(node: FunctionCallNode, ctx: ResolvedBindContext): BindResult {
  if (node.args.length !== 2 && node.args.length !== 3) {
    return {
      diagnostics: [diagnostic('error', 'IF_INVALID_ARITY', 'IF expects IF(condition, valueIfTrue) or IF(condition, valueIfTrue, valueIfFalse).', node.span)],
    }
  }
  const condition = bindNode(node.args[0], ctx)
  const whenTrue = bindNode(node.args[1], ctx)
  const whenFalse = node.args[2] ? bindNode(node.args[2], ctx) : undefined
  const diagnostics = [...condition.diagnostics, ...whenTrue.diagnostics, ...(whenFalse?.diagnostics ?? [])]
  if (!condition.bound || !whenTrue.bound || (node.args[2] && !whenFalse?.bound)) return { diagnostics }
  return { bound: { kind: 'If', condition: condition.bound, whenTrue: whenTrue.bound, whenFalse: whenFalse?.bound, span: node.span }, diagnostics }
}

function bindSwitch(node: FunctionCallNode, ctx: ResolvedBindContext): BindResult {
  if (node.args.length < 3) {
    return {
      diagnostics: [diagnostic('error', 'INVALID_SWITCH_ARGUMENT', 'SWITCH expects SWITCH(expression, value1, result1, ..., [default]).', node.span)],
    }
  }
  const exprResult = bindNode(node.args[0], ctx)
  const rest = node.args.slice(1)
  const hasDefault = rest.length % 2 === 1
  const pairArgs = hasDefault ? rest.slice(0, -1) : rest
  const defaultArg = hasDefault ? rest[rest.length - 1] : undefined

  const diagnostics: ExpressionDiagnostic[] = [...exprResult.diagnostics]
  const cases: BoundSwitchCase[] = []
  for (let i = 0; i < pairArgs.length; i += 2) {
    const value = bindNode(pairArgs[i], ctx)
    const result = bindNode(pairArgs[i + 1], ctx)
    diagnostics.push(...value.diagnostics, ...result.diagnostics)
    if (value.bound && result.bound) cases.push({ value: value.bound, result: result.bound })
  }
  const defaultResult = defaultArg ? bindNode(defaultArg, ctx) : undefined
  if (defaultResult) diagnostics.push(...defaultResult.diagnostics)

  if (!exprResult.bound || diagnostics.some((d) => d.severity === 'error')) return { diagnostics }
  return { bound: { kind: 'Switch', expression: exprResult.bound, cases, defaultResult: defaultResult?.bound, span: node.span }, diagnostics }
}

function bindFunctionCall(node: FunctionCallNode, ctx: ResolvedBindContext): BindResult {
  const name = node.name.toUpperCase()

  if (CALCULATE_CONTEXT_TRANSITION_FUNCTIONS.has(name)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED',
          `"${node.name}" (CALCULATE and its filter modifiers) is only supported in measures, not calculated columns — using it here would require row-context-to-filter-context transition, which Sprint 8 doesn't implement. See docs/CALCULATE.md "Context transition boundary".`,
          node.nameSpan,
        ),
      ],
    }
  }

  if (name === 'IF') return bindIf(node, ctx)
  if (name === 'SWITCH') return bindSwitch(node, ctx)
  if (name === 'BLANK') {
    if (node.args.length !== 0) {
      return { diagnostics: [diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'BLANK() takes no arguments.', node.span)] }
    }
    return { bound: { kind: 'Blank', span: node.span }, diagnostics: [] }
  }

  if (name !== 'RELATED') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" is not supported in calculated columns. Supported: RELATED(Table[Column]), IF, SWITCH, BLANK().`,
          node.nameSpan,
        ),
      ],
    }
  }

  const [arg] = node.args
  if (node.args.length !== 1 || arg.kind !== 'ColumnReference' || arg.table === null) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_FUNCTION_ARGUMENT', 'RELATED expects exactly one argument in the form Table[Column].', node.span),
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

  const targetResolved = resolveTableRef(ctx.datasets, targetModelTable)
  if (!targetResolved) {
    return {
      diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Table "${arg.table}" could not be resolved.`, arg.tableSpan ?? arg.span)],
    }
  }

  const column = targetResolved.table.columns.find((c) => c.name.toLowerCase() === arg.column.toLowerCase())
  if (!column) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${arg.column}" on "${targetResolved.table.name}".`, arg.columnSpan, {
          table: targetResolved.table.name,
          column: arg.column,
        }),
      ],
    }
  }

  const related = resolveRelatedRelationship(ctx.model, ctx.currentTable.id, targetModelTable.id)
  if ('code' in related) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          related.code,
          RELATED_MESSAGES[related.code](ctx.currentResolved.table.name, targetResolved.table.name),
          node.span,
          { currentTable: ctx.currentResolved.table.name, targetTable: targetResolved.table.name },
        ),
      ],
    }
  }

  return {
    bound: {
      kind: 'Related',
      relationshipId: related.relationship.id,
      targetColumnRef: { datasetId: targetResolved.dataset.id, tableId: targetResolved.table.id, columnId: column.id },
      dataType: column.dataType,
      label: `RELATED(${targetResolved.table.name}[${column.name}])`,
      span: node.span,
    },
    diagnostics: [],
  }
}

function bindNode(node: Expression, ctx: ResolvedBindContext): BindResult {
  switch (node.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return { bound: { kind: 'Literal', value: node.value, span: node.span }, diagnostics: [] }

    case 'ColumnReference':
      return bindColumnReference(node, ctx)

    case 'UnaryExpression': {
      const operand = bindNode(node.operand, ctx)
      if (!operand.bound) return { diagnostics: operand.diagnostics }
      return {
        bound: { kind: 'Unary', operator: node.operator, operand: operand.bound, span: node.span },
        diagnostics: operand.diagnostics,
      }
    }

    case 'BinaryExpression': {
      const left = bindNode(node.left, ctx)
      const right = bindNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Binary', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }

    case 'FunctionCall':
      return bindFunctionCall(node, ctx)

    case 'TableReference':
      return {
        diagnostics: [
          diagnostic(
            'error',
            'BARE_TABLE_REFERENCE',
            `"${node.table}" is a table, not a value. A calculated column can only read a column (e.g. "${node.table}[Column]") or use RELATED to reach another table.`,
            node.span,
            { table: node.table },
          ),
        ],
      }

    // Sprint 8 added `=`/`<>`/`>`/`>=`/`<`/`<=`/`&&`/`||` to the shared grammar for CALCULATE's
    // boolean filter arguments (measure context). Sprint 9 extends calculated columns to support
    // them too (sprint brief §32-§33) — real DAX allows conditional row logic here; only CALCULATE
    // itself (a context-transition feature) stays measure-only.
    case 'ComparisonExpression': {
      const left = bindNode(node.left, ctx)
      const right = bindNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Comparison', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }

    case 'LogicalExpression': {
      const left = bindNode(node.left, ctx)
      const right = bindNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Logical', operator: node.operator, left: left.bound, right: right.bound, span: node.span }, diagnostics }
    }
  }
}

/**
 * Resolves a parsed expression against the real semantic model: table/column
 * names become stable `ColumnRef`s, and `RELATED` calls are resolved to a
 * specific relationship. Binder responsibility only — see module docstring
 * in `evaluator.ts` for why execution happens elsewhere.
 */
export function bind(expression: Expression, ctx: BindContext): BindResult {
  const currentTable = ctx.model.tables.find((t) => t.id === ctx.currentModelTableId)
  const currentResolved = currentTable ? resolveTableRef(ctx.datasets, currentTable) : undefined
  if (!currentTable || !currentResolved) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_TABLE', "This calculated column's own table could not be resolved.", expression.span),
      ],
    }
  }

  return bindNode(expression, { model: ctx.model, datasets: ctx.datasets, currentTable, currentResolved })
}
