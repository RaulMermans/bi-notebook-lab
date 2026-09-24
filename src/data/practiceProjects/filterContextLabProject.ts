import type { PracticeProjectDefinition, PracticeProjectInitialState } from '../../domain/practiceProject'
import { NotebookRuntime, emptyNotebook } from '../../runtime/notebook/notebookRuntime'
import { addRetailFoundationsSolution, buildRetailNotebookBase, connectRetailStarSchema } from '../lessons/support/retailModelBuilder'

function build(): PracticeProjectInitialState {
  const runtime = new NotebookRuntime({ notebook: emptyNotebook('Filter Context Lab'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  const base = buildRetailNotebookBase(runtime)
  connectRetailStarSchema(runtime, base)
  addRetailFoundationsSolution(runtime, base)

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models }
}

export const filterContextLabProject: PracticeProjectDefinition = {
  id: 'practice-filter-context-lab',
  title: 'Filter Context Lab',
  description:
    'A working retail model with measures ready to go — built for practicing slicers, CALCULATE, USERELATIONSHIP/CROSSFILTER, and reading filter propagation in Context Explorer.',
  objectives: ['Add a slicer visual', 'Override filter context with CALCULATE', 'Use USERELATIONSHIP or CROSSFILTER', 'Trace propagation in Context Explorer'],
  initialize: build,
}
