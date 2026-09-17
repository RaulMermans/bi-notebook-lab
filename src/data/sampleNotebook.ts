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
      id: 'data',
      kind: 'data',
      title: 'Dataset',
      prompt: 'Inspect the available tables and identify candidate keys.',
      meta: { tables: ['Customers', 'Products', 'Sales', 'Calendar'] },
    },
    {
      id: 'model',
      kind: 'model',
      title: 'Build the model',
      prompt: 'Create a star schema with Sales as the fact table.',
      status: 'idle',
    },
    {
      id: 'column',
      kind: 'calculated-column',
      title: 'Calculated Column',
      prompt: 'Create Sales[Margin] as Revenue minus Cost.',
      source: 'Margin = Sales[Revenue] - Sales[Cost]',
      status: 'idle',
    },
    {
      id: 'measure',
      kind: 'measure',
      title: 'Measure',
      prompt: 'Create Total Revenue.',
      source: 'Total Revenue = SUM(Sales[Revenue])',
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
