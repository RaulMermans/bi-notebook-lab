/**
 * Deterministic fallback grid layout for a model table that has no saved
 * canvas `position` yet. Shared by `ModelCanvas` (Sprint 2) and the Sprint 6
 * Context Explorer's propagation diagram so a learner's own model layout is
 * reused everywhere instead of each surface inventing its own positions
 * (docs/CONTEXT_VISUALIZER.md "Reusing model layout").
 */
export function defaultTablePosition(index: number): { x: number; y: number } {
  return { x: (index % 3) * 260, y: Math.floor(index / 3) * 220 }
}
