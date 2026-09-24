/**
 * Sprint 16 Part D — performance benchmark harness (brief §18-22). A
 * repeatable measurement script, deliberately separate from `npm test`'s
 * strict-assertion suite (`vitest run tests/performance` is NOT part of the
 * default `npm test` glob since this file is not named `*.test.ts`) — machine
 * speed varies, so this produces a report instead of pass/fail assertions.
 *
 * Run with: `npm run benchmark` (== `vite-node tests/performance/benchmark.ts`).
 *
 * Every operation below goes through the same headless, framework-free
 * runtime entry points the rest of the app uses (AGENTS.md guardrail #3) —
 * no browser, no React.
 */
import { performance } from 'node:perf_hooks'
import { DATA_LIMITS, type Dataset } from '../../src/domain/data'
import type { ValidationSpec } from '../../src/domain/validation'
import { generateRetailDataset } from '../../src/lib/sample/generateRetailDataset'
import { NotebookRuntime, emptyNotebook } from '../../src/runtime/notebook/notebookRuntime'
import { evaluateCalculatedColumn } from '../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { evaluateMeasure } from '../../src/runtime/measure/measureEvaluator'
import { evaluateAllQueries } from '../../src/runtime/query/queryRuntime'
import { analyzeMeasureContext } from '../../src/runtime/context/contextAnalysis'
import { runValidation } from '../../src/runtime/validation/validationEngine'
import type { NewStepInput } from '../../src/runtime/query/queryStepFactory'

const ROW_COUNTS = [1_000, 10_000, 50_000, 100_000]

function bucket(ms: number): string {
  if (ms < 100) return 'immediate'
  if (ms < 500) return 'acceptable'
  if (ms < 1000) return 'noticeable'
  return 'BLOCKING CANDIDATE'
}

function time<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = fn()
  const ms = performance.now() - start
  return { result, ms }
}

function findColumnId(dataset: Dataset, columnName: string): string {
  const column = dataset.tables[0].columns.find((c) => c.name === columnName)
  if (!column) throw new Error(`Column "${columnName}" not found on dataset "${dataset.name}"`)
  return column.id
}

interface Measurement {
  category: string
  operation: string
  rowCount: number
  ms: number
}

const measurements: Measurement[] = []

function record(category: string, operation: string, rowCount: number, ms: number): void {
  measurements.push({ category, operation, rowCount, ms })
}

function runForRowCount(salesCount: number): void {
  const genTiming = time(() => generateRetailDataset({ salesCount }))
  record('Data', 'Generate + type Sales table', salesCount, genTiming.ms)
  const [customersDs, productsDs, salesDs, calendarDs] = genTiming.result

  const runtime = new NotebookRuntime({ notebook: emptyNotebook('Benchmark'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  runtime.importDataset(customersDs)
  runtime.importDataset(productsDs)
  runtime.importDataset(salesDs)
  runtime.importDataset(calendarDs)

  const { model: emptyModel } = runtime.createModelCell('Benchmark Model')
  runtime.addTableToModel(emptyModel.id, { datasetId: customersDs.id, tableId: customersDs.tables[0].id })
  runtime.addTableToModel(emptyModel.id, { datasetId: productsDs.id, tableId: productsDs.tables[0].id })
  runtime.addTableToModel(emptyModel.id, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
  runtime.addTableToModel(emptyModel.id, { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id })
  const modelId = emptyModel.id
  const salesTableId = runtime.getModel(modelId)!.tables.find((t) => t.datasetId === salesDs.id)!.id

  runtime.createRelationship(modelId, {
    left: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: findColumnId(customersDs, 'CustomerID') },
    right: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumnId(salesDs, 'CustomerID') },
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: true,
  })
  runtime.createRelationship(modelId, {
    left: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumnId(productsDs, 'ProductID') },
    right: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumnId(salesDs, 'ProductID') },
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: true,
  })
  runtime.createRelationship(modelId, {
    left: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumnId(calendarDs, 'Date') },
    right: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumnId(salesDs, 'Date') },
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: true,
  })
  const calendarModelTableId = runtime.getModel(modelId)!.tables.find((t) => t.datasetId === calendarDs.id)!.id
  runtime.markDateTable(modelId, calendarModelTableId, {
    datasetId: calendarDs.id,
    tableId: calendarDs.tables[0].id,
    columnId: findColumnId(calendarDs, 'Date'),
  })

  // --- Calculated columns ---
  const arithmeticResult = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
  const relatedResult = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'ProductCategory', expression: 'RELATED(Products[Category])' })
  const model = runtime.getModel(modelId)!
  const datasets = runtime.getSnapshot().datasets

  if (arithmeticResult.calculatedColumn) {
    const t = time(() => evaluateCalculatedColumn(model, datasets, arithmeticResult.calculatedColumn!.id))
    record('Calculated Columns', 'Simple arithmetic', salesCount, t.ms)
  }
  if (relatedResult.calculatedColumn) {
    const t = time(() => evaluateCalculatedColumn(model, datasets, relatedResult.calculatedColumn!.id))
    record('Calculated Columns', 'RELATED', salesCount, t.ms)
  }

  // --- Measures ---
  const measureDefs: { name: string; expression: string }[] = [
    { name: 'Bench Sum', expression: 'SUM(Sales[Revenue])' },
    { name: 'Bench DistinctCount', expression: 'DISTINCTCOUNT(Sales[CustomerID])' },
    { name: 'Bench SumX', expression: 'SUMX(Sales, Sales[Quantity] * Sales[Revenue])' },
    { name: 'Bench Filter', expression: 'CALCULATE(SUM(Sales[Revenue]), FILTER(Sales, Sales[Quantity] > 5))' },
    { name: 'Bench Calculate', expression: 'CALCULATE(SUM(Sales[Revenue]), Sales[Quantity] > 5)' },
    { name: 'Bench Time Intelligence', expression: 'CALCULATE(SUM(Sales[Revenue]), SAMEPERIODLASTYEAR(Calendar[Date]))' },
  ]
  const measureIds: Record<string, string> = {}
  for (const def of measureDefs) {
    const result = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: def.name, expression: def.expression })
    if (result.measure) measureIds[def.name] = result.measure.id
  }
  const modelWithMeasures = runtime.getModel(modelId)!
  for (const def of measureDefs) {
    const measureId = measureIds[def.name]
    if (!measureId) continue
    const t = time(() => evaluateMeasure(modelWithMeasures, datasets, measureId))
    record('Measures', def.name.replace('Bench ', ''), salesCount, t.ms)
  }

  // --- Context Explorer (filter propagation analysis) ---
  const sumMeasureId = measureIds['Bench Sum']
  if (sumMeasureId) {
    const t = time(() =>
      analyzeMeasureContext({
        model: modelWithMeasures,
        datasets,
        measureId: sumMeasureId,
        filterContext: { filters: [{ column: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumnId(productsDs, 'Category') }, operator: 'equals', values: ['Electronics'] }] },
      }),
    )
    record('Context Explorer', 'Filter propagation analysis', salesCount, t.ms)
  }

  // --- Power Query ---
  const salesColumnIds = {
    quantity: findColumnId(salesDs, 'Quantity'),
    revenue: findColumnId(salesDs, 'Revenue'),
    cost: findColumnId(salesDs, 'Cost'),
    customerId: findColumnId(salesDs, 'CustomerID'),
  }

  function benchQueryStep(label: string, input: NewStepInput): void {
    const { query } = runtime.createQueryFromDataset(salesDs.id, salesDs.tables[0].id, `Bench ${label}`)
    runtime.addQueryStep(query.id, input)
    const updated = runtime.getQuery(query.id)!
    const t = time(() => evaluateAllQueries({ [updated.id]: updated }, runtime.getSnapshot().datasets, DATA_LIMITS))
    record('Power Query', label, salesCount, t.ms)
  }

  benchQueryStep('Filter', { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: salesColumnIds.quantity, operator: 'greater-than', value: 5 }] })
  benchQueryStep('Remove duplicates', { kind: 'remove-duplicates', columnIds: [salesColumnIds.customerId] })
  benchQueryStep('Group by', {
    kind: 'group-by',
    groupColumnIds: [salesColumnIds.customerId],
    aggregations: [{ outputName: 'TotalRevenue', function: 'sum', sourceColumnId: salesColumnIds.revenue }],
  })
  benchQueryStep('Unpivot', { kind: 'unpivot-columns', mode: 'selected', columnIds: [salesColumnIds.quantity, salesColumnIds.revenue, salesColumnIds.cost], attributeColumnName: 'Metric', valueColumnName: 'Value' })
  benchQueryStep('Custom column', { kind: 'custom-column', outputName: 'Total', expression: '[Quantity] * [Revenue]' })

  // --- Validation ---
  const validationSpec: ValidationSpec = {
    id: 'bench-retail-checkpoint',
    title: 'Benchmark Retail Checkpoint',
    passingPercentage: 100,
    rules: [
      { id: 'r1', type: 'model-health', points: 10, title: 'Model health', requireValidGraph: true, requireStarSchema: true },
      { id: 'r2', type: 'table-present', points: 10, title: 'Sales present', table: { tableName: 'Sales' } },
      {
        id: 'r3',
        type: 'measure-result',
        points: 20,
        title: 'Total revenue',
        measure: { name: 'Bench Sum' },
        cases: [{ id: 'c1', title: 'No filter', filters: [], expected: 0 }],
      },
    ],
  }
  const validationSnapshot = { datasets: runtime.getSnapshot().datasets, models: runtime.getSnapshot().models, queries: runtime.getSnapshot().queries, queryEvaluations: runtime.getSnapshot().queryEvaluations }
  const fullCheckpointTiming = time(() =>
    runValidation(validationSnapshot, { id: 'bench-test-cell', kind: 'test', title: 'Bench', scope: { kind: 'model', modelId }, validation: validationSpec, status: 'idle' }),
  )
  record('Validation', 'Full Retail checkpoint', salesCount, fullCheckpointTiming.ms)

  const [firstQueryId] = Object.keys(runtime.getSnapshot().queries)
  if (firstQueryId) {
    const queryCheckpointSpec: ValidationSpec = {
      id: 'bench-query-checkpoint',
      title: 'Benchmark Query Checkpoint',
      passingPercentage: 100,
      rules: [{ id: 'q1', type: 'query-output-row-count', points: 10, title: 'Has rows', query: { queryName: runtime.getQuery(firstQueryId)!.name }, rowCount: { mode: 'minimum', value: 1 } }],
    }
    const t = time(() =>
      runValidation(validationSnapshot, { id: 'bench-query-test-cell', kind: 'test', title: 'Bench Query', scope: { kind: 'workspace' }, validation: queryCheckpointSpec, status: 'idle' }),
    )
    record('Validation', 'Query checkpoint', salesCount, t.ms)
  }
}

function main(): void {
  console.log('BI Notebook Lab Performance Profile\n')
  for (const rowCount of ROW_COUNTS) {
    console.log(`Running benchmarks at ${rowCount.toLocaleString()} rows...`)
    runForRowCount(rowCount)
  }

  const categories = [...new Set(measurements.map((m) => m.category))]
  for (const category of categories) {
    console.log(`\n## ${category}\n`)
    const operations = [...new Set(measurements.filter((m) => m.category === category).map((m) => m.operation))]
    const header = ['Operation', ...ROW_COUNTS.map((r) => `${(r / 1000).toFixed(0)}k`)]
    console.log(header.join(' | '))
    for (const operation of operations) {
      const row = ROW_COUNTS.map((rowCount) => {
        const m = measurements.find((x) => x.category === category && x.operation === operation && x.rowCount === rowCount)
        return m ? `${m.ms.toFixed(1)}ms (${bucket(m.ms)})` : '—'
      })
      console.log([operation, ...row].join(' | '))
    }
  }

  const blocking = measurements.filter((m) => m.ms >= 1000)
  console.log(`\n${blocking.length} operation(s) exceeded 1s (blocking candidate) across all measured row counts.`)
  for (const m of blocking) {
    console.log(`  - ${m.category} / ${m.operation} at ${m.rowCount.toLocaleString()} rows: ${m.ms.toFixed(1)}ms`)
  }
}

main()
