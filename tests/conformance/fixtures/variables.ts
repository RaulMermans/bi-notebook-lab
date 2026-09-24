import type { DaxConformanceCase } from '../../../src/conformance/types'
import { buildSharedFixture, SPAIN_FILTER } from './sharedFixture'

const fixture = buildSharedFixture()

/** VAR/RETURN (Sprint 15) — see docs/EXPRESSION_ENGINE.md "Variables". */
export const VARIABLE_CASES: DaxConformanceCase[] = [
  {
    id: 'variables-001',
    category: 'Variables',
    description: 'A single VAR computed from an aggregation',
    fixture,
    expression: 'VAR Revenue = SUM(Sales[Revenue]) RETURN Revenue',
    evaluationMode: 'measure',
    expected: 350,
    provenance: 'hand-calculated',
  },
  {
    id: 'variables-002',
    category: 'Variables',
    description: 'A later VAR references an earlier one',
    fixture,
    expression: 'VAR Revenue = SUM(Sales[Revenue])\nVAR Cost = SUM(Sales[Cost])\nVAR Margin = Revenue - Cost\nRETURN Margin',
    evaluationMode: 'measure',
    expected: 100, // 350 - 250
    provenance: 'hand-calculated',
  },
  {
    id: 'variables-003',
    category: 'Variables',
    description: 'DIVIDE composed from two variables (a realistic Gross Margin % pattern)',
    fixture,
    expression: 'VAR Revenue = SUM(Sales[Revenue])\nVAR Cost = SUM(Sales[Cost])\nRETURN DIVIDE(Revenue - Cost, Revenue)',
    evaluationMode: 'measure',
    expected: 100 / 350,
    tolerance: { type: 'absolute', value: 0.0001 },
    provenance: 'hand-calculated',
  },
  {
    id: 'variables-004',
    category: 'Variables',
    description: 'A VAR declared outside CALCULATE is captured once and stays immune to the inner filter context',
    fixture,
    expression: 'VAR Outer = SUM(Sales[Revenue]) RETURN CALCULATE(Outer, Customers[Country] = "Spain")',
    evaluationMode: 'measure',
    // Outer captures the UNFILTERED total (350) at declaration time — it must
    // not be re-evaluated under the inner Spain-only CALCULATE context (150).
    expected: 350,
    provenance: 'documented-dax-semantics',
    notes: 'This is the one rule Sprint 15 flagged as easy to invert by mistake — see measureEvaluator.ts evaluateCalculate\'s `variables: ctx.variables` (carried through, unlike `cache`).',
  },
  {
    id: 'variables-005',
    category: 'Variables',
    description: 'Variable names are case-insensitive on reference',
    fixture,
    expression: 'VAR Revenue = SUM(Sales[Revenue]) RETURN revenue',
    evaluationMode: 'measure',
    expected: 350,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'variables-006',
    category: 'Variables',
    description: 'A variable evaluated under an ambient filter context still reflects that context',
    fixture,
    expression: 'VAR Revenue = SUM(Sales[Revenue]) RETURN Revenue',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 150, // Customers 1 & 3, both Spain
    provenance: 'hand-calculated',
  },
  {
    id: 'variables-007',
    category: 'Variables',
    description: 'A VAR/RETURN block in a calculated column reads Table[Column] via row context',
    fixture,
    expression: 'VAR Margin = Sales[Revenue] - Sales[Cost] RETURN Margin',
    evaluationMode: 'calculated-column',
    expected: 40, // row 0: 100 - 60
    provenance: 'hand-calculated',
  },
  {
    id: 'variables-008',
    category: 'Variables',
    description: 'ISBLANK sees a variable holding BLANK correctly',
    fixture,
    expression: 'VAR x = BLANK() RETURN ISBLANK(x)',
    evaluationMode: 'measure',
    expected: true,
    provenance: 'documented-dax-semantics',
  },
]
