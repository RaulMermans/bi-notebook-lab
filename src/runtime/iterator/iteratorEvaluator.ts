import type { BinaryOperator } from '../../expression/ast'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import { compareScalarValues } from '../../expression/scalarComparison'
import type { ExecutionTraceNode } from '../../expression/trace'
import type { LogicalColumnRef } from '../measure/logicalColumn'
import type { BoundIteratorExpression } from './iteratorTypes'

/** One row of an iterator's Row Context — either a physical model-table row (`rowIndex`/`row` set) or a VALUES/DISTINCT virtual row (`value` set). See docs/ITERATORS.md "Row Context". */
export interface IteratorRowData {
  kind: 'model' | 'value'
  row?: Record<string, unknown>
  rowIndex?: number
  value?: unknown
}

export interface IteratorRowEvalResult {
  value: unknown
  diagnostics: ExpressionDiagnostic[]
  trace: ExecutionTraceNode
}

/**
 * Everything the per-row evaluator needs that must be computed *once* per
 * `SUMX`/etc. call, not once per row (sprint brief §69 "parse/bind once,
 * reuse column vectors, O(n)"): pre-fetched calculated-column vectors, a
 * lazily-built RELATED index, and the bounded measure-reference
 * context-transition callback (sprint brief §40-§43, implemented in
 * `measureEvaluator.ts`, injected here to avoid a binder/evaluator import
 * cycle).
 */
export interface IteratorEvalHelpers {
  getCalculatedVector(columnId: string): unknown[]
  getRelatedIndex(relationshipId: string): Map<unknown, Record<string, unknown>> | undefined
  evaluateMeasureReference(measureId: string, measureName: string, rowData: IteratorRowData): { value: unknown; diagnostics: ExpressionDiagnostic[]; trace: ExecutionTraceNode }
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  return String(value)
}

function applyBinary(operator: BinaryOperator, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
  }
}

function readColumnValue(column: LogicalColumnRef, rowData: IteratorRowData, helpers: IteratorEvalHelpers): unknown {
  if (rowData.kind === 'value') return rowData.value ?? null
  if (column.kind === 'physical') return (rowData.row?.[column.name] ?? null) as unknown
  const vector = helpers.getCalculatedVector(column.columnId)
  return vector[rowData.rowIndex ?? -1] ?? null
}

/**
 * Evaluates one bound iterator row expression against one `IteratorRowData`
 * — the per-row evaluation loop `SUMX`/`AVERAGEX`/etc. run once per visible
 * row (sprint brief §17 "real Row Context"). Pure — no I/O, no mutation of
 * `helpers` beyond what `helpers` itself already caches.
 */
export function evaluateIteratorRowExpression(node: BoundIteratorExpression, rowData: IteratorRowData, helpers: IteratorEvalHelpers): IteratorRowEvalResult {
  switch (node.kind) {
    case 'Literal':
      return { value: node.value, diagnostics: [], trace: { kind: 'literal', label: formatValue(node.value), value: node.value } }

    case 'Column': {
      const value = readColumnValue(node.column, rowData, helpers)
      return { value, diagnostics: [], trace: { kind: 'column-read', label: node.label, value } }
    }

    case 'Unary': {
      const operand = evaluateIteratorRowExpression(node.operand, rowData, helpers)
      let value: unknown = null
      const diagnostics = [...operand.diagnostics]
      if (diagnostics.length === 0) {
        if (operand.value === null) value = null
        else if (!isNumber(operand.value)) {
          diagnostics.push(diagnostic('error', 'ITERATOR_EXPRESSION_TYPE_ERROR', `Cannot negate a ${typeof operand.value} value.`, node.span))
        } else value = -operand.value
      }
      return { value, diagnostics, trace: { kind: 'unary-operation', label: `-(${formatValue(operand.value)})`, value, children: [operand.trace] } }
    }

    case 'Binary': {
      const left = evaluateIteratorRowExpression(node.left, rowData, helpers)
      const right = evaluateIteratorRowExpression(node.right, rowData, helpers)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      let value: unknown = null
      if (diagnostics.length === 0) {
        if (left.value === null || right.value === null) value = null
        else if (!isNumber(left.value) || !isNumber(right.value)) {
          diagnostics.push(
            diagnostic('error', 'ITERATOR_EXPRESSION_TYPE_ERROR', `Cannot use operator "${node.operator}" with a ${typeof left.value} and a ${typeof right.value} value.`, node.span),
          )
        } else if (node.operator === '/' && right.value === 0) {
          diagnostics.push(diagnostic('error', 'DIVISION_ERROR', 'Division by zero.', node.span))
        } else {
          value = applyBinary(node.operator, left.value, right.value)
        }
      }
      return {
        value,
        diagnostics,
        trace: { kind: 'binary-operation', label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`, value, children: [left.trace, right.trace] },
      }
    }

    case 'Comparison': {
      const left = evaluateIteratorRowExpression(node.left, rowData, helpers)
      const right = evaluateIteratorRowExpression(node.right, rowData, helpers)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      const value = diagnostics.length === 0 ? compareScalarValues(node.operator, left.value, right.value) : null
      return {
        value,
        diagnostics,
        trace: { kind: 'binary-operation', label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`, value, children: [left.trace, right.trace] },
      }
    }

    case 'Logical': {
      const left = evaluateIteratorRowExpression(node.left, rowData, helpers)
      if (left.diagnostics.length === 0) {
        if (node.operator === '&&' && left.value === false) {
          return { value: false, diagnostics: [], trace: { kind: 'binary-operation', label: `${formatValue(left.value)} && ⋯`, value: false, children: [left.trace] } }
        }
        if (node.operator === '||' && left.value === true) {
          return { value: true, diagnostics: [], trace: { kind: 'binary-operation', label: `${formatValue(left.value)} || ⋯`, value: true, children: [left.trace] } }
        }
      }
      const right = evaluateIteratorRowExpression(node.right, rowData, helpers)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      const value =
        diagnostics.length === 0
          ? node.operator === '&&'
            ? Boolean(left.value) && Boolean(right.value)
            : Boolean(left.value) || Boolean(right.value)
          : null
      return {
        value,
        diagnostics,
        trace: { kind: 'binary-operation', label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`, value, children: [left.trace, right.trace] },
      }
    }

    case 'Related': {
      if (rowData.kind !== 'model' || !rowData.row) {
        return { value: null, diagnostics: [], trace: { kind: 'related-lookup', label: node.label, value: null, metadata: { matched: false } } }
      }
      const index = helpers.getRelatedIndex(node.relationshipId)
      const foreignKeyValue = rowData.row[node.manyColumnName] ?? null
      const matchedRow = index && foreignKeyValue !== null ? index.get(foreignKeyValue) : undefined
      const value = matchedRow ? (matchedRow[node.targetColumnName] ?? null) : null
      return { value, diagnostics: [], trace: { kind: 'related-lookup', label: node.label, value, metadata: { matched: Boolean(matchedRow), foreignKeyValue } } }
    }

    case 'MeasureReference': {
      const result = helpers.evaluateMeasureReference(node.measureId, node.measureName, rowData)
      return { value: result.value, diagnostics: result.diagnostics, trace: result.trace }
    }

    case 'If': {
      const condition = evaluateIteratorRowExpression(node.condition, rowData, helpers)
      if (condition.diagnostics.length > 0) {
        return { value: null, diagnostics: condition.diagnostics, trace: { kind: 'conditional', label: 'IF', value: null, children: [condition.trace] } }
      }
      if (typeof condition.value !== 'boolean') {
        return {
          value: null,
          diagnostics: [diagnostic('error', 'IF_CONDITION_NOT_BOOLEAN', 'IF\'s condition must evaluate to TRUE or FALSE.', node.span)],
          trace: { kind: 'conditional', label: 'IF', value: null, children: [condition.trace] },
        }
      }
      if (condition.value) {
        const branch = evaluateIteratorRowExpression(node.whenTrue, rowData, helpers)
        return { value: branch.value, diagnostics: branch.diagnostics, trace: { kind: 'conditional', label: 'IF → true', value: branch.value, children: [condition.trace, branch.trace] } }
      }
      if (!node.whenFalse) {
        return { value: null, diagnostics: [], trace: { kind: 'conditional', label: 'IF → false (no branch, BLANK)', value: null, children: [condition.trace] } }
      }
      const branch = evaluateIteratorRowExpression(node.whenFalse, rowData, helpers)
      return { value: branch.value, diagnostics: branch.diagnostics, trace: { kind: 'conditional', label: 'IF → false', value: branch.value, children: [condition.trace, branch.trace] } }
    }

    case 'Switch': {
      const switchValue = evaluateIteratorRowExpression(node.expression, rowData, helpers)
      if (switchValue.diagnostics.length > 0) {
        return { value: null, diagnostics: switchValue.diagnostics, trace: { kind: 'conditional', label: 'SWITCH', value: null, children: [switchValue.trace] } }
      }
      for (const branchCase of node.cases) {
        const caseValue = evaluateIteratorRowExpression(branchCase.value, rowData, helpers)
        if (caseValue.diagnostics.length > 0) {
          return { value: null, diagnostics: caseValue.diagnostics, trace: { kind: 'conditional', label: 'SWITCH', value: null, children: [switchValue.trace, caseValue.trace] } }
        }
        if (compareScalarValues('=', switchValue.value, caseValue.value)) {
          const result = evaluateIteratorRowExpression(branchCase.result, rowData, helpers)
          return {
            value: result.value,
            diagnostics: result.diagnostics,
            trace: { kind: 'switch-case', label: `SWITCH matched ${formatValue(caseValue.value)}`, value: result.value, children: [switchValue.trace, caseValue.trace, result.trace] },
          }
        }
      }
      if (node.defaultResult) {
        const result = evaluateIteratorRowExpression(node.defaultResult, rowData, helpers)
        return { value: result.value, diagnostics: result.diagnostics, trace: { kind: 'switch-case', label: 'SWITCH default', value: result.value, children: [switchValue.trace, result.trace] } }
      }
      return { value: null, diagnostics: [], trace: { kind: 'switch-case', label: 'SWITCH (no match, BLANK)', value: null, children: [switchValue.trace] } }
    }

    case 'Blank':
      return { value: null, diagnostics: [], trace: { kind: 'literal', label: 'BLANK', value: null } }
  }
}

/** Walks a bound iterator expression collecting every calculated-column ref it reads, so the caller can prefetch each one's value vector exactly once before the per-row loop (sprint brief §69). */
export function collectIteratorCalculatedColumns(node: BoundIteratorExpression, out: LogicalColumnRef[]): void {
  switch (node.kind) {
    case 'Column':
      if (node.column.kind === 'calculated') out.push(node.column)
      return
    case 'Unary':
      collectIteratorCalculatedColumns(node.operand, out)
      return
    case 'Binary':
    case 'Comparison':
    case 'Logical':
      collectIteratorCalculatedColumns(node.left, out)
      collectIteratorCalculatedColumns(node.right, out)
      return
    case 'If':
      collectIteratorCalculatedColumns(node.condition, out)
      collectIteratorCalculatedColumns(node.whenTrue, out)
      if (node.whenFalse) collectIteratorCalculatedColumns(node.whenFalse, out)
      return
    case 'Switch':
      collectIteratorCalculatedColumns(node.expression, out)
      for (const c of node.cases) {
        collectIteratorCalculatedColumns(c.value, out)
        collectIteratorCalculatedColumns(c.result, out)
      }
      if (node.defaultResult) collectIteratorCalculatedColumns(node.defaultResult, out)
      return
    default:
      return
  }
}
