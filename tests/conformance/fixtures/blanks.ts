import type { Dataset } from '../../../src/domain/data'
import type { DaxConformanceCase } from '../../../src/conformance/types'
import { createModel, addTable } from '../../../src/runtime/model/modelRuntime'
import { buildSharedFixture } from './sharedFixture'

const fixture = buildSharedFixture()

/** A single-row, single-blank-column fixture — row 0 is exactly what the calculated-column cases below need. */
function blankRowFixture() {
  const dataset: Dataset = {
    id: 'blank-ds',
    name: 'BlankRows',
    source: { type: 'sample', key: 'blank-rows' },
    tables: [
      {
        id: 'blank-table',
        name: 'BlankRows',
        columns: [{ id: 'blank-value', name: 'Value', dataType: 'decimal', nullable: true }],
        rows: [{ Value: null }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
  let model = createModel()
  model = addTable(model, { datasetId: dataset.id, tableId: 'blank-table' })
  return { model, datasets: { [dataset.id]: dataset } }
}

const blankRow = blankRowFixture()

export const BLANK_CASES: DaxConformanceCase[] = [
  {
    id: 'blank-001',
    category: 'Blank semantics',
    description: 'SUM ignores a BLANK row instead of treating it as zero-that-still-counts',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 350, // 100 + 200 + 50, row 4's null excluded
    provenance: 'hand-calculated',
  },
  {
    id: 'blank-002',
    category: 'Blank semantics',
    description: 'AVERAGE divides by the count of non-blank rows only',
    fixture,
    expression: 'AVERAGE(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 116.666667, // 350 / 3, not 350 / 4
    tolerance: { type: 'absolute', value: 0.001 },
    provenance: 'hand-calculated',
  },
  {
    id: 'blank-003',
    category: 'Blank semantics',
    description: 'DIVIDE by zero with no alternate returns BLANK, not an error',
    fixture,
    expression: 'DIVIDE(10, 0)',
    evaluationMode: 'measure',
    expected: null,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'blank-004',
    category: 'Blank semantics',
    description: 'DIVIDE by zero with an alternate returns the alternate',
    fixture,
    expression: 'DIVIDE(10, 0, -1)',
    evaluationMode: 'measure',
    expected: -1,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'blank-005',
    category: 'Blank semantics',
    description: 'ISBLANK(BLANK()) is true',
    fixture,
    expression: 'ISBLANK(BLANK())',
    evaluationMode: 'measure',
    expected: true,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'blank-006',
    category: 'Blank semantics',
    description: 'ISBLANK(1) is false — a real value is never blank',
    fixture,
    expression: 'ISBLANK(1)',
    evaluationMode: 'measure',
    expected: false,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'blank-007',
    category: 'Blank semantics',
    description: 'A calculated column reading a null cell evaluates to BLANK, not zero or an error',
    fixture: blankRow,
    expression: 'ISBLANK(BlankRows[Value])',
    evaluationMode: 'calculated-column',
    expected: true,
    provenance: 'hand-calculated',
  },
  {
    id: 'blank-008',
    category: 'Blank semantics',
    description: 'BLANK() + 5 — real DAX coerces BLANK to 0 for addition; this engine propagates BLANK through every arithmetic operator uniformly',
    fixture,
    expression: 'BLANK() + 5',
    evaluationMode: 'measure',
    expected: 5,
    provenance: 'documented-dax-semantics',
    knownDivergence: {
      reason:
        'evaluator.ts/measureEvaluator.ts treat any BLANK operand of +,-,*,/ as producing BLANK, matching real DAX only for /. Real DAX coerces BLANK to 0 for + and -. Not yet changed — tracked as a documented runtime limitation rather than silently asserted as correct.',
    },
  },
]
