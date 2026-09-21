import type { DataColumn, DataType } from '../../../domain/data'
import type { MergeQueriesStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { ResolvedSource, StepContext, StepEvalResult } from '../stepContext'

type TypeCategory = 'numeric' | 'string' | 'boolean' | 'temporal' | 'other'

function categorize(dataType: DataType): TypeCategory {
  if (dataType === 'integer' || dataType === 'decimal') return 'numeric'
  if (dataType === 'boolean') return 'boolean'
  if (dataType === 'date' || dataType === 'datetime') return 'temporal'
  if (dataType === 'string') return 'string'
  return 'other'
}

/**
 * A typed, escaped composite key — never unsafe `value1 + "|" + value2`
 * concatenation, which would collide `["1", "2"]` with `["1|2"]` (brief §78).
 * `JSON.stringify` already distinguishes `100` from `"100"` from `null`.
 */
function compositeKey(values: unknown[]): string {
  return JSON.stringify(values.map((v) => (v === undefined ? null : v)))
}

function hasNull(values: unknown[]): boolean {
  return values.some((v) => v === null || v === undefined)
}

export function evaluateMergeQueries(frame: QueryFrame, step: MergeQueriesStep, context: StepContext): StepEvalResult {
  if (step.leftKeys.length === 0 || step.leftKeys.length !== step.rightKeys.length) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'Merge needs at least one key, with equal numbers of left and right keys.', { stepId: step.id })] }
  }

  const resolution = context.resolveSource(step.right)
  if (!resolution.ok) return { diagnostics: [{ ...resolution.diagnostic, stepId: step.id }] }
  const right: ResolvedSource = resolution.value

  const missingLeftKeys = step.leftKeys.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missingLeftKeys.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A merge left-key column no longer exists.', { stepId: step.id, details: { columnIds: missingLeftKeys } })] }
  }
  const missingRightKeys = step.rightKeys.filter((id) => !right.columns.some((c) => c.id === id))
  if (missingRightKeys.length > 0) {
    return {
      diagnostics: [errorDiagnostic('QUERY_DEPENDENCY_SCHEMA_CHANGED', 'A merge right-key column no longer exists on the right query/table.', { stepId: step.id, details: { columnIds: missingRightKeys } })],
    }
  }

  const leftKeyColumns = step.leftKeys.map((id) => frame.columns.find((c) => c.id === id)!)
  const rightKeyColumns = step.rightKeys.map((id) => right.columns.find((c) => c.id === id)!)

  for (let i = 0; i < leftKeyColumns.length; i += 1) {
    if (categorize(leftKeyColumns[i].dataType) !== categorize(rightKeyColumns[i].dataType)) {
      return {
        diagnostics: [
          errorDiagnostic(
            'QUERY_JOIN_KEY_TYPE_MISMATCH',
            `Key "${leftKeyColumns[i].name}" (${leftKeyColumns[i].dataType}) is not compatible with "${rightKeyColumns[i].name}" (${rightKeyColumns[i].dataType}).`,
            { stepId: step.id },
          ),
        ],
      }
    }
  }

  const missingExpand = step.expand.filter((e) => !right.columns.some((c) => c.id === e.rightColumnId))
  if (missingExpand.length > 0) {
    return {
      diagnostics: [errorDiagnostic('QUERY_DEPENDENCY_SCHEMA_CHANGED', 'An expanded merge column no longer exists on the right query/table.', { stepId: step.id, details: { missingExpand } })],
    }
  }

  const leftNames = new Set(frame.columns.map((c) => c.name.toLowerCase()))
  const expandNamesSeen = new Set<string>()
  for (const e of step.expand) {
    const lower = e.outputName.toLowerCase()
    if (leftNames.has(lower) || expandNamesSeen.has(lower)) {
      return {
        diagnostics: [errorDiagnostic('QUERY_MERGE_COLUMN_COLLISION', `Expanded column "${e.outputName}" collides with an existing column name. Use an alias.`, { stepId: step.id })],
      }
    }
    expandNamesSeen.add(lower)
  }

  const rightKeyNames = rightKeyColumns.map((c) => c.name)
  const leftKeyNames = leftKeyColumns.map((c) => c.name)
  const expandColumns: DataColumn[] = step.expand.map((e) => {
    const rightColumn = right.columns.find((c) => c.id === e.rightColumnId)!
    return { id: e.outputColumnId, name: e.outputName, dataType: rightColumn.dataType, nullable: true }
  })
  const expandSourceNames = step.expand.map((e) => right.columns.find((c) => c.id === e.rightColumnId)!.name)

  // Build a hash index on the right join keys — never a left-rows × right-rows nested loop (brief §77).
  const rightIndex = new Map<string, number[]>()
  right.rows.forEach((row, index) => {
    const key = rightKeyNames.map((name) => row[name] ?? null)
    if (hasNull(key)) return
    const k = compositeKey(key)
    const bucket = rightIndex.get(k)
    if (bucket) bucket.push(index)
    else rightIndex.set(k, [index])
  })

  const rightMatched = new Set<number>()
  const outputRows: Record<string, unknown>[] = []
  const maxRows = context.maxRows

  function emit(leftRow: Record<string, unknown> | null, rightRow: Record<string, unknown> | null): boolean {
    const row: Record<string, unknown> = leftRow ? { ...leftRow } : Object.fromEntries(frame.columns.map((c) => [c.name, null]))
    step.expand.forEach((e, i) => {
      row[e.outputName] = rightRow ? rightRow[expandSourceNames[i]] ?? null : null
    })
    outputRows.push(row)
    return outputRows.length <= maxRows
  }

  for (const leftRow of frame.rows) {
    const leftKey = leftKeyNames.map((name) => leftRow[name] ?? null)
    const matches = hasNull(leftKey) ? [] : (rightIndex.get(compositeKey(leftKey)) ?? [])

    if (matches.length > 0) {
      if (step.joinKind === 'left-anti') continue
      for (const idx of matches) {
        rightMatched.add(idx)
        if (step.joinKind === 'right-anti') continue
        if (!emit(leftRow, right.rows[idx])) {
          return { diagnostics: [errorDiagnostic('QUERY_ROW_LIMIT_EXCEEDED', `Merge output exceeds the ${maxRows.toLocaleString()}-row limit.`, { stepId: step.id })] }
        }
      }
    } else if (step.joinKind === 'left-outer' || step.joinKind === 'full-outer' || step.joinKind === 'left-anti' || step.joinKind === 'inner' || step.joinKind === 'right-outer') {
      if (step.joinKind === 'inner' || step.joinKind === 'right-outer') continue
      if (!emit(leftRow, null)) {
        return { diagnostics: [errorDiagnostic('QUERY_ROW_LIMIT_EXCEEDED', `Merge output exceeds the ${maxRows.toLocaleString()}-row limit.`, { stepId: step.id })] }
      }
    }
  }

  if (step.joinKind === 'right-outer' || step.joinKind === 'full-outer' || step.joinKind === 'right-anti') {
    right.rows.forEach((rightRow, idx) => {
      if (rightMatched.has(idx)) return
      if (!emit(null, rightRow)) {
        return
      }
    })
    if (outputRows.length > maxRows) {
      return { diagnostics: [errorDiagnostic('QUERY_ROW_LIMIT_EXCEEDED', `Merge output exceeds the ${maxRows.toLocaleString()}-row limit.`, { stepId: step.id })] }
    }
  }

  const columns = [...frame.columns, ...expandColumns]
  if (columns.length > context.maxColumns) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_LIMIT_EXCEEDED', `Merge output exceeds the ${context.maxColumns}-column limit.`, { stepId: step.id })] }
  }

  return { frame: { columns, rows: outputRows }, diagnostics: [] }
}
