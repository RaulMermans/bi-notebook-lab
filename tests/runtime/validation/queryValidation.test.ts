import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../src/domain/data'
import type { TestCell } from '../../../src/domain/notebook'
import type { QueryDefinition, QueryEvaluation } from '../../../src/domain/query'
import type { ValidationSpec } from '../../../src/domain/validation'
import { NotebookRuntime, emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'
import { isValidationRunStale } from '../../../src/runtime/validation/fingerprint'
import {
  evaluateQueryHealthRule,
  evaluateQueryOutputRowCountRule,
  evaluateQueryOutputSchemaRule,
  evaluateQueryOutputValueRule,
  evaluateQueryPresentRule,
  evaluateQueryStepSemanticsRule,
} from '../../../src/runtime/validation/queryValidation'
import { runValidation } from '../../../src/runtime/validation/validationEngine'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function query(overrides: Partial<QueryDefinition> = {}): QueryDefinition {
  const now = new Date().toISOString()
  return {
    id: 'q1',
    name: 'Customers_Clean',
    source: { kind: 'dataset-table', datasetId: 'ds', tableId: 'tbl' },
    steps: [],
    outputDatasetId: 'out-ds',
    outputTableId: 'out-table',
    loadEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function successfulEvaluation(overrides: Partial<QueryEvaluation> & { columns: DataColumn[]; rows: Record<string, unknown>[] }): QueryEvaluation {
  return {
    queryId: 'q1',
    status: 'success',
    output: {
      id: 'out-ds',
      name: 'Customers_Clean',
      source: { type: 'query', queryId: 'q1', revision: 'r1' },
      tables: [{ id: 'out-table', name: 'Customers_Clean', columns: overrides.columns, rows: overrides.rows, rowCount: overrides.rows.length }],
      createdAt: new Date().toISOString(),
    },
    stepResults: [],
    diagnostics: [],
    fingerprint: 'fp-1',
    ...overrides,
  }
}

describe('query-present', () => {
  it('passes when the query exists', () => {
    const result = evaluateQueryPresentRule(
      { id: 'r1', type: 'query-present', points: 10, title: 'Has Customers_Clean', query: { queryName: 'Customers_Clean' } },
      { q1: query() },
    )
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('fails (not errors) when the query does not exist yet', () => {
    const result = evaluateQueryPresentRule({ id: 'r1', type: 'query-present', points: 10, title: 'Has Customers_Clean', query: { queryName: 'Customers_Clean' } }, {})
    expect(result.status).toBe('failed')
    expect(result.pointsEarned).toBe(0)
  })
})

describe('query-health', () => {
  it('passes when the query evaluated successfully', () => {
    const result = evaluateQueryHealthRule(
      { id: 'r1', type: 'query-health', points: 10, title: 'Healthy', query: { queryName: 'Customers_Clean' } },
      { q1: query() },
      { q1: successfulEvaluation({ columns: [col('c1', 'CustomerID', 'integer')], rows: [{ CustomerID: 1 }] }) },
    )
    expect(result.status).toBe('passed')
  })

  it('fails with learner-facing diagnostic summaries when the query has an error', () => {
    const evaluation: QueryEvaluation = {
      queryId: 'q1',
      status: 'error',
      stepResults: [],
      diagnostics: [{ severity: 'error', code: 'QUERY_COLUMN_NOT_FOUND', message: 'A filter references a column that no longer exists.' }],
      fingerprint: 'fp-1',
    }
    const result = evaluateQueryHealthRule({ id: 'r1', type: 'query-health', points: 10, title: 'Healthy', query: { queryName: 'Customers_Clean' } }, { q1: query() }, { q1: evaluation })
    expect(result.status).toBe('failed')
    expect(result.feedback[0].message).toContain('column')
  })

  it('fails when the query has not been evaluated at all', () => {
    const result = evaluateQueryHealthRule({ id: 'r1', type: 'query-health', points: 10, title: 'Healthy', query: { queryName: 'Customers_Clean' } }, { q1: query() }, {})
    expect(result.status).toBe('failed')
  })
})

describe('query-output-schema', () => {
  const evaluations = { q1: successfulEvaluation({ columns: [col('c1', 'CustomerID', 'integer'), col('c2', 'RawCountry', 'string')], rows: [{ CustomerID: 1, RawCountry: 'es' }] }) }

  it('passes when every listed column exists with the expected type', () => {
    const result = evaluateQueryOutputSchemaRule(
      { id: 'r1', type: 'query-output-schema', points: 10, title: 'Schema', query: { queryName: 'Customers_Clean' }, columns: [{ name: 'CustomerID', dataType: 'integer' }] },
      { q1: query() },
      evaluations,
    )
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('gives partial credit and reports a missing column', () => {
    const result = evaluateQueryOutputSchemaRule(
      {
        id: 'r1',
        type: 'query-output-schema',
        points: 10,
        title: 'Schema',
        query: { queryName: 'Customers_Clean' },
        columns: [{ name: 'CustomerID', dataType: 'integer' }, { name: 'Country' }],
      },
      { q1: query() },
      evaluations,
    )
    expect(result.status).toBe('partial')
    expect(result.pointsEarned).toBe(5)
    expect(result.feedback.some((f) => f.code === 'QUERY_COLUMN_MISSING')).toBe(true)
  })

  it('reports a type mismatch', () => {
    const result = evaluateQueryOutputSchemaRule(
      { id: 'r1', type: 'query-output-schema', points: 10, title: 'Schema', query: { queryName: 'Customers_Clean' }, columns: [{ name: 'CustomerID', dataType: 'string' }] },
      { q1: query() },
      evaluations,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('QUERY_COLUMN_TYPE_MISMATCH')
  })

  it('asserts a column must be absent (e.g. a raw column that should have been renamed away)', () => {
    const passResult = evaluateQueryOutputSchemaRule(
      { id: 'r1', type: 'query-output-schema', points: 10, title: 'Schema', query: { queryName: 'Customers_Clean' }, columns: [{ name: 'NoSuchColumn', present: false }] },
      { q1: query() },
      evaluations,
    )
    expect(passResult.status).toBe('passed')

    const failResult = evaluateQueryOutputSchemaRule(
      { id: 'r1', type: 'query-output-schema', points: 10, title: 'Schema', query: { queryName: 'Customers_Clean' }, columns: [{ name: 'RawCountry', present: false }] },
      { q1: query() },
      evaluations,
    )
    expect(failResult.status).toBe('failed')
    expect(failResult.feedback[0].code).toBe('QUERY_COLUMN_SHOULD_BE_ABSENT')
  })
})

describe('query-output-row-count', () => {
  const evaluations = { q1: successfulEvaluation({ columns: [col('c1', 'CustomerID', 'integer')], rows: [{ CustomerID: 1 }, { CustomerID: 2 }, { CustomerID: 3 }] }) }

  it('supports equals', () => {
    const passRule = { id: 'r1', type: 'query-output-row-count' as const, points: 10, title: 'Count', query: { queryName: 'Customers_Clean' }, rowCount: { mode: 'equals' as const, value: 3 } }
    expect(evaluateQueryOutputRowCountRule(passRule, { q1: query() }, evaluations).status).toBe('passed')
    const failRule = { ...passRule, rowCount: { mode: 'equals' as const, value: 5 } }
    expect(evaluateQueryOutputRowCountRule(failRule, { q1: query() }, evaluations).status).toBe('failed')
  })

  it('supports minimum/maximum/range', () => {
    const base = { id: 'r1', type: 'query-output-row-count' as const, points: 10, title: 'Count', query: { queryName: 'Customers_Clean' } }
    expect(evaluateQueryOutputRowCountRule({ ...base, rowCount: { mode: 'minimum', value: 2 } }, { q1: query() }, evaluations).status).toBe('passed')
    expect(evaluateQueryOutputRowCountRule({ ...base, rowCount: { mode: 'minimum', value: 4 } }, { q1: query() }, evaluations).status).toBe('failed')
    expect(evaluateQueryOutputRowCountRule({ ...base, rowCount: { mode: 'maximum', value: 3 } }, { q1: query() }, evaluations).status).toBe('passed')
    expect(evaluateQueryOutputRowCountRule({ ...base, rowCount: { mode: 'range', min: 1, max: 5 } }, { q1: query() }, evaluations).status).toBe('passed')
    expect(evaluateQueryOutputRowCountRule({ ...base, rowCount: { mode: 'range', min: 10, max: 20 } }, { q1: query() }, evaluations).status).toBe('failed')
  })
})

describe('query-output-value', () => {
  const evaluations = {
    q1: successfulEvaluation({
      columns: [col('c1', 'CustomerID', 'integer'), col('c2', 'Country', 'string')],
      rows: [{ CustomerID: 42, Country: 'ES' }, { CustomerID: 7, Country: 'FR' }],
    }),
  }

  it('identifies a row semantically and compares an expected value, with numeric tolerance support', () => {
    const rule = {
      id: 'r1',
      type: 'query-output-value' as const,
      points: 10,
      title: 'Value check',
      query: { queryName: 'Customers_Clean' },
      cases: [{ id: 'c1', row: { columnName: 'CustomerID', equals: 42 }, expected: { columnName: 'Country', value: 'ES' } }],
    }
    const result = evaluateQueryOutputValueRule(rule, { q1: query() }, evaluations)
    expect(result.status).toBe('passed')
  })

  it('fails a case when the value does not match, without erroring the whole rule', () => {
    const rule = {
      id: 'r1',
      type: 'query-output-value' as const,
      points: 10,
      title: 'Value check',
      query: { queryName: 'Customers_Clean' },
      cases: [
        { id: 'c1', row: { columnName: 'CustomerID', equals: 42 }, expected: { columnName: 'Country', value: 'ES' } },
        { id: 'c2', row: { columnName: 'CustomerID', equals: 7 }, expected: { columnName: 'Country', value: 'ES' } },
      ],
    }
    const result = evaluateQueryOutputValueRule(rule, { q1: query() }, evaluations)
    expect(result.status).toBe('partial')
    expect(result.pointsEarned).toBe(5)
  })

  it('reports a row that cannot be found, distinct from a config error', () => {
    const rule = {
      id: 'r1',
      type: 'query-output-value' as const,
      points: 10,
      title: 'Value check',
      query: { queryName: 'Customers_Clean' },
      cases: [{ id: 'c1', row: { columnName: 'CustomerID', equals: 999 }, expected: { columnName: 'Country', value: 'ES' } }],
    }
    const result = evaluateQueryOutputValueRule(rule, { q1: query() }, evaluations)
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('QUERY_ROW_NOT_FOUND')
  })
})

describe('query-step-semantics', () => {
  const withSteps = query({
    steps: [
      { id: 's1', kind: 'filter-rows', name: 'Filtered Rows', logic: 'and', conditions: [{ columnId: 'c1', operator: 'greater-than', value: 0 }] },
      { id: 's2', kind: 'unpivot-columns', name: 'Make Months Long', mode: 'selected', columnIds: [], attributeColumnName: 'Month', attributeColumnId: 'a1', valueColumnName: 'Value', valueColumnId: 'v1' },
    ],
  })

  it('uses-step passes regardless of the step\'s display name', () => {
    const rule = { id: 'r1', type: 'query-step-semantics' as const, points: 10, title: 'Steps', query: { queryName: 'Customers_Clean' }, assertions: [{ kind: 'uses-step' as const, stepKind: 'unpivot-columns' as const }] }
    expect(evaluateQueryStepSemanticsRule(rule, { q1: withSteps }).status).toBe('passed')
  })

  it('does-not-use-step fails when the forbidden step kind is present', () => {
    const rule = { id: 'r1', type: 'query-step-semantics' as const, points: 10, title: 'Steps', query: { queryName: 'Customers_Clean' }, assertions: [{ kind: 'does-not-use-step' as const, stepKind: 'unpivot-columns' as const }] }
    expect(evaluateQueryStepSemanticsRule(rule, { q1: withSteps }).status).toBe('failed')
  })

  it('step-before checks relative order of two step kinds', () => {
    const okRule = {
      id: 'r1',
      type: 'query-step-semantics' as const,
      points: 10,
      title: 'Steps',
      query: { queryName: 'Customers_Clean' },
      assertions: [{ kind: 'step-before' as const, earlier: 'filter-rows' as const, later: 'unpivot-columns' as const }],
    }
    expect(evaluateQueryStepSemanticsRule(okRule, { q1: withSteps }).status).toBe('passed')

    const backwardsRule = { ...okRule, assertions: [{ kind: 'step-before' as const, earlier: 'unpivot-columns' as const, later: 'filter-rows' as const }] }
    expect(evaluateQueryStepSemanticsRule(backwardsRule, { q1: withSteps }).status).toBe('failed')
  })

  it('load-enabled checks the query\'s Enable Load flag', () => {
    const rule = { id: 'r1', type: 'query-step-semantics' as const, points: 10, title: 'Steps', query: { queryName: 'Customers_Clean' }, assertions: [{ kind: 'load-enabled' as const }] }
    expect(evaluateQueryStepSemanticsRule(rule, { q1: withSteps }).status).toBe('passed')
    expect(evaluateQueryStepSemanticsRule(rule, { q1: { ...withSteps, loadEnabled: false } }).status).toBe('failed')
  })
})

describe('direct query validation staleness (real runtime, real fingerprint)', () => {
  function buildWorkspace() {
    const runtime = new NotebookRuntime({
      notebook: emptyNotebook(),
      datasets: {
        'sales-ds': {
          id: 'sales-ds',
          name: 'Sales',
          source: { type: 'sample', key: 'sales' },
          tables: [
            {
              id: 'sales-table',
              name: 'Sales',
              columns: [{ id: 'c1', name: 'Revenue', dataType: 'decimal', nullable: false }],
              rows: [{ Revenue: 100 }, { Revenue: 1000 }],
              rowCount: 2,
            },
          ],
          createdAt: new Date().toISOString(),
        },
      },
      models: {},
      queries: {},
      queryEvaluations: {},
    })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table', 'SalesClean')
    runtime.addQueryStep(query.id, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'c1', operator: 'greater-than', value: 0 }] })
    return { runtime, queryId: query.id }
  }

  function specFor(): ValidationSpec {
    return {
      id: 'spec-1',
      title: 'Row count check',
      passingPercentage: 100,
      rules: [{ id: 'r1', type: 'query-output-row-count', points: 100, title: 'Has 2 rows', query: { queryName: 'SalesClean' }, rowCount: { mode: 'equals', value: 2 } }],
    }
  }

  /** A `'workspace'`-scoped TestCell needs no dummy Semantic Model at all — the core Sprint 14 requirement (brief "query-only checkpoints need no dummy model"). */
  it('a workspace-scoped checkpoint validates a query with no model in the notebook', () => {
    const { runtime } = buildWorkspace()
    const cell: TestCell = { id: 'cell-1', kind: 'test', title: 'Checkpoint', scope: { kind: 'workspace' }, validation: specFor() }
    const snapshot = runtime.getSnapshot()
    const run = runValidation(snapshot, cell)
    expect(run.passed).toBe(true)
  })

  it('a passing run goes STALE after the referenced query is edited (upstream semantic change)', () => {
    const { runtime, queryId } = buildWorkspace()
    const cell: TestCell = { id: 'cell-1', kind: 'test', title: 'Checkpoint', scope: { kind: 'workspace' }, validation: specFor() }
    const run = runValidation(runtime.getSnapshot(), cell)
    expect(run.passed).toBe(true)
    expect(isValidationRunStale(run, runtime.getSnapshot(), cell)).toBe(false)

    const filterStepId = runtime.getQuery(queryId)!.steps[0].id
    runtime.updateQueryStep(queryId, filterStepId, { conditions: [{ columnId: 'c1', operator: 'greater-than', value: 500 }] })

    expect(isValidationRunStale(run, runtime.getSnapshot(), cell)).toBe(true)
  })

  it('renaming a step never invalidates a PASS — only its semantics do', () => {
    const { runtime, queryId } = buildWorkspace()
    const cell: TestCell = { id: 'cell-1', kind: 'test', title: 'Checkpoint', scope: { kind: 'workspace' }, validation: specFor() }
    const run = runValidation(runtime.getSnapshot(), cell)

    const filterStepId = runtime.getQuery(queryId)!.steps[0].id
    runtime.renameQueryStep(queryId, filterStepId, 'My custom filter label')

    expect(isValidationRunStale(run, runtime.getSnapshot(), cell)).toBe(false)
  })

  it('editing the upstream dataset the query is sourced from also invalidates the run', () => {
    const { runtime, queryId } = buildWorkspace()
    const cell: TestCell = { id: 'cell-1', kind: 'test', title: 'Checkpoint', scope: { kind: 'workspace' }, validation: specFor() }
    const run = runValidation(runtime.getSnapshot(), cell)

    runtime.addQueryStep(queryId, { kind: 'sort-rows', keys: [{ columnId: 'c1', direction: 'desc' }] })

    expect(isValidationRunStale(run, runtime.getSnapshot(), cell)).toBe(true)
  })
})
