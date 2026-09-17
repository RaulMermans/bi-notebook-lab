import type { Expression } from '../../expression/ast'
import { parseExpression } from '../../expression/parser'
import type { SemanticModel } from '../../domain/model'
import { detectCycle, type CycleResult } from '../../lib/graph/cycle'

/**
 * `[Name]` always means a measure reference in measure mode (see
 * `measureBinder.ts`), so dependency discovery only needs to walk the AST for
 * bracket-only `ColumnReferenceNode`s — it doesn't need a full bind pass.
 */
function collectMeasureReferenceNames(expression: Expression, names: Set<string>): void {
  switch (expression.kind) {
    case 'ColumnReference':
      if (expression.table === null) names.add(expression.column.toLowerCase())
      return
    case 'UnaryExpression':
      collectMeasureReferenceNames(expression.operand, names)
      return
    case 'BinaryExpression':
      collectMeasureReferenceNames(expression.left, names)
      collectMeasureReferenceNames(expression.right, names)
      return
    case 'FunctionCall':
      for (const arg of expression.args) collectMeasureReferenceNames(arg, names)
      return
    default:
      return
  }
}

/** measureId -> set of measure ids it directly references. Unresolvable references (typos, deleted measures) are simply omitted — that's a binding error, not a graph-structure concern. */
export function buildMeasureDependencyGraph(model: SemanticModel): Map<string, Set<string>> {
  const byLowerName = new Map<string, string>()
  for (const measure of model.measures) byLowerName.set(measure.name.toLowerCase(), measure.id)

  const graph = new Map<string, Set<string>>()
  for (const measure of model.measures) graph.set(measure.id, new Set())

  for (const measure of model.measures) {
    const parsed = parseExpression(measure.expression)
    if (!parsed.expression) continue
    const names = new Set<string>()
    collectMeasureReferenceNames(parsed.expression, names)
    for (const name of names) {
      const targetId = byLowerName.get(name)
      if (targetId) graph.get(measure.id)?.add(targetId)
    }
  }

  return graph
}

/** Detects a dependency cycle anywhere in the model's measures, including a direct self-reference (a 1-node cycle). */
export function detectMeasureDependencyCycle(model: SemanticModel): CycleResult {
  return detectCycle(buildMeasureDependencyGraph(model))
}
