import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  body?: string
  children?: ReactNode
}

/**
 * A small contextual empty state for inside a cell/surface (Model with no
 * tables, Query with no steps, Context Explorer with no measure) — distinct
 * from the full-page `.empty-state` Free Lab shows before any cell exists.
 * Generalizes the copy the brief asks every surface to show instead of a
 * dead-looking blank panel (Sprint 16 Part C §17).
 */
export function EmptyState({ title, body, children }: EmptyStateProps) {
  return (
    <div className="empty-state-inline">
      <p className="empty-state-inline__title">{title}</p>
      {body && <p className="empty-state-inline__body">{body}</p>}
      {children}
    </div>
  )
}
