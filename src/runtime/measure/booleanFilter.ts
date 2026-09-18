import type { DataType, Dataset } from '../../domain/data'
import type { ColumnRef, SemanticModel } from '../../domain/model'
import type { ComparisonOperator, Expression, LogicalOperator, SourceSpan } from '../../expression/ast'
import { findModelTableByName } from '../../expression/binder'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { resolveTableRef } from '../model/modelRuntime'

/**
 * The bound form of a CALCULATE/FILTER boolean filter expression — a small,
 * separate tree from `BoundMeasureExpression` (measureBinder.ts) because a
 * filter predicate has different rules: it may only read physical columns of
 * *one* table, never a measure, and never a nested CALCULATE (docs/CALCULATE.md
 * "Boolean filter arguments"). Reuses stable `ColumnRef`s, never table/column
 * names, as execution authority (sprint brief §15).
 */
export interface BoundPredicateColumn {
  kind: 'Column'
  ref: ColumnRef
  name: string
  tableName: string
  dataType: DataType
  span: SourceSpan
}

export interface BoundPredicateLiteral {
  kind: 'Literal'
  value: number | string | boolean
  span: SourceSpan
}

export interface BoundPredicateComparison {
  kind: 'Comparison'
  operator: ComparisonOperator
  left: BoundPredicateNode
  right: BoundPredicateNode
  span: SourceSpan
}

export interface BoundPredicateLogical {
  kind: 'Logical'
  operator: LogicalOperator
  left: BoundPredicateNode
  right: BoundPredicateNode
  span: SourceSpan
}

export type BoundPredicateNode = BoundPredicateColumn | BoundPredicateLiteral | BoundPredicateComparison | BoundPredicateLogical

export interface PredicateBindResult {
  bound?: BoundPredicateNode
  /** The single model table every column reference in the predicate resolved to. Absent if binding failed before any column was seen. */
  modelTableId?: string
  referencedColumns: ColumnRef[]
  diagnostics: ExpressionDiagnostic[]
}

interface PredicateBindState {
  model: SemanticModel
  datasets: Record<string, Dataset>
  referencedColumns: ColumnRef[]
  /** Set once the first column reference is seen (direct CALCULATE filter argument), or fixed up front (FILTER's explicit table argument). */
  modelTableId?: string
  /** Present only for FILTER(Table, predicate) — column references outside this table are a row-context violation, not just "another table". */
  fixedTable?: { modelTableId: string; tableName: string }
}

function bindPredicateNode(expr: Expression, state: PredicateBindState): { bound?: BoundPredicateNode; diagnostics: ExpressionDiagnostic[] } {
  switch (expr.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return { bound: { kind: 'Literal', value: expr.value, span: expr.span }, diagnostics: [] }

    case 'ColumnReference': {
      if (expr.table === null) {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'BOOLEAN_FILTER_MEASURE_REFERENCE',
              `"[${expr.column}]" looks like a measure reference. A CALCULATE/FILTER boolean filter can only reference physical columns (Table[Column]), never a measure.`,
              expr.span,
              { column: expr.column },
            ),
          ],
        }
      }

      const targetModelTable = findModelTableByName(state.model, state.datasets, expr.table)
      if (!targetModelTable) {
        return {
          diagnostics: [
            diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${expr.table}". It isn't part of this model.`, expr.tableSpan ?? expr.span, {
              table: expr.table,
            }),
          ],
        }
      }

      if (state.fixedTable && targetModelTable.id !== state.fixedTable.modelTableId) {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'FILTER_ROW_CONTEXT_VIOLATION',
              `"${expr.table}[${expr.column}]" is outside the current row context. FILTER(${state.fixedTable.tableName}, ...) can only reference "${state.fixedTable.tableName}"'s own columns — implicit relationship traversal isn't supported here.`,
              expr.span,
              { table: expr.table },
            ),
          ],
        }
      }

      if (!state.fixedTable) {
        if (state.modelTableId && state.modelTableId !== targetModelTable.id) {
          return {
            diagnostics: [
              diagnostic(
                'error',
                'BOOLEAN_FILTER_MULTIPLE_TABLES',
                `A boolean CALCULATE filter argument can only reference columns from one table, but this expression references more than one (including "${expr.table}").`,
                expr.span,
                { table: expr.table },
              ),
            ],
          }
        }
        state.modelTableId = targetModelTable.id
      }

      const resolved = resolveTableRef(state.datasets, targetModelTable)
      const column = resolved?.table.columns.find((c) => c.name.toLowerCase() === expr.column.toLowerCase())
      if (!resolved || !column) {
        return {
          diagnostics: [
            diagnostic('error', 'UNKNOWN_COLUMN', `Unknown column "${expr.column}" on "${expr.table}".`, expr.columnSpan, {
              table: expr.table,
              column: expr.column,
            }),
          ],
        }
      }

      const ref: ColumnRef = { datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id }
      state.referencedColumns.push(ref)
      return {
        bound: { kind: 'Column', ref, name: column.name, tableName: resolved.table.name, dataType: column.dataType, span: expr.span },
        diagnostics: [],
      }
    }

    case 'ComparisonExpression': {
      const left = bindPredicateNode(expr.left, state)
      const right = bindPredicateNode(expr.right, state)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Comparison', operator: expr.operator, left: left.bound, right: right.bound, span: expr.span }, diagnostics }
    }

    case 'LogicalExpression': {
      const left = bindPredicateNode(expr.left, state)
      const right = bindPredicateNode(expr.right, state)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!left.bound || !right.bound) return { diagnostics }
      return { bound: { kind: 'Logical', operator: expr.operator, left: left.bound, right: right.bound, span: expr.span }, diagnostics }
    }

    case 'UnaryExpression': {
      // Only a numeric literal negation is meaningful inside a filter predicate (e.g. `Products[Margin] > -5`).
      const operand = bindPredicateNode(expr.operand, state)
      if (!operand.bound) return { diagnostics: operand.diagnostics }
      if (operand.bound.kind === 'Literal' && typeof operand.bound.value === 'number') {
        return { bound: { kind: 'Literal', value: -operand.bound.value, span: expr.span }, diagnostics: operand.diagnostics }
      }
      return {
        diagnostics: [
          ...operand.diagnostics,
          diagnostic(
            'error',
            'CALCULATE_INVALID_FILTER_ARGUMENT',
            'Unary "-" inside a boolean filter is only supported directly on a numeric literal.',
            expr.span,
          ),
        ],
      }
    }

    case 'BinaryExpression':
      return {
        diagnostics: [
          diagnostic(
            'error',
            'CALCULATE_INVALID_FILTER_ARGUMENT',
            'Arithmetic is not supported inside a boolean filter expression in Sprint 8 — use a plain comparison, e.g. Products[Price] > 100.',
            expr.span,
          ),
        ],
      }

    case 'FunctionCall':
      if (expr.name.toUpperCase() === 'CALCULATE') {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'BOOLEAN_FILTER_NESTED_CALCULATE',
              'A CALCULATE/FILTER boolean filter cannot contain a nested CALCULATE.',
              expr.span,
            ),
          ],
        }
      }
      return {
        diagnostics: [
          diagnostic('error', 'UNSUPPORTED_FUNCTION', `"${expr.name}" is not supported inside a boolean filter expression.`, expr.nameSpan),
        ],
      }

    case 'TableReference':
      return {
        diagnostics: [
          diagnostic(
            'error',
            'BARE_TABLE_REFERENCE',
            `"${expr.table}" is a table, not a value here.`,
            expr.span,
            { table: expr.table },
          ),
        ],
      }

    default:
      return { diagnostics: [] }
  }
}

function isBooleanShaped(node: BoundPredicateNode): boolean {
  return node.kind === 'Comparison' || node.kind === 'Logical' || (node.kind === 'Literal' && typeof node.value === 'boolean')
}

/**
 * Binds a raw parsed `Expression` (a CALCULATE filter argument, or FILTER's
 * predicate argument) as a boolean filter predicate. `fixedTable` scopes a
 * `FILTER(Table, predicate)` predicate to that table's row context (sprint
 * brief §19); omit it for a direct CALCULATE boolean filter argument, whose
 * table is instead inferred from the first column reference encountered.
 */
export function bindPredicateExpression(
  expr: Expression,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  fixedTable?: { modelTableId: string; tableName: string },
): PredicateBindResult {
  const state: PredicateBindState = { model, datasets, referencedColumns: [], fixedTable, modelTableId: fixedTable?.modelTableId }
  const result = bindPredicateNode(expr, state)

  if (result.bound && !isBooleanShaped(result.bound)) {
    return {
      referencedColumns: state.referencedColumns,
      diagnostics: [
        ...result.diagnostics,
        diagnostic(
          'error',
          'FILTER_PREDICATE_NOT_BOOLEAN',
          'This expression does not produce a boolean result — a filter must be a comparison (e.g. Products[Price] > 100) or a && / || combination of comparisons.',
          expr.span,
        ),
      ],
    }
  }

  return { bound: result.bound, modelTableId: state.modelTableId, referencedColumns: state.referencedColumns, diagnostics: result.diagnostics }
}

/**
 * Deduplicates a list of `ColumnRef`s by their composite key — used so a
 * predicate referencing the same column twice (e.g. `Price > 10 && Price <
 * 100`) only lists it once for REMOVEFILTERS(column)/ALL(column) purposes.
 */
export function dedupeColumnRefs(refs: ColumnRef[]): ColumnRef[] {
  const seen = new Map<string, ColumnRef>()
  for (const ref of refs) seen.set(`${ref.datasetId}:${ref.tableId}:${ref.columnId}`, ref)
  return [...seen.values()]
}

function formatLiteral(value: number | string | boolean): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

/** Renders a bound predicate back into a readable label for traces/modifier descriptions — never a slice of the original source (the bound tree is the runtime's own truth). */
export function describeBoundPredicate(node: BoundPredicateNode): string {
  switch (node.kind) {
    case 'Column':
      return `${node.tableName}[${node.name}]`
    case 'Literal':
      return formatLiteral(node.value)
    case 'Comparison':
      return `${describeBoundPredicate(node.left)} ${node.operator} ${describeBoundPredicate(node.right)}`
    case 'Logical':
      return `(${describeBoundPredicate(node.left)} ${node.operator} ${describeBoundPredicate(node.right)})`
  }
}

/**
 * Documented blank-comparison semantics for the bounded Sprint 8 boolean
 * subset (sprint brief §10 "Document exact blank comparison semantics"):
 *
 * - `=`:  BLANK = BLANK is true; BLANK = anything-else is false. No implicit
 *   coercion of blank to 0/"" the way some real-DAX contexts do.
 * - `<>`: the exact negation of `=` above.
 * - `> >= < <=`: any comparison involving a blank operand is **never true**
 *   (a blank never satisfies a relational comparison) — this is simpler than
 *   real DAX's blank-coercion rules and is a documented incompatibility (see
 *   docs/CALCULATE.md "Known limitations").
 * - Comparing two non-blank values of **different JS types** never coerces
 *   (sprint brief §52 "do not silently coerce arbitrary strings to
 *   numbers"): `=` is false, `<>` is true, relational operators are false.
 */
export function compareScalarValues(operator: ComparisonOperator, left: unknown, right: unknown): boolean {
  const leftBlank = left === null || left === undefined
  const rightBlank = right === null || right === undefined

  if (leftBlank || rightBlank) {
    if (operator === '=') return leftBlank && rightBlank
    if (operator === '<>') return !(leftBlank && rightBlank)
    return false
  }

  if (typeof left !== typeof right) {
    if (operator === '=') return false
    if (operator === '<>') return true
    return false
  }

  switch (operator) {
    case '=':
      return left === right
    case '<>':
      return left !== right
    case '>':
      return (left as number | string) > (right as number | string)
    case '>=':
      return (left as number | string) >= (right as number | string)
    case '<':
      return (left as number | string) < (right as number | string)
    case '<=':
      return (left as number | string) <= (right as number | string)
  }
}

const compareValues = compareScalarValues

/**
 * Evaluates a bound predicate against one physical row of its target table.
 * `&&`/`||` short-circuit (sprint brief §11). Row values are read by column
 * name (resolved once at bind time, not re-resolved per row).
 */
export function evaluatePredicateForRow(node: BoundPredicateNode, row: Record<string, unknown>): boolean {
  switch (node.kind) {
    case 'Column':
      return Boolean(row[node.name])
    case 'Literal':
      return Boolean(node.value)
    case 'Comparison': {
      const left = readPredicateValue(node.left, row)
      const right = readPredicateValue(node.right, row)
      return compareValues(node.operator, left, right)
    }
    case 'Logical': {
      if (node.operator === '&&') {
        return evaluatePredicateForRow(node.left, row) && evaluatePredicateForRow(node.right, row)
      }
      return evaluatePredicateForRow(node.left, row) || evaluatePredicateForRow(node.right, row)
    }
  }
}

function readPredicateValue(node: BoundPredicateNode, row: Record<string, unknown>): unknown {
  if (node.kind === 'Column') return row[node.name] ?? null
  if (node.kind === 'Literal') return node.value
  // A comparison/logical node used as a comparison operand isn't a supported shape — treat as blank.
  return null
}
