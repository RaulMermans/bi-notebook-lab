import { useState } from 'react'

const DISMISSED_KEY = 'bi-notebook-lab:onboarding-dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Best-effort only — a viewer with storage blocked just sees the panel again next visit.
  }
}

/**
 * A small dismissible orientation panel (Sprint 16, brief Part C §16) — no
 * tour framework, no tooltip library, just five lines explaining the
 * workflow. Dismissal is a per-viewer UI convenience stored in
 * `localStorage`, not workspace state, so it never touches IndexedDB or the
 * notebook runtime.
 */
export function OnboardingPanel() {
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed) return null

  function dismiss() {
    writeDismissed()
    setDismissed(true)
  }

  return (
    <div className="onboarding-panel" role="note">
      <button type="button" className="onboarding-panel__dismiss" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      <p className="onboarding-panel__title">How this works</p>
      <ol className="onboarding-panel__steps">
        <li>Add or choose data</li>
        <li>Transform it with Power Query</li>
        <li>Build a semantic model</li>
        <li>Write DAX measures</li>
        <li>Create visuals</li>
      </ol>
      <p className="onboarding-panel__footnote">Exercises provides guided practice with automatic checking.</p>
    </div>
  )
}
