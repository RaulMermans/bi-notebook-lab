import type { WorkspaceIntegrityIssue } from '../../runtime/integrity/types'

interface BlockedActionNoticeProps {
  title: string
  blockers: WorkspaceIntegrityIssue[]
}

/**
 * A consistent, learner-readable rendering of a blocked destructive
 * mutation (Sprint 16, brief Part F §34) — replaces the duplicated
 * `deleteWarning`/`removeWarning` ad hoc banners that used to build their
 * own message per card. `blocker.reason` is already a full sentence naming
 * the blocking entity by name, never a raw id (see
 * `runtime/integrity/mutationImpact.ts`).
 */
export function BlockedActionNotice({ title, blockers }: BlockedActionNoticeProps) {
  if (blockers.length === 0) return null

  return (
    <div className="blocked-action-notice" role="alert">
      <p className="blocked-action-notice__title">{title}</p>
      <ul className="blocked-action-notice__list">
        {blockers.map((blocker, index) => (
          <li key={index}>{blocker.reason}</li>
        ))}
      </ul>
    </div>
  )
}
