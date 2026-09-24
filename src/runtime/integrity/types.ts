/**
 * Sprint 15 — Workspace Referential Integrity. Shared shapes for the
 * structural-reference validator (`workspaceIntegrity.ts`) and the
 * pre-mutation impact analyzer (`mutationImpact.ts`). Mirrors the
 * `{severity, code, message, details?}` diagnostic shape already used by
 * `RelationshipDiagnostic`/`QueryDiagnostic`/`ExpressionDiagnostic` for
 * stylistic consistency — see docs/WORKSPACE_INTEGRITY.md.
 */

export type WorkspaceRefKind =
  | 'cell'
  | 'dataset'
  | 'model'
  | 'query'
  | 'model-table'
  | 'relationship'
  | 'calculated-column'
  | 'measure'
  | 'date-table'
  | 'dataset-table'
  | 'dataset-column'

export interface WorkspaceRef {
  kind: WorkspaceRefKind
  id: string
}

/**
 * A structural violation — a source object claims to reference a target
 * that does not exist. Never emitted for semantic/expression-text problems
 * (those stay in `ExpressionDiagnostic`s) — see docs/WORKSPACE_INTEGRITY.md
 * "Structural vs semantic invalidity".
 */
export interface WorkspaceIntegrityIssue {
  source: WorkspaceRef
  target: WorkspaceRef
  referenceType: string
  reason: string
  severity: 'error' | 'warning'
}

export interface WorkspaceIntegrityReport {
  valid: boolean
  issues: WorkspaceIntegrityIssue[]
}
