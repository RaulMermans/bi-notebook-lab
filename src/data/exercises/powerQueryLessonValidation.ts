import type { ValidationSpec } from '../../domain/validation'

/**
 * Sprint 14's Power Query lesson checkpoints — four independent
 * `ValidationSpec`s, one per checkpoint stage, all `'workspace'`-scoped
 * (no Semantic Model exists anywhere in this lesson). See
 * `src/data/lessons/powerQueryLesson.ts` and docs/QUERY_VALIDATION.md.
 */

export const customersCleanValidationSpec: ValidationSpec = {
  id: 'power-query-customers-clean',
  title: 'Clean Customers',
  passingPercentage: 100,
  rules: [
    { id: 'pq-customers-present', type: 'query-present', points: 20, title: 'Customers_Clean exists', query: { queryName: 'Customers_Clean' } },
    {
      id: 'pq-customers-schema',
      type: 'query-output-schema',
      points: 30,
      title: 'CustomerID is a whole number',
      query: { queryName: 'Customers_Clean' },
      columns: [{ name: 'CustomerID', dataType: 'integer' }],
    },
    {
      id: 'pq-customers-rowcount',
      type: 'query-output-row-count',
      points: 50,
      title: 'Blank and duplicate customers are removed',
      query: { queryName: 'Customers_Clean' },
      rowCount: { mode: 'equals', value: 100 },
    },
  ],
}

export const monthlyTargetsValidationSpec: ValidationSpec = {
  id: 'power-query-monthly-targets',
  title: 'Reshape Monthly Targets',
  passingPercentage: 100,
  rules: [
    { id: 'pq-targets-present', type: 'query-present', points: 15, title: 'Monthly_Targets_Long exists', query: { queryName: 'Monthly_Targets_Long' } },
    {
      id: 'pq-targets-unpivot',
      type: 'query-step-semantics',
      points: 15,
      title: 'Uses Unpivot Columns',
      query: { queryName: 'Monthly_Targets_Long' },
      assertions: [{ kind: 'uses-step', stepKind: 'unpivot-columns' }],
    },
    {
      id: 'pq-targets-schema',
      type: 'query-output-schema',
      points: 30,
      title: 'Month/Target columns exist',
      query: { queryName: 'Monthly_Targets_Long' },
      columns: [
        { name: 'Product', dataType: 'string' },
        { name: 'Month', dataType: 'string' },
        { name: 'Target', dataType: 'integer' },
      ],
    },
    {
      id: 'pq-targets-rowcount',
      type: 'query-output-row-count',
      points: 15,
      title: 'One row per product per month',
      query: { queryName: 'Monthly_Targets_Long' },
      rowCount: { mode: 'equals', value: 12 },
    },
    {
      id: 'pq-targets-value',
      type: 'query-output-value',
      points: 25,
      title: 'Product A / February target is correct',
      query: { queryName: 'Monthly_Targets_Long' },
      cases: [{ id: 'feb-target', title: 'Target 120 is February', row: { columnName: 'Target', equals: 120 }, expected: { columnName: 'Month', value: 'Feb' } }],
    },
  ],
}

export const salesAnalyticalColumnsValidationSpec: ValidationSpec = {
  id: 'power-query-sales-analytical',
  title: 'Analytical Columns',
  passingPercentage: 100,
  rules: [
    { id: 'pq-sales-present', type: 'query-present', points: 10, title: 'Sales_Clean exists', query: { queryName: 'Sales_Clean' } },
    {
      id: 'pq-sales-steps',
      type: 'query-step-semantics',
      points: 45,
      title: 'Appends Jan+Feb, adds Conditional and Custom columns',
      query: { queryName: 'Sales_Clean' },
      assertions: [
        { kind: 'uses-step', stepKind: 'append-queries' },
        { kind: 'uses-step', stepKind: 'conditional-column' },
        { kind: 'uses-step', stepKind: 'custom-column' },
      ],
    },
    {
      id: 'pq-sales-schema',
      type: 'query-output-schema',
      points: 30,
      title: 'RevenueBand and RevenuePerUnit exist',
      query: { queryName: 'Sales_Clean' },
      columns: [
        { name: 'RevenueBand', dataType: 'string' },
        { name: 'RevenuePerUnit', dataType: 'decimal' },
      ],
    },
    {
      id: 'pq-sales-rowcount',
      type: 'query-output-row-count',
      points: 15,
      title: 'Jan + Feb rows are both present',
      query: { queryName: 'Sales_Clean' },
      rowCount: { mode: 'equals', value: 300 },
    },
  ],
}

export const modelReadyOutputValidationSpec: ValidationSpec = {
  id: 'power-query-model-ready',
  title: 'Model-Ready Output',
  passingPercentage: 100,
  rules: [
    { id: 'pq-final-health-customers', type: 'query-health', points: 15, title: 'Customers_Clean evaluates cleanly', query: { queryName: 'Customers_Clean' } },
    { id: 'pq-final-health-targets', type: 'query-health', points: 15, title: 'Monthly_Targets_Long evaluates cleanly', query: { queryName: 'Monthly_Targets_Long' } },
    { id: 'pq-final-health-sales', type: 'query-health', points: 15, title: 'Sales_Clean evaluates cleanly', query: { queryName: 'Sales_Clean' } },
    {
      id: 'pq-final-load-customers',
      type: 'query-step-semantics',
      points: 15,
      title: 'Customers_Clean feeds the model',
      query: { queryName: 'Customers_Clean' },
      assertions: [{ kind: 'load-enabled' }],
    },
    {
      id: 'pq-final-load-targets',
      type: 'query-step-semantics',
      points: 15,
      title: 'Monthly_Targets_Long feeds the model',
      query: { queryName: 'Monthly_Targets_Long' },
      assertions: [{ kind: 'load-enabled' }],
    },
    {
      id: 'pq-final-load-sales',
      type: 'query-step-semantics',
      points: 15,
      title: 'Sales_Clean feeds the model',
      query: { queryName: 'Sales_Clean' },
      assertions: [{ kind: 'load-enabled' }],
    },
    {
      id: 'pq-final-schema-sanity',
      type: 'query-output-schema',
      points: 10,
      title: 'Analytical columns still present',
      query: { queryName: 'Sales_Clean' },
      columns: [
        { name: 'RevenueBand', dataType: 'string' },
        { name: 'RevenuePerUnit', dataType: 'decimal' },
      ],
    },
  ],
}
