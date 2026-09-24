import { lazy, Suspense, useState } from 'react'
import { NotebookWorkspace } from './components/NotebookWorkspace'
import { getBuiltInLesson } from './data/lessons/lessonRegistry'
import './styles/app.css'

/** Sprint 16 Part E — Exercises/Progress are not needed on first paint of Free Lab (the default view), so they load on demand (brief §31). */
const LessonCatalog = lazy(() => import('./components/learning/LessonCatalog').then((m) => ({ default: m.LessonCatalog })))
const LessonWorkspace = lazy(() => import('./components/learning/LessonWorkspace').then((m) => ({ default: m.LessonWorkspace })))
const ProgressDashboard = lazy(() => import('./components/learning/ProgressDashboard').then((m) => ({ default: m.ProgressDashboard })))

type AppView = 'notebook' | 'exercises' | 'progress'

export default function App() {
  const [view, setView] = useState<AppView>('notebook')
  const [activeLessonId, setActiveLessonId] = useState<string | undefined>(undefined)

  function openLesson(lessonId: string) {
    setActiveLessonId(lessonId)
    setView('exercises')
  }

  function exitLesson() {
    setActiveLessonId(undefined)
  }

  function goTo(next: AppView) {
    if (next !== 'exercises') setActiveLessonId(undefined)
    setView(next)
  }

  const activeLesson = activeLessonId ? getBuiltInLesson(activeLessonId) : undefined

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">BI NOTEBOOK LAB</div>
        <nav>
          <button className={`nav-item${view === 'notebook' ? ' nav-item--active' : ''}`} onClick={() => goTo('notebook')}>
            Free Lab
          </button>
          <button className={`nav-item${view === 'exercises' ? ' nav-item--active' : ''}`} onClick={() => goTo('exercises')}>
            Exercises
          </button>
          <button className={`nav-item${view === 'progress' ? ' nav-item--active' : ''}`} onClick={() => goTo('progress')}>
            Progress
          </button>
        </nav>
      </aside>

      {view === 'notebook' && <NotebookWorkspace />}
      {view === 'exercises' && (
        <Suspense fallback={<p className="workspace__status">Loading…</p>}>
          {activeLesson ? <LessonWorkspace key={activeLesson.definition.id} lesson={activeLesson} onExit={exitLesson} /> : <LessonCatalog onOpenLesson={openLesson} />}
        </Suspense>
      )}
      {view === 'progress' && (
        <Suspense fallback={<p className="workspace__status">Loading…</p>}>
          <ProgressDashboard />
        </Suspense>
      )}
    </main>
  )
}
