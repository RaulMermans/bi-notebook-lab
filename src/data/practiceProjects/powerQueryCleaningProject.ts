import type { PracticeProjectDefinition, PracticeProjectInitialState } from '../../domain/practiceProject'
import { generatePowerQueryLabDataset } from '../../lib/sample/generatePowerQueryLabDataset'
import { NotebookRuntime, emptyNotebook } from '../../runtime/notebook/notebookRuntime'

function build(): PracticeProjectInitialState {
  const runtime = new NotebookRuntime({ notebook: emptyNotebook('Power Query Cleaning'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  for (const dataset of generatePowerQueryLabDataset()) {
    runtime.importDataset(dataset)
  }

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models }
}

export const powerQueryCleaningProject: PracticeProjectDefinition = {
  id: 'practice-power-query-cleaning',
  title: 'Power Query Cleaning',
  description:
    'Deliberately messy raw tables and no queries yet — practice fixing types, filtering, removing duplicates, appending, merging, pivoting, unpivoting and custom columns.',
  objectives: ['Fix column types', 'Filter and remove duplicates', 'Merge or append two tables', 'Add a conditional or custom column'],
  initialize: build,
}
