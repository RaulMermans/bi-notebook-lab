import type { NotebookDocument } from '../domain/notebook'

export const sampleNotebook: NotebookDocument = {
  id: 'retail-foundations',
  title: 'Retail Foundations',
  description: 'Learn the core BI flow: data → model → column → measure → validation.',
  difficulty: 'beginner',
  cells: [
    {
      id: 'intro',
      kind: 'markdown',
      title: 'Scenario',
      prompt: 'You are analyzing a retail business with Customers, Products, Sales and Calendar tables.',
    },
    {
      // Illustrative placeholder: this fixture is a lesson script, not
      // executable state, so these ids don't resolve to a real Dataset.
      id: 'data',
      kind: 'data',
      title: 'Dataset',
      datasetId: 'sample-retail-dataset',
      status: 'idle',
    },
    {
      // Illustrative placeholder: see note above — no real SemanticModel yet.
      id: 'model',
      kind: 'model',
      title: 'Build the model',
      modelId: 'sample-retail-model',
      status: 'idle',
    },
    {
      // Illustrative placeholder: see note above — no real CalculatedColumn yet.
      id: 'column',
      kind: 'calculated-column',
      title: 'Calculated Column',
      modelId: 'sample-retail-model',
      calculatedColumnId: 'sample-margin-column',
      status: 'idle',
    },
    {
      // Illustrative placeholder: see note above — no real Measure yet.
      id: 'measure',
      kind: 'measure',
      title: 'Total Revenue',
      modelId: 'sample-retail-model',
      measureId: 'sample-total-revenue-measure',
      status: 'idle',
    },
    {
      id: 'question',
      kind: 'question',
      title: 'Challenge',
      prompt: 'Why should Total Revenue be a measure instead of a calculated column?',
      status: 'idle',
    },
    {
      id: 'test',
      kind: 'test',
      title: 'Validation',
      prompt: 'The validation engine will check model structure and expected results.',
      status: 'idle',
    },
  ],
}
