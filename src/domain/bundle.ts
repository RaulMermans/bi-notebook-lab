import type { Dataset } from './data'
import type { SemanticModel } from './model'
import type { NotebookDocument } from './notebook'
import type { QueryDefinition } from './query'

/**
 * Sprint 16 — the portable project format (`.bilab.json`). A learner's work
 * must be able to leave IndexedDB: exported, downloaded, stored in GitHub,
 * shared, imported. This is a learner/project format, not a Lesson
 * Authoring format (AGENTS.md guardrail #8 keeps lessons as code-owned
 * `LessonDefinition` objects) — see docs/PROJECT_BUNDLE.md.
 */
export const BUNDLE_FORMAT = 'bi-notebook-lab-project' as const

/** Only version 1 exists today. Bump when the bundle shape changes, and add the upgrade path to `migrateProjectBundle` (bundleCodec.ts) rather than branching on version elsewhere. */
export const BUNDLE_SCHEMA_VERSION = 1 as const

export interface BiLabProjectBundleMetadata {
  projectId: string
  title: string
  description?: string
  /** When the project was first created (stable across every re-export). */
  createdAt: string
  /** When this specific bundle file was produced — the only field a semantic round-trip comparison should ignore. */
  exportedAt: string
  appVersion?: string
}

/**
 * The full exported snapshot of a workspace. Deliberately excludes
 * `QueryEvaluation`/`ValidationRun`/execution results/runtime caches — those
 * are always recomputed after import (brief Part A §1). Canonical ids for
 * every entity (Dataset, DataTable, DataColumn, Query, Model, ModelTable,
 * Relationship, CalculatedColumn, Measure, Visual, NotebookCell, TestCell)
 * are preserved as-is; import never regenerates them (brief §2).
 */
export interface BiLabProjectBundle {
  format: typeof BUNDLE_FORMAT
  schemaVersion: number
  metadata: BiLabProjectBundleMetadata
  notebook: NotebookDocument
  /**
   * Raw imported datasets only — a dataset whose `source.type === 'query'`
   * is a Power Query output and is re-derived from `queries` on import, not
   * serialized redundantly here.
   */
  datasets: Dataset[]
  queries: QueryDefinition[]
  models: SemanticModel[]
}
