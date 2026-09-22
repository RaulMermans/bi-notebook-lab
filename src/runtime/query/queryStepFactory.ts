import type {
  AppendColumnMapping,
  ColumnRename,
  ColumnTypeChange,
  ConditionalColumnClause,
  GroupByAggregationFunction,
  MergeJoinKind,
  PivotAggregationFunction,
  QueryFilterCondition,
  QueryReplacement,
  QuerySortKey,
  QuerySource,
  QueryStep,
} from '../../domain/query'
import { generateId } from '../../lib/ids'

/**
 * What a caller supplies to add a step — everything except the parts that
 * must be generated exactly once and then persisted (`step.id`, and any
 * newly-created column ids). `queryRuntime.addQueryStep` is the only place
 * that calls `buildStep`, so a fresh id is never generated on re-evaluation
 * (brief §8, §33, §76: "no random column IDs during evaluation").
 */
export type NewStepInput =
  | { kind: 'rename-columns'; renames: ColumnRename[] }
  | { kind: 'remove-columns'; columnIds: string[] }
  | { kind: 'reorder-columns'; columnOrder: string[] }
  | { kind: 'change-type'; changes: ColumnTypeChange[] }
  | { kind: 'filter-rows'; logic: 'and' | 'or'; conditions: QueryFilterCondition[] }
  | { kind: 'replace-values'; replacements: QueryReplacement[] }
  | { kind: 'remove-duplicates'; columnIds?: string[] }
  | { kind: 'sort-rows'; keys: QuerySortKey[] }
  | { kind: 'fill'; direction: 'down' | 'up'; columnIds: string[] }
  | { kind: 'split-column'; columnId: string; delimiter: string; outputNames: [string, string]; removeSource: boolean }
  | { kind: 'merge-columns'; columnIds: string[]; delimiter: string; newColumnName: string; removeSource: boolean }
  | {
      kind: 'group-by'
      groupColumnIds: string[]
      aggregations: { outputName: string; function: GroupByAggregationFunction; sourceColumnId?: string }[]
    }
  | {
      kind: 'merge-queries'
      right: QuerySource
      joinKind: MergeJoinKind
      leftKeys: string[]
      rightKeys: string[]
      expand: { rightColumnId: string; outputName: string }[]
    }
  /** `columnNames` is the output schema's name list, already resolved by the caller (which can evaluate `sources` — see queryRuntime.ts). */
  | { kind: 'append-queries'; sources: QuerySource[]; columnNames: string[] }
  | { kind: 'pivot-column'; pivotColumnId: string; valueColumnId: string; aggregation: PivotAggregationFunction }
  | { kind: 'unpivot-columns'; mode: 'selected' | 'other-columns'; columnIds: string[]; attributeColumnName: string; valueColumnName: string }
  | { kind: 'conditional-column'; outputName: string; clauses: ConditionalColumnClause[]; elseValue: unknown }
  | { kind: 'index-column'; outputName: string; start: number; increment: number }
  | { kind: 'custom-column'; outputName: string; expression: string }

const DEFAULT_NAMES: Record<NewStepInput['kind'], string> = {
  'rename-columns': 'Renamed Columns',
  'remove-columns': 'Removed Columns',
  'reorder-columns': 'Reordered Columns',
  'change-type': 'Changed Type',
  'filter-rows': 'Filtered Rows',
  'replace-values': 'Replaced Values',
  'remove-duplicates': 'Removed Duplicates',
  'sort-rows': 'Sorted Rows',
  fill: 'Filled',
  'split-column': 'Split Column',
  'merge-columns': 'Merged Columns',
  'group-by': 'Grouped Rows',
  'merge-queries': 'Merged Queries',
  'append-queries': 'Appended Queries',
  'pivot-column': 'Pivoted Column',
  'unpivot-columns': 'Unpivoted Columns',
  'conditional-column': 'Conditional Column',
  'index-column': 'Added Index',
  'custom-column': 'Added Custom',
}

export function defaultStepName(input: NewStepInput): string {
  if (input.kind === 'fill') return input.direction === 'down' ? 'Filled Down' : 'Filled Up'
  return DEFAULT_NAMES[input.kind]
}

/** Builds a fully-formed `QueryStep`, generating `step.id` and any new column ids exactly once. */
export function buildStep(input: NewStepInput, name?: string): QueryStep {
  const id = generateId('step')
  const stepName = name?.trim() || defaultStepName(input)

  switch (input.kind) {
    case 'rename-columns':
      return { id, kind: 'rename-columns', name: stepName, renames: input.renames }
    case 'remove-columns':
      return { id, kind: 'remove-columns', name: stepName, columnIds: input.columnIds }
    case 'reorder-columns':
      return { id, kind: 'reorder-columns', name: stepName, columnOrder: input.columnOrder }
    case 'change-type':
      return { id, kind: 'change-type', name: stepName, changes: input.changes }
    case 'filter-rows':
      return { id, kind: 'filter-rows', name: stepName, logic: input.logic, conditions: input.conditions }
    case 'replace-values':
      return { id, kind: 'replace-values', name: stepName, replacements: input.replacements }
    case 'remove-duplicates':
      return { id, kind: 'remove-duplicates', name: stepName, columnIds: input.columnIds }
    case 'sort-rows':
      return { id, kind: 'sort-rows', name: stepName, keys: input.keys }
    case 'fill':
      return { id, kind: 'fill', name: stepName, direction: input.direction, columnIds: input.columnIds }
    case 'split-column':
      return {
        id,
        kind: 'split-column',
        name: stepName,
        columnId: input.columnId,
        delimiter: input.delimiter,
        outputNames: input.outputNames,
        outputColumnIds: [generateId('col'), generateId('col')],
        removeSource: input.removeSource,
      }
    case 'merge-columns':
      return {
        id,
        kind: 'merge-columns',
        name: stepName,
        columnIds: input.columnIds,
        delimiter: input.delimiter,
        newColumnName: input.newColumnName,
        outputColumnId: generateId('col'),
        removeSource: input.removeSource,
      }
    case 'group-by':
      return {
        id,
        kind: 'group-by',
        name: stepName,
        groupColumnIds: input.groupColumnIds,
        aggregations: input.aggregations.map((agg) => ({
          outputColumnId: generateId('col'),
          outputName: agg.outputName,
          function: agg.function,
          sourceColumnId: agg.sourceColumnId,
        })),
      }
    case 'merge-queries':
      return {
        id,
        kind: 'merge-queries',
        name: stepName,
        right: input.right,
        joinKind: input.joinKind,
        leftKeys: input.leftKeys,
        rightKeys: input.rightKeys,
        expand: input.expand.map((e) => ({ rightColumnId: e.rightColumnId, outputName: e.outputName, outputColumnId: generateId('col') })),
      }
    case 'append-queries': {
      const columns: AppendColumnMapping[] = input.columnNames.map((columnName) => ({ name: columnName, outputColumnId: generateId('col') }))
      return { id, kind: 'append-queries', name: stepName, sources: input.sources, columns }
    }
    case 'pivot-column':
      return { id, kind: 'pivot-column', name: stepName, pivotColumnId: input.pivotColumnId, valueColumnId: input.valueColumnId, aggregation: input.aggregation }
    case 'unpivot-columns':
      return {
        id,
        kind: 'unpivot-columns',
        name: stepName,
        mode: input.mode,
        columnIds: input.columnIds,
        attributeColumnName: input.attributeColumnName,
        attributeColumnId: generateId('col'),
        valueColumnName: input.valueColumnName,
        valueColumnId: generateId('col'),
      }
    case 'conditional-column':
      return { id, kind: 'conditional-column', name: stepName, outputColumnId: generateId('col'), outputName: input.outputName, clauses: input.clauses, elseValue: input.elseValue }
    case 'index-column':
      return { id, kind: 'index-column', name: stepName, outputColumnId: generateId('col'), outputName: input.outputName, start: input.start, increment: input.increment }
    case 'custom-column':
      return { id, kind: 'custom-column', name: stepName, outputColumnId: generateId('col'), outputName: input.outputName, expression: input.expression }
  }
}
