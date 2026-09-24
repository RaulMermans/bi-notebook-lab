import type { PracticeProjectDefinition, PracticeProjectInitialState } from '../../domain/practiceProject'
import { NotebookRuntime, emptyNotebook } from '../../runtime/notebook/notebookRuntime'
import {
  addRetailFoundationsSolution,
  buildRetailNotebookBase,
  connectRetailStarSchema,
  markRetailCalendarDateTable,
} from '../lessons/support/retailModelBuilder'

function build(): PracticeProjectInitialState {
  const runtime = new NotebookRuntime({ notebook: emptyNotebook('DAX Playground'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  const base = buildRetailNotebookBase(runtime)
  connectRetailStarSchema(runtime, base)
  addRetailFoundationsSolution(runtime, base)
  markRetailCalendarDateTable(runtime, base)

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models }
}

export const daxPlaygroundProject: PracticeProjectDefinition = {
  id: 'practice-dax-playground',
  title: 'DAX Playground',
  description:
    'A completed retail star schema with basic measures already in place — skip modeling and go straight to VAR/RETURN, CALCULATE, FILTER, iterators and time intelligence.',
  objectives: ['Write a VAR/RETURN measure', 'Use CALCULATE with a filter argument', 'Try a time-intelligence measure', 'Explore filter context in Context Explorer'],
  initialize: build,
}
