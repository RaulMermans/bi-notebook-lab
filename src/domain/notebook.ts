export type CellKind =
  | 'markdown'
  | 'data'
  | 'model'
  | 'calculated-column'
  | 'measure'
  | 'visual'
  | 'question'
  | 'test'

export type CellStatus = 'idle' | 'running' | 'passed' | 'failed'

export interface NotebookCell {
  id: string
  kind: CellKind
  title: string
  prompt?: string
  source?: string
  status?: CellStatus
  meta?: Record<string, unknown>
}

export interface NotebookDocument {
  id: string
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  cells: NotebookCell[]
}
