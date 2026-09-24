import type { NotebookRuntimeSnapshot } from '../notebook/notebookRuntime'
import { cellReferenceIssues, modelReferenceIssues, queryReferenceIssues } from './workspaceReferences'
import type { WorkspaceIntegrityReport } from './types'

/**
 * The canonical structural-integrity check (brief Part A §1): every id a
 * notebook cell, `SemanticModel` object or `QueryDefinition` claims to
 * reference must resolve against the current snapshot. Never inspects
 * expression text — semantic (name-based) breakage is a separate, allowed
 * class of failure (see docs/WORKSPACE_INTEGRITY.md).
 */
export function validateWorkspaceIntegrity(snapshot: NotebookRuntimeSnapshot): WorkspaceIntegrityReport {
  const issues = [
    ...snapshot.notebook.cells.flatMap((cell) => cellReferenceIssues(cell, snapshot.datasets, snapshot.models, snapshot.queries)),
    ...Object.values(snapshot.models).flatMap((model) => modelReferenceIssues(model, snapshot.datasets)),
    ...Object.values(snapshot.queries).flatMap((query) => queryReferenceIssues(query, snapshot.datasets, snapshot.queries)),
  ]

  return { valid: issues.length === 0, issues }
}
