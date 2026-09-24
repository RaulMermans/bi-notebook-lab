import { useMemo, useState } from 'react'
import type { DataColumn, DataType } from '../../../domain/data'
import type {
  ConditionalColumnClause,
  GroupByAggregationFunction,
  MergeJoinKind,
  PivotAggregationFunction,
  QueryFilterOperator,
} from '../../../domain/query'
import { bindExpression } from '../../../runtime/query/expression/binder'
import { ExpressionLexError } from '../../../runtime/query/expression/lexer'
import { ExpressionParseError, parseExpression } from '../../../runtime/query/expression/parser'
import type { NewStepInput } from '../../../runtime/query/queryStepFactory'

const DATA_TYPES: DataType[] = ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime']
const FILTER_OPERATORS: QueryFilterOperator[] = [
  'equals',
  'not-equals',
  'greater-than',
  'greater-than-or-equal',
  'less-than',
  'less-than-or-equal',
  'contains',
  'starts-with',
  'ends-with',
  'is-blank',
  'is-not-blank',
]
const AGG_FUNCTIONS: GroupByAggregationFunction[] = ['count-rows', 'sum', 'average', 'min', 'max']
const JOIN_KINDS: MergeJoinKind[] = ['inner', 'left-outer', 'right-outer', 'full-outer', 'left-anti', 'right-anti']
const PIVOT_AGG_FUNCTIONS: PivotAggregationFunction[] = ['sum', 'count', 'min', 'max', 'first']

interface FormProps {
  columns: DataColumn[]
  onSubmit: (input: NewStepInput) => void
  onCancel: () => void
}

function ColumnSelect({ columns, value, onChange }: { columns: DataColumn[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select column…</option>
      {columns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export function RenameColumnsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [renames, setRenames] = useState<{ columnId: string; newName: string }[]>([{ columnId: '', newName: '' }])
  const valid = renames.every((r) => r.columnId && r.newName.trim() !== '')

  return (
    <div className="query-form">
      {renames.map((r, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={r.columnId} onChange={(id) => setRenames((rs) => rs.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <input placeholder="New name" value={r.newName} onChange={(e) => setRenames((rs) => rs.map((x, xi) => (xi === i ? { ...x, newName: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRenames((rs) => [...rs, { columnId: '', newName: '' }])}>
        + Add rename
      </button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'rename-columns', renames })}>Apply</button>
      </div>
    </div>
  )
}

export function RemoveColumnsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <div className="query-form">
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={selected.size === 0} onClick={() => onSubmit({ kind: 'remove-columns', columnIds: [...selected] })}>Apply</button>
      </div>
    </div>
  )
}

export function ReorderColumnsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [order, setOrder] = useState<string[]>(columns.map((c) => c.id))
  function move(index: number, dir: -1 | 1) {
    setOrder((ids) => {
      const next = [...ids]
      const target = index + dir
      if (target < 0 || target >= next.length) return next
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  return (
    <div className="query-form">
      <ol className="query-form__reorder">
        {order.map((id, index) => {
          const col = columns.find((c) => c.id === id)
          return (
            <li key={id}>
              <span>{col?.name ?? id}</span>
              <button type="button" className="text-button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
              <button type="button" className="text-button" onClick={() => move(index, 1)} disabled={index === order.length - 1}>↓</button>
            </li>
          )
        })}
      </ol>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" onClick={() => onSubmit({ kind: 'reorder-columns', columnOrder: order })}>Apply</button>
      </div>
    </div>
  )
}

export function ChangeTypeForm({ columns, onSubmit, onCancel }: FormProps) {
  const [changes, setChanges] = useState<{ columnId: string; dataType: DataType }[]>([{ columnId: '', dataType: 'string' }])
  const valid = changes.every((c) => c.columnId)
  return (
    <div className="query-form">
      {changes.map((c, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={c.columnId} onChange={(id) => setChanges((cs) => cs.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <select value={c.dataType} onChange={(e) => setChanges((cs) => cs.map((x, xi) => (xi === i ? { ...x, dataType: e.target.value as DataType } : x)))}>
            {DATA_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setChanges((cs) => [...cs, { columnId: '', dataType: 'string' }])}>+ Add column</button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'change-type', changes })}>Apply</button>
      </div>
    </div>
  )
}

const NO_VALUE_OPERATORS = new Set<QueryFilterOperator>(['is-blank', 'is-not-blank'])

export function FilterRowsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [logic, setLogic] = useState<'and' | 'or'>('and')
  const [conditions, setConditions] = useState<{ columnId: string; operator: QueryFilterOperator; value: string }[]>([
    { columnId: '', operator: 'equals', value: '' },
  ])
  const valid = conditions.every((c) => c.columnId)

  return (
    <div className="query-form">
      <label>
        Combine with{' '}
        <select value={logic} onChange={(e) => setLogic(e.target.value as 'and' | 'or')}>
          <option value="and">AND</option>
          <option value="or">OR</option>
        </select>
      </label>
      {conditions.map((c, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={c.columnId} onChange={(id) => setConditions((cs) => cs.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <select value={c.operator} onChange={(e) => setConditions((cs) => cs.map((x, xi) => (xi === i ? { ...x, operator: e.target.value as QueryFilterOperator } : x)))}>
            {FILTER_OPERATORS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          {!NO_VALUE_OPERATORS.has(c.operator) && (
            <input placeholder="Value" value={c.value} onChange={(e) => setConditions((cs) => cs.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))} />
          )}
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setConditions((cs) => [...cs, { columnId: '', operator: 'equals', value: '' }])}>+ Add condition</button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() =>
            onSubmit({
              kind: 'filter-rows',
              logic,
              conditions: conditions.map((c) => ({ columnId: c.columnId, operator: c.operator, value: NO_VALUE_OPERATORS.has(c.operator) ? undefined : coerceFormValue(c.value) })),
            })
          }
        >
          Apply
        </button>
      </div>
    </div>
  )
}

/** Best-effort numeric/boolean coercion for a plain text form field — a filter/replace value typed as "100" should compare against a numeric column as `100`, not `"100"`. */
function coerceFormValue(raw: string): unknown {
  if (raw === '') return raw
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

export function ReplaceValuesForm({ columns, onSubmit, onCancel }: FormProps) {
  const [replacements, setReplacements] = useState<{ columnId: string; find: string; replace: string }[]>([{ columnId: '', find: '', replace: '' }])
  const valid = replacements.every((r) => r.columnId)
  return (
    <div className="query-form">
      {replacements.map((r, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={r.columnId} onChange={(id) => setReplacements((rs) => rs.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <input placeholder="Find (blank = null)" value={r.find} onChange={(e) => setReplacements((rs) => rs.map((x, xi) => (xi === i ? { ...x, find: e.target.value } : x)))} />
          <input placeholder="Replace with" value={r.replace} onChange={(e) => setReplacements((rs) => rs.map((x, xi) => (xi === i ? { ...x, replace: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setReplacements((rs) => [...rs, { columnId: '', find: '', replace: '' }])}>+ Add replacement</button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() =>
            onSubmit({
              kind: 'replace-values',
              replacements: replacements.map((r) => ({ columnId: r.columnId, find: r.find === '' ? null : coerceFormValue(r.find), replace: r.replace === '' ? null : coerceFormValue(r.replace) })),
            })
          }
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function RemoveDuplicatesForm({ columns, onSubmit, onCancel }: FormProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <div className="query-form">
      <p className="query-form__hint">Leave every box unchecked to match on all columns.</p>
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" onClick={() => onSubmit({ kind: 'remove-duplicates', columnIds: selected.size > 0 ? [...selected] : undefined })}>Apply</button>
      </div>
    </div>
  )
}

export function SortRowsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [keys, setKeys] = useState<{ columnId: string; direction: 'asc' | 'desc' }[]>([{ columnId: '', direction: 'asc' }])
  const valid = keys.every((k) => k.columnId)
  return (
    <div className="query-form">
      {keys.map((k, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={k.columnId} onChange={(id) => setKeys((ks) => ks.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <select value={k.direction} onChange={(e) => setKeys((ks) => ks.map((x, xi) => (xi === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x)))}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setKeys((ks) => [...ks, { columnId: '', direction: 'asc' }])}>+ Add sort key</button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'sort-rows', keys })}>Apply</button>
      </div>
    </div>
  )
}

export function FillForm({ columns, onSubmit, onCancel }: FormProps) {
  const [direction, setDirection] = useState<'down' | 'up'>('down')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <div className="query-form">
      <label>
        Direction{' '}
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'down' | 'up')}>
          <option value="down">Fill Down</option>
          <option value="up">Fill Up</option>
        </select>
      </label>
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={selected.size === 0} onClick={() => onSubmit({ kind: 'fill', direction, columnIds: [...selected] })}>Apply</button>
      </div>
    </div>
  )
}

export function SplitColumnForm({ columns, onSubmit, onCancel }: FormProps) {
  const [columnId, setColumnId] = useState('')
  const [delimiter, setDelimiter] = useState('-')
  const [nameA, setNameA] = useState('Part1')
  const [nameB, setNameB] = useState('Part2')
  const [removeSource, setRemoveSource] = useState(true)
  const valid = columnId && delimiter !== '' && nameA.trim() && nameB.trim()
  return (
    <div className="query-form">
      <div className="query-form__row">
        <ColumnSelect columns={columns} value={columnId} onChange={setColumnId} />
        <input placeholder="Delimiter" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} />
      </div>
      <div className="query-form__row">
        <input placeholder="Output 1 name" value={nameA} onChange={(e) => setNameA(e.target.value)} />
        <input placeholder="Output 2 name" value={nameB} onChange={(e) => setNameB(e.target.value)} />
      </div>
      <label><input type="checkbox" checked={removeSource} onChange={(e) => setRemoveSource(e.target.checked)} /> Remove source column</label>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'split-column', columnId, delimiter, outputNames: [nameA, nameB], removeSource })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function MergeColumnsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [delimiter, setDelimiter] = useState(' ')
  const [newColumnName, setNewColumnName] = useState('Merged')
  const [removeSource, setRemoveSource] = useState(true)
  const valid = selected.length >= 2 && newColumnName.trim() !== ''

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <div className="query-form">
      <p className="query-form__hint">Pick columns in the order they should be joined.</p>
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.name} {selected.includes(c.id) && <em>#{selected.indexOf(c.id) + 1}</em>}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__row">
        <input placeholder="Delimiter" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} />
        <input placeholder="New column name" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} />
      </div>
      <label><input type="checkbox" checked={removeSource} onChange={(e) => setRemoveSource(e.target.checked)} /> Remove source columns</label>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'merge-columns', columnIds: selected, delimiter, newColumnName, removeSource })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function GroupByForm({ columns, onSubmit, onCancel }: FormProps) {
  const [groupColumnIds, setGroupColumnIds] = useState<Set<string>>(new Set())
  const [aggregations, setAggregations] = useState<{ outputName: string; function: GroupByAggregationFunction; sourceColumnId?: string }[]>([
    { outputName: 'Count', function: 'count-rows' },
  ])
  const valid = aggregations.every((a) => a.outputName.trim() && (a.function === 'count-rows' || a.sourceColumnId))

  return (
    <div className="query-form">
      <p className="query-form__hint">Group by</p>
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={groupColumnIds.has(c.id)}
                onChange={() =>
                  setGroupColumnIds((s) => {
                    const next = new Set(s)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <p className="query-form__hint">Aggregations</p>
      {aggregations.map((a, i) => (
        <div className="query-form__row" key={i}>
          <select value={a.function} onChange={(e) => setAggregations((ags) => ags.map((x, xi) => (xi === i ? { ...x, function: e.target.value as GroupByAggregationFunction } : x)))}>
            {AGG_FUNCTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          {a.function !== 'count-rows' && (
            <ColumnSelect columns={columns} value={a.sourceColumnId ?? ''} onChange={(id) => setAggregations((ags) => ags.map((x, xi) => (xi === i ? { ...x, sourceColumnId: id } : x)))} />
          )}
          <input placeholder="Output name" value={a.outputName} onChange={(e) => setAggregations((ags) => ags.map((x, xi) => (xi === i ? { ...x, outputName: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setAggregations((ags) => [...ags, { outputName: '', function: 'count-rows' }])}>+ Add aggregation</button>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'group-by', groupColumnIds: [...groupColumnIds], aggregations })}>Apply</button>
      </div>
    </div>
  )
}

interface QuerySourceOption {
  queryId: string
  name: string
  columns: DataColumn[]
}

interface MergeQueriesFormProps extends FormProps {
  otherQueries: QuerySourceOption[]
}

export function MergeQueriesForm({ columns, otherQueries, onSubmit, onCancel }: MergeQueriesFormProps) {
  const [rightQueryId, setRightQueryId] = useState('')
  const [joinKind, setJoinKind] = useState<MergeJoinKind>('left-outer')
  const [leftKeys, setLeftKeys] = useState<string[]>([''])
  const [rightKeys, setRightKeys] = useState<string[]>([''])
  const [expand, setExpand] = useState<{ rightColumnId: string; outputName: string }[]>([])

  const rightColumns = otherQueries.find((q) => q.queryId === rightQueryId)?.columns ?? []
  const valid = rightQueryId && leftKeys.every(Boolean) && rightKeys.every(Boolean) && leftKeys.length === rightKeys.length

  function toggleExpand(col: DataColumn) {
    setExpand((es) => (es.some((e) => e.rightColumnId === col.id) ? es.filter((e) => e.rightColumnId !== col.id) : [...es, { rightColumnId: col.id, outputName: col.name }]))
  }

  return (
    <div className="query-form">
      <div className="query-form__row">
        <select value={rightQueryId} onChange={(e) => { setRightQueryId(e.target.value); setExpand([]) }}>
          <option value="">Merge with query…</option>
          {otherQueries.map((q) => (
            <option key={q.queryId} value={q.queryId}>{q.name}</option>
          ))}
        </select>
        <select value={joinKind} onChange={(e) => setJoinKind(e.target.value as MergeJoinKind)}>
          {JOIN_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      {leftKeys.map((leftKey, i) => (
        <div className="query-form__row" key={i}>
          <ColumnSelect columns={columns} value={leftKey} onChange={(id) => setLeftKeys((ks) => ks.map((x, xi) => (xi === i ? id : x)))} />
          <span>=</span>
          <ColumnSelect columns={rightColumns} value={rightKeys[i] ?? ''} onChange={(id) => setRightKeys((ks) => ks.map((x, xi) => (xi === i ? id : x)))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => { setLeftKeys((k) => [...k, '']); setRightKeys((k) => [...k, '']) }}>+ Add key</button>
      {rightQueryId && (
        <>
          <p className="query-form__hint">Expand columns</p>
          <ul className="query-form__checklist">
            {rightColumns.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={expand.some((e) => e.rightColumnId === c.id)} onChange={() => toggleExpand(c)} />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'merge-queries', right: { kind: 'query', queryId: rightQueryId }, joinKind, leftKeys, rightKeys, expand })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

interface AppendQueriesFormProps {
  otherQueries: QuerySourceOption[]
  onSubmit: (input: NewStepInput) => void
  onCancel: () => void
  currentColumnNames: string[]
}

export function AppendQueriesForm({ otherQueries, onSubmit, onCancel, currentColumnNames }: AppendQueriesFormProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="query-form">
      <ul className="query-form__checklist">
        {otherQueries.map((q) => (
          <li key={q.queryId}>
            <label>
              <input type="checkbox" checked={selected.has(q.queryId)} onChange={() => toggle(q.queryId)} />
              {q.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={selected.size === 0}
          onClick={() => {
            const sources = [...selected].map((queryId) => ({ kind: 'query' as const, queryId }))
            const names = new Set(currentColumnNames)
            for (const id of selected) {
              const q = otherQueries.find((oq) => oq.queryId === id)
              q?.columns.forEach((c) => names.add(c.name))
            }
            onSubmit({ kind: 'append-queries', sources, columnNames: [...names] })
          }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function PivotColumnForm({ columns, onSubmit, onCancel }: FormProps) {
  const [pivotColumnId, setPivotColumnId] = useState('')
  const [valueColumnId, setValueColumnId] = useState('')
  const [aggregation, setAggregation] = useState<PivotAggregationFunction>('sum')
  const valid = pivotColumnId && valueColumnId && pivotColumnId !== valueColumnId

  return (
    <div className="query-form">
      <p className="query-form__hint">Pivot column (its values become new column names)</p>
      <ColumnSelect columns={columns} value={pivotColumnId} onChange={setPivotColumnId} />
      <p className="query-form__hint">Value column (aggregated into each new column)</p>
      <ColumnSelect columns={columns} value={valueColumnId} onChange={setValueColumnId} />
      <label>
        Aggregation{' '}
        <select value={aggregation} onChange={(e) => setAggregation(e.target.value as PivotAggregationFunction)}>
          {PIVOT_AGG_FUNCTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'pivot-column', pivotColumnId, valueColumnId, aggregation })}>Apply</button>
      </div>
    </div>
  )
}

export function UnpivotColumnsForm({ columns, onSubmit, onCancel }: FormProps) {
  const [mode, setMode] = useState<'selected' | 'other-columns'>('selected')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [attributeColumnName, setAttributeColumnName] = useState('Attribute')
  const [valueColumnName, setValueColumnName] = useState('Value')
  const valid = selected.size > 0 && attributeColumnName.trim() && valueColumnName.trim() && attributeColumnName.trim() !== valueColumnName.trim()

  return (
    <div className="query-form">
      <label>
        Mode{' '}
        <select value={mode} onChange={(e) => setMode(e.target.value as 'selected' | 'other-columns')}>
          <option value="selected">Unpivot selected columns</option>
          <option value="other-columns">Unpivot other columns (keep selected)</option>
        </select>
      </label>
      <p className="query-form__hint">{mode === 'selected' ? 'Columns to unpivot' : 'Columns to keep as-is'}</p>
      <ul className="query-form__checklist">
        {columns.map((c) => (
          <li key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="query-form__row">
        <input placeholder="Attribute column name" value={attributeColumnName} onChange={(e) => setAttributeColumnName(e.target.value)} />
        <input placeholder="Value column name" value={valueColumnName} onChange={(e) => setValueColumnName(e.target.value)} />
      </div>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'unpivot-columns', mode, columnIds: [...selected], attributeColumnName, valueColumnName })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function ConditionalColumnForm({ columns, onSubmit, onCancel }: FormProps) {
  const [outputName, setOutputName] = useState('Column')
  const [clauses, setClauses] = useState<ConditionalColumnClause[]>([{ columnId: '', operator: 'equals', value: '', result: '' }])
  const [elseValue, setElseValue] = useState<string>('')
  const valid = outputName.trim() && clauses.every((c) => c.columnId)

  return (
    <div className="query-form">
      <input placeholder="New column name" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
      {clauses.map((clause, i) => (
        <div className="query-form__row" key={i}>
          <span>if</span>
          <ColumnSelect columns={columns} value={clause.columnId} onChange={(id) => setClauses((cs) => cs.map((x, xi) => (xi === i ? { ...x, columnId: id } : x)))} />
          <select value={clause.operator} onChange={(e) => setClauses((cs) => cs.map((x, xi) => (xi === i ? { ...x, operator: e.target.value as QueryFilterOperator } : x)))}>
            {FILTER_OPERATORS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          {!NO_VALUE_OPERATORS.has(clause.operator) && (
            <input placeholder="Value" value={String(clause.value ?? '')} onChange={(e) => setClauses((cs) => cs.map((x, xi) => (xi === i ? { ...x, value: coerceFormValue(e.target.value) } : x)))} />
          )}
          <span>then</span>
          <input placeholder="Result" value={String(clause.result ?? '')} onChange={(e) => setClauses((cs) => cs.map((x, xi) => (xi === i ? { ...x, result: coerceFormValue(e.target.value) } : x)))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setClauses((cs) => [...cs, { columnId: '', operator: 'equals', value: '', result: '' }])}>+ Add clause (else if)</button>
      <div className="query-form__row">
        <span>else</span>
        <input placeholder="Else value" value={elseValue} onChange={(e) => setElseValue(e.target.value)} />
      </div>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'conditional-column', outputName, clauses, elseValue: coerceFormValue(elseValue) })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

export function IndexColumnForm({ onSubmit, onCancel }: FormProps) {
  const [outputName, setOutputName] = useState('Index')
  const [start, setStart] = useState('0')
  const [increment, setIncrement] = useState('1')
  const startNum = Number(start)
  const incrementNum = Number(increment)
  const valid = outputName.trim() && Number.isFinite(startNum) && Number.isFinite(incrementNum) && incrementNum !== 0

  return (
    <div className="query-form">
      <input placeholder="New column name" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
      <div className="query-form__row">
        <label>
          Start <input type="number" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Increment <input type="number" value={increment} onChange={(e) => setIncrement(e.target.value)} />
        </label>
      </div>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!valid}
          onClick={() => onSubmit({ kind: 'index-column', outputName, start: startNum, increment: incrementNum })}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

/**
 * The Custom Column editor: a plain textarea, not Monaco (brief §33 "A
 * textarea/input with clear diagnostics is sufficient"). Parses+binds
 * against the current columns on every keystroke purely for inline
 * feedback — the actual parse/bind that determines correctness happens
 * again, authoritatively, inside `steps/customColumn.ts` at evaluation
 * time; this preview never becomes a second source of truth.
 */
export function CustomColumnForm({ columns, onSubmit, onCancel }: FormProps) {
  const [outputName, setOutputName] = useState('Column')
  const [expression, setExpression] = useState('')

  const diagnosticMessages = useMemo((): string[] => {
    if (expression.trim() === '') return []
    try {
      const ast = parseExpression(expression)
      const { diagnostics } = bindExpression(ast, columns, 'preview')
      return diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
    } catch (err) {
      if (err instanceof ExpressionLexError || err instanceof ExpressionParseError) return [err.message]
      return ['Could not parse this expression.']
    }
  }, [expression, columns])

  const valid = outputName.trim() && expression.trim() !== '' && diagnosticMessages.length === 0

  return (
    <div className="query-form">
      <input placeholder="New column name" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
      <textarea
        className="query-form__expression"
        placeholder='[Quantity] * [UnitPrice]'
        rows={3}
        value={expression}
        onChange={(e) => setExpression(e.target.value)}
      />
      {diagnosticMessages.length > 0 && (
        <ul className="diagnostic-list">
          {diagnosticMessages.map((message, index) => (
            <li key={index} className="diagnostic diagnostic--error">{message}</li>
          ))}
        </ul>
      )}
      <p className="query-form__hint">Power Query expression subset — not full M. See docs/POWER_QUERY_EXPRESSIONS.md.</p>
      <div className="query-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button" disabled={!valid} onClick={() => onSubmit({ kind: 'custom-column', outputName, expression })}>Apply</button>
      </div>
    </div>
  )
}
