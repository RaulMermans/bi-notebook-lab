import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import { findModelTableByName } from '../../expression/binder'
import type { Expression, FunctionCallNode } from '../../expression/ast'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { bindPredicateExpression, dedupeColumnRefs, describeBoundPredicate } from '../measure/booleanFilter'
import { resolveTableRef } from '../model/modelRuntime'
import { bindDateAdd, bindDatesYtd, bindPreviousMonth, bindPreviousYear, bindSamePeriodLastYear } from '../timeIntelligence/timeIntelligenceBinder'
import type { BoundTableExpression } from './tableExpressionTypes'

export interface TableExpressionBindContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
}

export interface TableExpressionBindResult {
  bound?: BoundTableExpression
  diagnostics: ExpressionDiagnostic[]
}

function tableDisplayName(ctx: TableExpressionBindContext, modelTableId: string): string {
  const modelTable = ctx.model.tables.find((t) => t.id === modelTableId)
  return (modelTable && resolveTableRef(ctx.datasets, modelTable)?.table.name) ?? modelTableId
}

/** Binds `FILTER(tableExpr, predicate)` — sprint brief §6-§9. `tableExpr` recurses through `bindTableExpression`, so `FILTER(FILTER(Table, p1), p2)` composes for free. */
function bindFilterTable(node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  if (node.args.length !== 2) {
    return {
      diagnostics: [
        diagnostic('error', 'INVALID_ITERATOR_ARGUMENT', 'FILTER expects exactly two arguments: FILTER(table, predicate).', node.span),
      ],
    }
  }

  const [tableArg, predicateArg] = node.args
  const inputResult = bindTableExpression(tableArg, ctx)
  if (!inputResult.bound) return { diagnostics: inputResult.diagnostics }

  if (inputResult.bound.kind === 'ValuesTable' || inputResult.bound.kind === 'DistinctTable') {
    return {
      diagnostics: [
        ...inputResult.diagnostics,
        diagnostic(
          'error',
          'ITERATOR_UNSUPPORTED_TABLE_EXPRESSION',
          'FILTER(VALUES(...) / DISTINCT(...), predicate) is not supported in Sprint 9 — FILTER must be rooted at a model table (Sprint 9 scope boundary, see docs/TABLE_EXPRESSIONS.md).',
          tableArg.span,
        ),
      ],
    }
  }

  const modelTableId = inputResult.bound.modelTableId
  const tableName = tableDisplayName(ctx, modelTableId)
  const predicateResult = bindPredicateExpression(predicateArg, ctx.model, ctx.datasets, { modelTableId, tableName })
  if (!predicateResult.bound) return { diagnostics: [...inputResult.diagnostics, ...predicateResult.diagnostics] }

  return {
    bound: {
      kind: 'FilterTable',
      input: inputResult.bound,
      modelTableId,
      predicate: predicateResult.bound,
      referencedColumns: dedupeColumnRefs(predicateResult.referencedColumns),
      label: `FILTER(${tableName}, ${describeBoundPredicate(predicateResult.bound)})`,
      span: node.span,
    },
    diagnostics: [...inputResult.diagnostics, ...predicateResult.diagnostics],
  }
}

/** Binds `VALUES(Table[Column])` / `DISTINCT(Table[Column])` — sprint brief §10-§13: a one-column virtual table, Sprint 9 scope is column-only (not `VALUES(Table)`). */
function bindColumnTable(kind: 'ValuesTable' | 'DistinctTable', node: FunctionCallNode, ctx: TableExpressionBindContext): TableExpressionBindResult {
  const functionName = kind === 'ValuesTable' ? 'VALUES' : 'DISTINCT'
  const errorCode = kind === 'ValuesTable' ? 'INVALID_VALUES_ARGUMENT' : 'INVALID_DISTINCT_ARGUMENT'
  const [arg] = node.args

  if (node.args.length !== 1 || arg.kind !== 'ColumnReference' || arg.table === null) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          errorCode,
          `${functionName} expects exactly one argument in the form Table[Column], e.g. ${functionName}(Customers[Country]). ${functionName}(Table) is not supported in Sprint 9.`,
          node.span,
        ),
      ],
    }
  }

  const modelTable = findModelTableByName(ctx.model, ctx.datasets, arg.table)
  if (!modelTable) {
    return {
      diagnostics: [
        diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${arg.table}". It isn't part of this model.`, arg.tableSpan ?? arg.span, {
          table: arg.table,
        }),
      ],
    }
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
    bound: {
      kind,
      column: { datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: column.id },
      modelTableId: modelTable.id,
      columnName: column.name,
      tableName: resolved.table.name,
      span: node.span,
    },
    diagnostics: [],
  }
}

/**
 * Binds a parsed `Expression` as a `BoundTableExpression` — the single entry
 * point CALCULATE's FILTER modifier, COUNTROWS and the iterator functions
 * (SUMX, AVERAGEX, ...) all share (sprint brief §2 "no parallel DAX engine",
 * §6 "do not maintain two FILTER implementations"). See
 * docs/TABLE_EXPRESSIONS.md.
 */
export function bindTableExpression(node: Expression, ctx: TableExpressionBindContext): TableExpressionBindResult {
  if (node.kind === 'TableReference') {
    const modelTable = findModelTableByName(ctx.model, ctx.datasets, node.table)
    if (!modelTable) {
      return {
        diagnostics: [diagnostic('error', 'UNKNOWN_TABLE', `Unknown table "${node.table}". It isn't part of this model.`, node.span, { table: node.table })],
      }
    }
    return {
      bound: { kind: 'BaseTable', modelTableId: modelTable.id, tableName: tableDisplayName(ctx, modelTable.id), span: node.span },
      diagnostics: [],
    }
  }

  if (node.kind === 'FunctionCall') {
    const name = node.name.toUpperCase()
    if (name === 'FILTER') return bindFilterTable(node, ctx)
    if (name === 'VALUES') return bindColumnTable('ValuesTable', node, ctx)
    if (name === 'DISTINCT') return bindColumnTable('DistinctTable', node, ctx)
    // Sprint 10 (Classic Time Intelligence, sprint brief §17) — table-returning date functions,
    // dispatched through this same single binder (sprint brief §14 "no parallel DAX engine").
    if (name === 'SAMEPERIODLASTYEAR') return bindSamePeriodLastYear(node, ctx)
    if (name === 'DATEADD') return bindDateAdd(node, ctx)
    if (name === 'PREVIOUSMONTH') return bindPreviousMonth(node, ctx)
    if (name === 'PREVIOUSYEAR') return bindPreviousYear(node, ctx)
    if (name === 'DATESYTD') return bindDatesYtd(node, ctx)
    return {
      diagnostics: [
        diagnostic(
          'error',
          'INVALID_TABLE_EXPRESSION_ARGUMENT',
          `"${node.name}" does not produce a table. Table expressions are a model table, FILTER(...), VALUES(...), DISTINCT(...), SAMEPERIODLASTYEAR(...), DATEADD(...), PREVIOUSMONTH(...), PREVIOUSYEAR(...) or DATESYTD(...).`,
          node.nameSpan,
        ),
      ],
    }
  }

  return {
    diagnostics: [
      diagnostic(
        'error',
        'INVALID_TABLE_EXPRESSION_ARGUMENT',
        'Expected a table here — a model table name, FILTER(...), VALUES(...) or DISTINCT(...).',
        node.span,
      ),
    ],
  }
}
