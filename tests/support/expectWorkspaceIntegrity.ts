import { validateWorkspaceIntegrity } from '../../src/runtime/integrity/workspaceIntegrity'
import type { NotebookRuntimeSnapshot } from '../../src/runtime/notebook/notebookRuntime'

/**
 * Test-only assertion helper (brief Part A §8): `expectWorkspaceIntegrity(
 * snapshot).toBeValid()` — use after every destructive-mutation test so the
 * invariant "every successful NotebookRuntime mutation leaves the workspace
 * structurally valid" stays enforced across the whole suite, not just the
 * dedicated integrity tests.
 */
export function expectWorkspaceIntegrity(snapshot: NotebookRuntimeSnapshot): { toBeValid(): void } {
  return {
    toBeValid() {
      const report = validateWorkspaceIntegrity(snapshot)
      if (!report.valid) {
        const details = report.issues
          .map((issue) => `  ${issue.source.kind}:${issue.source.id} -> ${issue.target.kind}:${issue.target.id} (${issue.referenceType}) ${issue.reason}`)
          .join('\n')
        throw new Error(`Workspace integrity violated:\n${details}`)
      }
    },
  }
}
