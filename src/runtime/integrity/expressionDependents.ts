import type { Expression } from '../../expression/ast'
import { parseExpression } from '../../expression/parser'

export interface ColumnReferenceMention {
  table: string | null
  column: string
}

function collect(expression: Expression, out: ColumnReferenceMention[]): void {
  switch (expression.kind) {
    case 'ColumnReference':
      out.push({ table: expression.table, column: expression.column })
      return
    case 'UnaryExpression':
      collect(expression.operand, out)
      return
    case 'BinaryExpression':
    case 'ComparisonExpression':
    case 'LogicalExpression':
      collect(expression.left, out)
      collect(expression.right, out)
      return
    case 'FunctionCall':
      for (const arg of expression.args) collect(arg, out)
      return
    default:
      return
  }
}

/**
 * Parses `expression` (parse only — never the binder, which needs full
 * model context and throws on unrelated errors) and returns every
 * `Table[Column]`/`[Column]` reference it contains. On a parse failure,
 * returns `[]` — the caller must treat that as "cannot verify", not "no
 * dependency" (documented, deliberate semantic-dependency limitation — see
 * docs/WORKSPACE_INTEGRITY.md "Semantic dependency limitations").
 */
export function findColumnReferencesInExpression(expression: string): ColumnReferenceMention[] {
  const parsed = parseExpression(expression)
  if (!parsed.expression) return []
  const mentions: ColumnReferenceMention[] = []
  collect(parsed.expression, mentions)
  return mentions
}

export interface ExpressionOwner {
  id: string
  name: string
  expression: string
}

/**
 * Every measure/calculated column (other than `excludeCalculatedColumnId`
 * itself) whose expression mentions `columnName` by name — a same-table
 * bracket ref or any qualified `Table[Column]` ref, case-insensitive,
 * matched on the column name only (not which table it belongs to). This is
 * a deliberately conservative over-approximation: it can flag a dependency
 * that isn't really there (another table happens to have a same-named
 * column), never miss one — blocking too eagerly is safe in a learning
 * sandbox, silently orphaning an expression is not (brief §7 "guarantee
 * structural integrity first, document remaining semantic limitations").
 */
export function findCalculatedColumnDependents(
  model: { calculatedColumns: ExpressionOwner[]; measures: ExpressionOwner[] },
  excludeCalculatedColumnId: string,
  columnName: string,
): { calculatedColumnIds: string[]; measureIds: string[] } {
  const lowerName = columnName.toLowerCase()
  const mentionsColumn = (expression: string) => findColumnReferencesInExpression(expression).some((m) => m.column.toLowerCase() === lowerName)

  const calculatedColumnIds = model.calculatedColumns
    .filter((c) => c.id !== excludeCalculatedColumnId && mentionsColumn(c.expression))
    .map((c) => c.id)
  const measureIds = model.measures.filter((m) => mentionsColumn(m.expression)).map((m) => m.id)

  return { calculatedColumnIds, measureIds }
}
