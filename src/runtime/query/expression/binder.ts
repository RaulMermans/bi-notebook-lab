import type { DataColumn } from '../../../domain/data'
import type { QueryDiagnostic } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { BoundExprNode, ExprNode } from './ast'
import { CUSTOM_COLUMN_FUNCTIONS } from './functions'

export interface BindResult {
  bound?: BoundExprNode
  diagnostics: QueryDiagnostic[]
}

/**
 * Resolves every `[Column]` reference to a stable `DataColumn.id` and
 * validates every function call's name/arity, all in one pass. Binding to
 * an id (never the name text baked into the source) is what makes a
 * rename-after-binding safe — the same identity rule used everywhere else
 * in the query runtime (docs/POWER_QUERY_RUNTIME.md "Stable identity").
 */
export function bindExpression(node: ExprNode, columns: DataColumn[], stepId: string): BindResult {
  const diagnostics: QueryDiagnostic[] = []

  function bind(n: ExprNode): BoundExprNode | undefined {
    switch (n.kind) {
      case 'literal':
        return n
      case 'column': {
        const lower = n.name.toLowerCase()
        const column = columns.find((c) => c.name.toLowerCase() === lower)
        if (!column) {
          diagnostics.push(
            errorDiagnostic('QUERY_CUSTOM_COLUMN_NOT_FOUND', `Custom Column references "[${n.name}]", which does not exist on the input.`, {
              stepId,
              details: { columnName: n.name },
            }),
          )
          return undefined
        }
        return { kind: 'column', name: n.name, columnId: column.id }
      }
      case 'unary-minus': {
        const operand = bind(n.operand)
        return operand ? { kind: 'unary-minus', operand } : undefined
      }
      case 'binary': {
        const left = bind(n.left)
        const right = bind(n.right)
        return left && right ? { kind: 'binary', operator: n.operator, left, right } : undefined
      }
      case 'conditional': {
        const condition = bind(n.condition)
        const whenTrue = bind(n.whenTrue)
        const whenFalse = bind(n.whenFalse)
        return condition && whenTrue && whenFalse ? { kind: 'conditional', condition, whenTrue, whenFalse } : undefined
      }
      case 'call': {
        const impl = CUSTOM_COLUMN_FUNCTIONS[n.functionName]
        if (!impl) {
          diagnostics.push(
            errorDiagnostic('QUERY_CUSTOM_PARSE_ERROR', `"${n.functionName}" is not a supported Custom Column function.`, { stepId, details: { functionName: n.functionName } }),
          )
        } else if (n.args.length < impl.minArgs || n.args.length > impl.maxArgs) {
          diagnostics.push(
            errorDiagnostic('QUERY_CUSTOM_PARSE_ERROR', `"${n.functionName}" expects ${impl.minArgs === impl.maxArgs ? impl.minArgs : `${impl.minArgs}-${impl.maxArgs}`} argument(s), got ${n.args.length}.`, {
              stepId,
              details: { functionName: n.functionName },
            }),
          )
        }
        const args = n.args.map((arg) => bind(arg))
        if (!impl || args.some((a) => a === undefined)) return undefined
        return { kind: 'call', functionName: n.functionName, args: args as BoundExprNode[] }
      }
    }
  }

  const bound = bind(node)
  return { bound, diagnostics }
}
