import type { PracticeProjectDefinition, PracticeProjectInitialState } from '../../domain/practiceProject'
import { generateRetailDataset } from '../../lib/sample/generateRetailDataset'
import { NotebookRuntime, emptyNotebook } from '../../runtime/notebook/notebookRuntime'

function build(): PracticeProjectInitialState {
  const runtime = new NotebookRuntime({ notebook: emptyNotebook('Retail Modeling'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  for (const dataset of generateRetailDataset()) {
    runtime.importDataset(dataset)
  }
  runtime.createModelCell('Retail Model')

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models }
}

export const retailModelingProject: PracticeProjectDefinition = {
  id: 'practice-retail-modeling',
  title: 'Retail Modeling',
  description: 'Raw retail tables with no relationships yet — build the star schema, add calculated columns and measures, then chart the results.',
  objectives: ['Connect Customers/Products/Calendar to Sales', 'Add a calculated column', 'Create your first measures', 'Build a visual'],
  initialize: build,
}
