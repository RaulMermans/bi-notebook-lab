import type { Dataset } from '../domain/data'
import type { SemanticModel } from '../domain/model'
import type { NumericTolerance, ValidationScalar } from '../domain/validation'
import type { FilterContext } from '../runtime/measure/filterContext'

/**
 * Sprint 15 — Semantic Conformance Suite (docs/SEMANTIC_CONFORMANCE.md).
 * Independent of the ~860 unit/integration tests: this corpus asks a
 * narrower, sharper question — "does the supported DAX subset behave the
 * way we claim it does?" — using expected values that are never computed
 * by the runtime under test (brief §24).
 */

export interface ConformanceModelFixture {
  model: SemanticModel
  datasets: Record<string, Dataset>
  /** Table the probe measure/calculated column is created on. Defaults to `model.tables[0].id`. */
  homeModelTableId?: string
}

export type ConformanceProvenance =
  /** Computed by hand from the fixture's raw rows — the default for this pass. */
  | 'hand-calculated'
  /** Derived directly from documented DAX semantics (e.g. "DIVIDE by zero returns the alternate") rather than arithmetic over fixture rows. */
  | 'documented-dax-semantics'
  /** Checked against a real Power BI Desktop/Fabric evaluation. Never use this label without having actually done that (brief §25) — no case in this initial pass carries it. */
  | 'power-bi-verified'

export interface KnownDivergence {
  /** Why the runtime intentionally (or not-yet-fixed-ly) differs from real DAX here. */
  reason: string
  trackingId?: string
}

export interface DaxConformanceCase {
  id: string
  category: string
  description: string
  fixture: ConformanceModelFixture
  expression: string
  evaluationMode: 'measure' | 'calculated-column'
  /** Measure mode only — the ambient FilterContext the probe measure evaluates under. */
  filterContext?: FilterContext
  /** Calculated-column mode compares against `values[0]` only — fixtures for that mode keep the relevant row first. */
  expected: ValidationScalar
  tolerance?: NumericTolerance
  provenance: ConformanceProvenance
  notes?: string
  /** Present only for a deliberate, documented divergence from real DAX — see brief §28. Never used to hide an unexplained mismatch. */
  knownDivergence?: KnownDivergence
}
