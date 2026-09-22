import { useState } from 'react'
import { NotebookWorkspace } from './components/NotebookWorkspace'
import { LessonCatalog } from './components/learning/LessonCatalog'
import { LessonWorkspace } from './components/learning/LessonWorkspace'
import { ProgressDashboard } from './components/learning/ProgressDashboard'
import { getBuiltInLesson } from './data/lessons/lessonRegistry'
import './styles/app.css'

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
            Notebook
          </button>
          <button className="nav-item">Datasets</button>
          <button className={`nav-item${view === 'exercises' ? ' nav-item--active' : ''}`} onClick={() => goTo('exercises')}>
            Exercises
          </button>
          <button className={`nav-item${view === 'progress' ? ' nav-item--active' : ''}`} onClick={() => goTo('progress')}>
            Progress
          </button>
        </nav>
      </aside>

      {view === 'notebook' && <NotebookWorkspace />}
      {view === 'exercises' &&
        (activeLesson ? <LessonWorkspace key={activeLesson.definition.id} lesson={activeLesson} onExit={exitLesson} /> : <LessonCatalog onOpenLesson={openLesson} />)}
      {view === 'progress' && <ProgressDashboard />}
    </main>
  )
}
