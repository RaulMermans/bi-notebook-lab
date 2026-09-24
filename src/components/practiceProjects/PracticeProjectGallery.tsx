import { useState } from 'react'
import type { PracticeProjectDefinition } from '../../domain/practiceProject'
import { listPracticeProjects } from '../../data/practiceProjects/practiceProjectRegistry'

interface PracticeProjectGalleryProps {
  onStart: (project: PracticeProjectDefinition) => Promise<unknown>
}

/**
 * The "Practice projects" gallery (Sprint 16, brief Part B §11) — starting
 * templates for free experimentation, deliberately not scored lessons.
 * Mirrors `LessonCatalog.tsx`'s card grid pattern for visual consistency
 * between the two surfaces.
 */
export function PracticeProjectGallery({ onStart }: PracticeProjectGalleryProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const projects = listPracticeProjects()

  async function handleStart(project: PracticeProjectDefinition) {
    if (busyId) return
    setBusyId(project.id)
    try {
      await onStart(project)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="practice-project-gallery">
      <p className="practice-project-gallery__label">Practice projects</p>
      <div className="practice-project-grid">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className="practice-project-card"
            onClick={() => handleStart(project)}
            disabled={busyId !== null}
          >
            <h3>{project.title}</h3>
            <p className="practice-project-card__description">{project.description}</p>
            <ul className="practice-project-card__objectives">
              {project.objectives.slice(0, 3).map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
            {busyId === project.id && <span className="practice-project-card__status">Starting…</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
