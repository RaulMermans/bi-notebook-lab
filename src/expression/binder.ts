import type { DataType, Dataset } from '../domain/data'
import type { ColumnRef, ModelTable, SemanticModel } from '../domain/model'
import { resolveTableRef, type ResolvedTableRef } from '../runtime/model/modelRuntime'
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

export type BoundExpression = BoundLiteral | BoundColumnReference | BoundUnary | BoundBinary | BoundRelated

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

function bindFunctionCall(node: FunctionCallNode, ctx: ResolvedBindContext): BindResult {
  if (CALCULATE_CONTEXT_TRANSITION_FUNCTIONS.has(node.name.toUpperCase())) {
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

  if (node.name.toUpperCase() !== 'RELATED') {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'UNSUPPORTED_FUNCTION',
          `"${node.name}" is not supported yet. Sprint 3 calculated columns only support RELATED(Table[Column]).`,
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
    // boolean filter arguments (measure context). Calculated columns stay the unchanged Sprint 3
    // scalar-arithmetic subset — reported with `UNSUPPORTED_FUNCTION` rather than silently
    // returning no diagnostics (which would otherwise look like a no-op save).
    case 'ComparisonExpression':
    case 'LogicalExpression':
      return {
        diagnostics: [
          diagnostic(
            'error',
            'UNSUPPORTED_FUNCTION',
            'Comparison (=, <>, >, >=, <, <=) and logical (&&, ||) operators are not supported in calculated columns — they are a Sprint 8 measure/CALCULATE feature. See docs/CALCULATE.md.',
            node.span,
          ),
        ],
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
