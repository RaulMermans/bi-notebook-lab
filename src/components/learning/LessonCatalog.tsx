import { useMemo, useState } from 'react'
import type { LessonDifficulty } from '../../domain/learning'
import { useLearningProgress } from '../../runtime/learning/useLearningProgress'

interface LessonCatalogProps {
  onOpenLesson: (lessonId: string) => void
}

const DIFFICULTY_FILTERS: ('all' | LessonDifficulty)[] = ['all', 'beginner', 'intermediate', 'advanced']

function filterLabel(value: 'all' | LessonDifficulty): string {
  return value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * The lesson catalog (sprint brief "Exercises Navigation"). Difficulty
 * filtering only — no search infrastructure, since three built-in lessons
 * don't need one.
 */
export function LessonCatalog({ onOpenLesson }: LessonCatalogProps) {
  const { status, lessons, summaries } = useLearningProgress()
  const [filter, setFilter] = useState<'all' | LessonDifficulty>('all')

  const summaryByLesson = useMemo(() => Object.fromEntries(summaries.map((summary) => [summary.lessonId, summary])), [summaries])
  const visibleLessons = filter === 'all' ? lessons : lessons.filter((lesson) => lesson.definition.difficulty === filter)

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div>
          <span className="eyebrow">LEARNING</span>
          <h1>Exercises</h1>
          <p>Structured lessons that walk through a real BI workflow, checkpoint by checkpoint.</p>
        </div>
      </header>

      <div className="catalog-filters" role="tablist" aria-label="Filter lessons by difficulty">
        {DIFFICULTY_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={`filter-chip${filter === value ? ' filter-chip--active' : ''}`}
            onClick={() => setFilter(value)}
          >
            {filterLabel(value)}
          </button>
        ))}
      </div>

      {status === 'loading' ? (
        <p className="workspace__status">Loading lessons…</p>
      ) : (
        <div className="lesson-grid">
          {visibleLessons.map((lesson) => {
            const summary = summaryByLesson[lesson.definition.id]
            const completed = summary?.bestPassed ?? false
            const started = (summary?.attemptCount ?? 0) > 0
            const statusText = completed ? 'Completed' : started ? 'In progress' : 'Not started'

            return (
              <button
                key={lesson.definition.id}
                type="button"
                className={`lesson-card${completed ? ' lesson-card--completed' : ''}`}
                onClick={() => onOpenLesson(lesson.definition.id)}
              >
                <div className="lesson-card__header">
                  <h2>{lesson.definition.title}</h2>
                  <span className={`difficulty-badge difficulty-badge--${lesson.definition.difficulty}`}>{lesson.definition.difficulty}</span>
                </div>
                <p className="lesson-card__description">{lesson.definition.description}</p>
                {lesson.definition.estimatedMinutes !== undefined && <p className="lesson-card__meta">{lesson.definition.estimatedMinutes} min</p>}
                <ul className="lesson-card__objectives">
                  {lesson.definition.objectives.slice(0, 3).map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ul>
                <div className="lesson-card__footer">
                  <span className={`status-pill status-pill--${completed ? 'completed' : started ? 'in-progress' : 'not-started'}`}>{statusText}</span>
                  {summary?.bestPercentage !== undefined && <span className="lesson-card__best">Best: {Math.round(summary.bestPercentage)}%</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
