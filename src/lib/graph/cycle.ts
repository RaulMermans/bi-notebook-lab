export interface CycleResult {
  found: boolean
  path: string[]
}

/**
 * Standard white/gray/black DFS cycle detection over a directed graph keyed
 * by string id. Shared by `runtime/model/graphAnalysis.ts` (relationship
 * cycles) and `runtime/measure/dependencyGraph.ts` (measure-reference
 * cycles) so cycle detection isn't reimplemented per graph domain.
 */
export function detectCycle(graph: Map<string, Set<string>>): CycleResult {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const node of graph.keys()) color.set(node, WHITE)

  const stack: string[] = []

  function visit(node: string): string[] | undefined {
    color.set(node, GRAY)
    stack.push(node)

    for (const neighbor of graph.get(node) ?? []) {
      const neighborColor = color.get(neighbor)
      if (neighborColor === GRAY) {
        const cycleStart = stack.indexOf(neighbor)
        return [...stack.slice(cycleStart), neighbor]
      }
      if (neighborColor === WHITE) {
        const found = visit(neighbor)
        if (found) return found
      }
    }

    stack.pop()
    color.set(node, BLACK)
    return undefined
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      const found = visit(node)
      if (found) return { found: true, path: found }
    }
  }

  return { found: false, path: [] }
}
