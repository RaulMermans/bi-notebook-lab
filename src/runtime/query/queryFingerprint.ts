import type { QueryDefinition, QueryStep } from '../../domain/query'
import { hashString } from '../../lib/hash'

/** Strips `id`/`name` — a step's user-facing label is editable without changing its semantic fingerprint (brief §105). */
function stepPayload(step: QueryStep): Record<string, unknown> {
  const payload = { ...step } as Record<string, unknown>
  delete payload.id
  delete payload.name
  return payload
}

/**
 * Deterministic over exactly source identity, step order/config, and the
 * (already-computed) fingerprints of any queries this one depends on.
 * Excludes `name`, `loadEnabled`, `createdAt`/`updatedAt`, and any UI-only
 * state (selected step, panel layout) — see docs/POWER_QUERY_RUNTIME.md
 * "Query fingerprint".
 */
export function computeQueryFingerprint(query: QueryDefinition, dependencyFingerprints: Record<string, string>): string {
  const payload = {
    source: query.source,
    steps: query.steps.map(stepPayload),
    dependencies: Object.keys(dependencyFingerprints)
      .sort()
      .map((id) => ({ id, fingerprint: dependencyFingerprints[id] })),
  }
  return hashString(JSON.stringify(payload))
}
