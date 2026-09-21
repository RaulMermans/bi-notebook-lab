import type { ColumnRef } from '../../domain/model'
import type { Expression, FunctionCallNode } from '../../expression/ast'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { findDateTableDefinitionForColumn } from '../dateTable/dateTableRuntime'
import { resolveTableRef } from '../model/modelRuntime'
import type { TableExpressionBindContext, TableExpressionBindResult } from '../tableExpression/tableExpressionBinder'
import type { BoundTimeIntelligenceTable, TimeIntelligenceOperation } from '../tableExpression/tableExpressionTypes'
import { findModelTableByName } from '../../expression/binder'

interface ResolvedDateColumnArgument {
  modelTableId: string
  dateColumn: ColumnRef
  dateColumnName: string
  tableName: string
}

/**
 * Resolves a time-intelligence function's `Table[Column]` argument and
 * enforces sprint brief §16: the column must be the *canonical* date column
 * of a table already marked as a Date Table (`domain/model.ts`'s
 * `DateTableDefinition`), never an arbitrary date column. Shared by every
 * Sprint 10 table-returning function and `TOTALYTD`'s date argument (bind
 * once, reuse everywhere — see docs/TIME_INTELLIGENCE.md).
 */
export function bindDateColumnArgument(
  argNode: Expression,
  ctx: TableExpressionBindContext,
  functionLabel: string,
): { resolved?: ResolvedDateColumnArgument; diagnostics: ExpressionDiagnostic[] } {
  if (argNode.kind !== 'ColumnReference' || argNode.table === null) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'TIME_INTELLIGENCE_INVALID_ARGUMENT',
          `${functionLabel} expects a date column in the form Table[Column], e.g. ${functionLabel}(Calendar[Date]).`,
          argNode.span,
        ),
      ],
    }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, argNode.table)
  if (!modelTable) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${argNode.table}". It isn't part of this model.`, argNode.tableSpan ?? argNode.span, {
          table: argNode.table,
        }),
      ],
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

  const dateColumn: ColumnRef = { datasetId: resolvedTable.dataset.id, tableId: resolvedTable.table.id, columnId: column.id }
  const definition = findDateTableDefinitionForColumn(ctx.model, dateColumn)
  if (!definition || definition.modelTableId !== modelTable.id) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'DATE_TABLE_REQUIRED',
          `${functionLabel} requires "${resolvedTable.table.name}[${column.name}]" to be the canonical date column of a marked Date Table. Mark "${resolvedTable.table.name}" as a Date Table and use "${resolvedTable.table.name}[${column.name}]".`,
          argNode.span,
          { table: resolvedTable.table.name, column: column.name },
        ),
      ],
    }
  }

  return {
    resolved: { modelTableId: modelTable.id, dateColumn, dateColumnName: column.name, tableName: resolvedTable.table.name },
    diagnostics: [],
  }
}

function bindSingleDateColumnFunction(
  operation: TimeIntelligenceOperation,
  functionName: string,
  node: FunctionCallNode,
  ctx: TableExpressionBindContext,
): TableExpressionBindResult {
  if (node.args.length !== 1) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'TIME_INTELLIGENCE_INVALID_ARGUMENT',
          `${functionName} expects exactly one argument: ${functionName}(Table[DateColumn]).`,
          node.span,
        ),
      ],
    }
  }

  const { resolved, diagnostics } = bindDateColumnArgument(node.args[0], ctx, functionName)
  if (!resolved) return { diagnostics }

  return {
    bound: {
      kind: 'TimeIntelligenceTable',
      operation,
      modelTableId: resolved.modelTableId,
      dateColumn: resolved.dateColumn,
      dateColumnName: resolved.dateColumnName,
      tableName: resolved.tableName,
      label: `${functionName}(${resolved.tableName}[${resolved.dateColumnName}])`,
      span: node.span,
    },
    diagnostics,
  }
}

export function bindSamePeriodLastYear(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  return bindSingleDateColumnFunction('same-period-last-year', 'SAMEPERIODLASTYEAR', node, ctx)
}

export function bindPreviousMonth(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  return bindSingleDateColumnFunction('previous-month', 'PREVIOUSMONTH', node, ctx)
}

export function bindPreviousYear(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  return bindSingleDateColumnFunction('previous-year', 'PREVIOUSYEAR', node, ctx)
}

export function bindDatesYtd(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  return bindSingleDateColumnFunction('dates-ytd', 'DATESYTD', node, ctx)
}

const INTERVAL_UNITS = new Set(['YEAR', 'QUARTER', 'MONTH', 'DAY'])

/** A bare numeric literal, optionally negated — the only shape DATEADD's offset argument accepts (sprint brief §25). */
function evaluateConstantInteger(node: Expression): number | undefined {
  if (node.kind === 'NumberLiteral' && Number.isInteger(node.value)) return node.value
  if (node.kind === 'UnaryExpression' && node.operator === '-') {
    const operand = evaluateConstantInteger(node.operand)
    return operand === undefined ? undefined : -operand
  }
  return undefined
}

/** Binds `DATEADD(Table[DateColumn], count, YEAR|QUARTER|MONTH|DAY)` (sprint brief §23-§27). The interval keyword binds as a bare identifier (parses as a `TableReference` node — see parser.ts), not a string literal, matching Power BI syntax (sprint brief §24). */
export function bindDateAdd(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  if (node.args.length !== 3) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'TIME_INTELLIGENCE_INVALID_ARGUMENT',
          'DATEADD expects exactly three arguments: DATEADD(Table[DateColumn], numberOfIntervals, YEAR|QUARTER|MONTH|DAY).',
          node.span,
        ),
      ],
    }
  }

  const [dateArg, countArg, intervalArg] = node.args
  const { resolved, diagnostics } = bindDateColumnArgument(dateArg, ctx, 'DATEADD')

  const count = evaluateConstantInteger(countArg)
  const countDiagnostics: ExpressionDiagnostic[] =
    count === undefined
      ? [
          diagnostic(
            'error',
            'DATEADD_INTERVAL_COUNT_INVALID',
            'DATEADD\'s second argument must be a constant integer, e.g. -1, 0 or 2.',
            countArg.span,
          ),
        ]
      : []

  let intervalUnit: 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY' | undefined
  const intervalDiagnostics: ExpressionDiagnostic[] = []
  if (intervalArg.kind === 'TableReference' && INTERVAL_UNITS.has(intervalArg.table.toUpperCase())) {
    intervalUnit = intervalArg.table.toUpperCase() as 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY'
  } else {
    intervalDiagnostics.push(
      diagnostic(
        'error',
        'DATEADD_INVALID_INTERVAL',
        'DATEADD\'s third argument must be one of YEAR, QUARTER, MONTH or DAY (unquoted, e.g. DATEADD(Calendar[Date], -1, MONTH)).',
        intervalArg.span,
      ),
    )
  }

  const allDiagnostics = [...diagnostics, ...countDiagnostics, ...intervalDiagnostics]
  if (!resolved || count === undefined || !intervalUnit) return { diagnostics: allDiagnostics }

  return {
    bound: {
      kind: 'TimeIntelligenceTable',
      operation: 'date-add',
      modelTableId: resolved.modelTableId,
      dateColumn: resolved.dateColumn,
      dateColumnName: resolved.dateColumnName,
      tableName: resolved.tableName,
      intervalUnit,
      intervalCount: count,
      label: `DATEADD(${resolved.tableName}[${resolved.dateColumnName}], ${count}, ${intervalUnit})`,
      span: node.span,
    },
    diagnostics: allDiagnostics,
  }
}
