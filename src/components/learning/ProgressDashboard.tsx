import { useMemo } from 'react'
import { useLearningProgress } from '../../runtime/learning/useLearningProgress'

/**
 * The learner dashboard (sprint brief "Progress View"). Shows aggregated
 * historical attempt data only — never a live `ValidationRun` — and no
 * gamification (XP/badges/leaderboards) per scope.
 */
export function ProgressDashboard() {
  const { status, lessons, summaries, totals } = useLearningProgress()
  const summaryByLesson = useMemo(() => Object.fromEntries(summaries.map((summary) => [summary.lessonId, summary])), [summaries])

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div>
          <span className="eyebrow">LEARNING</span>
          <h1>Progress</h1>
          <p>Your history across every lesson — historical attempts, not live validation state.</p>
        </div>
      </header>

      {status === 'loading' ? (
        <p className="workspace__status">Loading progress…</p>
      ) : (
        <>
          <div className="progress-totals">
            <div className="progress-total">
              <span className="progress-total__value">{totals.lessonsCompleted}</span>
              <span className="progress-total__label">Lessons completed</span>
            </div>
            <div className="progress-total">
              <span className="progress-total__value">{totals.lessonsStarted}</span>
              <span className="progress-total__label">Lessons started</span>
            </div>
            <div className="progress-total">
              <span className="progress-total__value">{totals.totalAttempts}</span>
              <span className="progress-total__label">Total attempts</span>
            </div>
          </div>

          <table className="progress-table">
            <thead>
              <tr>
                <th scope="col">Lesson</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Status</th>
                <th scope="col">Best score</th>
                <th scope="col">Attempts</th>
                <th scope="col">Last attempted</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson) => {
                const summary = summaryByLesson[lesson.definition.id]
                const completed = summary?.bestPassed ?? false
                const started = (summary?.attemptCount ?? 0) > 0
                const statusText = completed ? 'Completed' : started ? 'In progress' : 'Not started'
                return (
                  <tr key={lesson.definition.id}>
                    <th scope="row">{lesson.definition.title}</th>
                    <td>{lesson.definition.difficulty}</td>
                    <td>
                      <span className={`status-pill status-pill--${completed ? 'completed' : started ? 'in-progress' : 'not-started'}`}>{statusText}</span>
                    </td>
                    <td>{summary?.bestPercentage !== undefined ? `${Math.round(summary.bestPercentage)}%` : '—'}</td>
                    <td>{summary?.attemptCount ?? 0}</td>
                    <td>{summary?.lastAttemptedAt ? new Date(summary.lastAttemptedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
