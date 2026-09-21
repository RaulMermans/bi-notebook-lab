import type { QueryDefinition } from '../../domain/query'

/** Every other query `query` directly references — via `source`, a Merge's right side, or Append's sources. */
export function queryDependencyIds(query: QueryDefinition): string[] {
  const deps = new Set<string>()
  if (query.source.kind === 'query') deps.add(query.source.queryId)
  for (const step of query.steps) {
    if (step.kind === 'merge-queries' && step.right.kind === 'query') deps.add(step.right.queryId)
    if (step.kind === 'append-queries') {
      for (const source of step.sources) {
        if (source.kind === 'query') deps.add(source.queryId)
      }
    }
  }
  return [...deps]
}

export interface MissingQueryDependency {
  queryId: string
  missingDependencyId: string
}

export interface QueryGraphResult {
  /** Dependency-first evaluation order. Omits any query that is in a cycle, depends (directly or indirectly) on one, or depends on a missing query — fail closed (brief §5, §82: "Do not recursively evaluate indefinitely"). */
  order: string[]
  /** Each entry is one cycle, listed as the query ids in cycle order. */
  cycles: string[][]
  missing: MissingQueryDependency[]
  /** Every query id excluded from `order`, with why. */
  blocked: Set<string>
}

/**
 * Builds the query dependency DAG and returns a safe evaluation order.
 * Pure and framework-free (AGENTS.md "keep BI semantics outside React
 * components") — `queryRuntime.ts` is the only caller.
 */
export function buildQueryGraph(queries: Record<string, QueryDefinition>): QueryGraphResult {
  const deps = new Map<string, string[]>()
  for (const query of Object.values(queries)) deps.set(query.id, queryDependencyIds(query))

  const missing: MissingQueryDependency[] = []
  for (const [queryId, depIds] of deps) {
    for (const depId of depIds) {
      if (!queries[depId]) missing.push({ queryId, missingDependencyId: depId })
    }
  }
  const missingBy = new Map<string, true>()
  for (const m of missing) missingBy.set(m.queryId, true)

  const state = new Map<string, 'visiting' | 'done'>()
  const order: string[] = []
  const cycles: string[][] = []
  const blocked = new Set<string>()

  function visit(id: string, stack: string[]): boolean {
    const existing = state.get(id)
    if (existing === 'done') return blocked.has(id)
    if (existing === 'visiting') {
      const startIndex = stack.indexOf(id)
      const cyclePath = [...stack.slice(startIndex), id]
      cycles.push(cyclePath)
      for (const cycleId of stack.slice(startIndex)) blocked.add(cycleId)
      return true
    }

    state.set(id, 'visiting')
    let isBlocked = missingBy.has(id)
    for (const depId of deps.get(id) ?? []) {
      if (!queries[depId]) continue
      if (visit(depId, [...stack, id])) isBlocked = true
    }
    state.set(id, 'done')

    if (isBlocked) {
      blocked.add(id)
    } else {
      order.push(id)
    }
    return isBlocked
  }

  for (const id of Object.keys(queries)) {
    if (!state.has(id)) visit(id, [])
  }

  return { order, cycles, missing, blocked }
}
