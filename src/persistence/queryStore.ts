import { createStore, del, get, set } from 'idb-keyval'
import type { QueryDefinition } from '../domain/query'

const queryStore = createStore('bi-notebook-lab-queries', 'queries')

/**
 * Mirrors modelStore.ts: one entry per `QueryDefinition`, keyed by id. Only
 * the definition is persisted — never a step's evaluated output, which is
 * always re-derived on load (brief §49, §81; docs/POWER_QUERY_RUNTIME.md
 * "Definitions vs. results").
 */
export async function saveQuery(query: QueryDefinition): Promise<void> {
  await set(query.id, query, queryStore)
}

export async function loadQuery(queryId: string): Promise<QueryDefinition | undefined> {
  return get<QueryDefinition>(queryId, queryStore)
}

export async function loadQueries(queryIds: string[]): Promise<Record<string, QueryDefinition>> {
  const entries = await Promise.all(
    queryIds.map(async (id): Promise<[string, QueryDefinition] | undefined> => {
      const query = await loadQuery(id)
      return query ? [id, query] : undefined
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is [string, QueryDefinition] => entry !== undefined))
}

export async function deleteQuery(queryId: string): Promise<void> {
  await del(queryId, queryStore)
}
