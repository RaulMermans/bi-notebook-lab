import type { CrossFilterDirection, RelationshipCardinality, RelationshipSide } from '../../domain/model'

/**
 * The canonical `1 → *` / `1 ↔ *` / `1 ↔ 1` / `* → *` / `* ← *` / `* ↔ *`
 * edge label (sprint brief §47) — one shared implementation for the Model
 * Canvas and the Context Explorer's propagation diagram, so the two never
 * drift (docs/ADVANCED_RELATIONSHIPS.md "Model Canvas").
 */
export function relationshipCardinalityLabel(
  cardinality: RelationshipCardinality,
  crossFilterDirection: CrossFilterDirection,
  oneSide?: RelationshipSide,
): string {
  if (cardinality === 'one-to-one') return '1 ↔ 1'

  if (cardinality === 'one-to-many') {
    const arrow = crossFilterDirection === 'both' ? '↔' : '→'
    return oneSide === 'right' ? `* ${arrow === '→' ? '←' : arrow} 1` : `1 ${arrow} *`
  }

  // many-to-many
  if (crossFilterDirection === 'both') return '* ↔ *'
  return crossFilterDirection === 'left-to-right' ? '* → *' : '* ← *'
}
