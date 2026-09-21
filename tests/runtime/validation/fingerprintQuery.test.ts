import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import type { ValidationSpec } from '../../../src/domain/validation'
import { computeValidationFingerprint } from '../../../src/runtime/validation/fingerprint'

function queryDataset(revision: string): Dataset {
  return {
    id: 'query-out-ds',
    name: 'Sales Clean',
    source: { type: 'query', queryId: 'q1', revision },
    tables: [
      {
        id: 'query-out-table',
        name: 'Sales Clean',
        columns: [{ id: 'c1', name: 'Revenue', dataType: 'decimal', nullable: false }],
        rows: [{ Revenue: 100 }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function model(): SemanticModel {
  const now = new Date().toISOString()
  return {
    id: 'model-1',
    name: 'Model',
    tables: [{ id: 'model-table-1', datasetId: 'query-out-ds', tableId: 'query-out-table', position: { x: 0, y: 0 } }],
    relationships: [],
    calculatedColumns: [],
    measures: [],
    dateTables: [],
    createdAt: now,
    updatedAt: now,
  }
}

const spec: ValidationSpec = { id: 'spec-1', title: 'Check', passingPercentage: 100, rules: [] }

describe('computeValidationFingerprint with a query-sourced table', () => {
  it('changes when the query revision changes, even though schema is identical', () => {
    const before = computeValidationFingerprint(model(), { 'query-out-ds': queryDataset('rev-1') }, spec)
    const after = computeValidationFingerprint(model(), { 'query-out-ds': queryDataset('rev-2') }, spec)
    expect(before).not.toBe(after)
  })

  it('is stable when the revision is unchanged', () => {
    const a = computeValidationFingerprint(model(), { 'query-out-ds': queryDataset('rev-1') }, spec)
    const b = computeValidationFingerprint(model(), { 'query-out-ds': queryDataset('rev-1') }, spec)
    expect(a).toBe(b)
  })
})
