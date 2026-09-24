import { BUNDLE_FORMAT, BUNDLE_SCHEMA_VERSION, type BiLabProjectBundle, type BiLabProjectBundleMetadata } from '../../domain/bundle'
import { DATA_LIMITS, type Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { NotebookDocument } from '../../domain/notebook'
import type { QueryDefinition } from '../../domain/query'
import { hydrateSemanticModel } from '../model/modelRuntime'
import { evaluateAllQueries } from '../query/queryRuntime'
import { validateWorkspaceIntegrity } from '../integrity/workspaceIntegrity'
import type { WorkspaceIntegrityIssue } from '../integrity/types'
import type { NotebookRuntimeSnapshot } from '../notebook/notebookRuntime'

export interface ExportBundleOptions {
  projectId: string
  title: string
  description?: string
  createdAt: string
  appVersion?: string
}

/**
 * Builds the exportable bundle from the live workspace snapshot (brief Part
 * A §1). `queryEvaluations` is never included — it is always recomputed
 * after import, exactly like every other derived runtime cache. A dataset
 * produced by a query is likewise left out of `datasets`; it is
 * re-derived from `queries` by `buildSnapshotFromBundle` below.
 */
export function exportProjectBundle(snapshot: NotebookRuntimeSnapshot, options: ExportBundleOptions): BiLabProjectBundle {
  const metadata: BiLabProjectBundleMetadata = {
    projectId: options.projectId,
    title: options.title,
    description: options.description,
    createdAt: options.createdAt,
    exportedAt: new Date().toISOString(),
    appVersion: options.appVersion,
  }

  const rawDatasets = Object.values(snapshot.datasets).filter((dataset) => dataset.source.type !== 'query')

  return {
    format: BUNDLE_FORMAT,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    metadata,
    notebook: snapshot.notebook,
    datasets: rawDatasets,
    queries: Object.values(snapshot.queries),
    models: Object.values(snapshot.models),
  }
}

export function serializeProjectBundle(bundle: BiLabProjectBundle): string {
  return JSON.stringify(bundle, null, 2)
}

export type BundleLoadError =
  | { code: 'invalid-json'; message: string }
  | { code: 'not-a-project'; message: string }
  | { code: 'unsupported-schema-version'; message: string; foundVersion: number }
  | { code: 'structurally-invalid'; message: string }
  | { code: 'integrity-violation'; message: string; issues: WorkspaceIntegrityIssue[] }

export type BundleLoadResult =
  | { ok: true; bundle: BiLabProjectBundle; snapshot: NotebookRuntimeSnapshot }
  | { ok: false; error: BundleLoadError }

/** Structural-shape check only — never inspects cross-references (that is `validateWorkspaceIntegrity`'s job, run later against the reconstructed snapshot). */
function isStructurallyValid(value: unknown): value is BiLabProjectBundle {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.schemaVersion !== 'number') return false
  if (!candidate.metadata || typeof candidate.metadata !== 'object') return false
  if (!candidate.notebook || typeof candidate.notebook !== 'object') return false
  if (!Array.isArray((candidate.notebook as Record<string, unknown>).cells)) return false
  if (!Array.isArray(candidate.datasets)) return false
  if (!Array.isArray(candidate.queries)) return false
  if (!Array.isArray(candidate.models)) return false
  return true
}

/**
 * Identity passthrough for schema version 1 — the only version that exists
 * today. Future versions add their upgrade step here rather than scattering
 * `if (bundle.schemaVersion === ...)` checks across components (brief Part
 * A §3).
 */
export function migrateProjectBundle(bundle: BiLabProjectBundle): BiLabProjectBundle {
  return bundle
}

/**
 * Reconstructs a full `NotebookRuntimeSnapshot` from a bundle, mirroring
 * `NotebookRuntime`'s own hydration order exactly: hydrate every model
 * (`hydrateSemanticModel`, so a bundle exported by an older app version
 * still normalizes correctly), then re-evaluate every query and fold
 * load-enabled outputs into `datasets` — the same composition
 * `NotebookRuntime.reEvaluateQueries` performs internally, duplicated here
 * because that method is private to the live runtime instance.
 */
export function buildSnapshotFromBundle(bundle: BiLabProjectBundle): NotebookRuntimeSnapshot {
  const rawDatasets: Record<string, Dataset> = {}
  for (const dataset of bundle.datasets) rawDatasets[dataset.id] = dataset

  const queries: Record<string, QueryDefinition> = {}
  for (const query of bundle.queries) queries[query.id] = query

  const models: Record<string, SemanticModel> = {}
  for (const model of bundle.models) models[model.id] = hydrateSemanticModel(model)

  const queryEvaluations = evaluateAllQueries(queries, rawDatasets, DATA_LIMITS)
  const datasets = { ...rawDatasets }
  for (const query of Object.values(queries)) {
    if (!query.loadEnabled) continue
    const evaluation = queryEvaluations[query.id]
    if (evaluation.output) datasets[query.outputDatasetId] = evaluation.output
  }

  const notebook: NotebookDocument = bundle.notebook
  return { notebook, datasets, models, queries, queryEvaluations }
}

/**
 * The full import boundary (brief Part A §4): parse → structural validate →
 * schema-version check → migrate → reconstruct → integrity validate. Every
 * failure returns a learner-readable `message` — never a raw `JSON.parse`
 * error or an internal exception (brief §9). Never throws.
 */
export function loadProjectBundle(text: string): BundleLoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: { code: 'invalid-json', message: 'This file is not a BI Notebook Lab project.' } }
  }

  const candidate = raw as Record<string, unknown> | null
  if (!candidate || candidate.format !== BUNDLE_FORMAT) {
    return { ok: false, error: { code: 'not-a-project', message: 'This file is not a BI Notebook Lab project.' } }
  }

  if (!isStructurallyValid(candidate)) {
    return { ok: false, error: { code: 'structurally-invalid', message: 'This project file is damaged or incomplete and cannot be opened.' } }
  }

  const bundle = candidate as unknown as BiLabProjectBundle
  if (bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported-schema-version',
        foundVersion: bundle.schemaVersion,
        message: `This project uses schema version ${bundle.schemaVersion}. This version of BI Notebook Lab supports version ${BUNDLE_SCHEMA_VERSION}.`,
      },
    }
  }

  const migrated = migrateProjectBundle(bundle)
  const snapshot = buildSnapshotFromBundle(migrated)
  const report = validateWorkspaceIntegrity(snapshot)
  if (!report.valid) {
    const [first] = report.issues
    return {
      ok: false,
      error: {
        code: 'integrity-violation',
        issues: report.issues,
        message: `Project can't be opened because of a data problem: ${first.reason}`,
      },
    }
  }

  return { ok: true, bundle: migrated, snapshot }
}
