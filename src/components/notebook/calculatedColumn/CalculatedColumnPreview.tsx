import type { DataColumn } from '../../../domain/data'

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

interface CalculatedColumnPreviewProps {
  resultColumnName: string
  sourceColumns: DataColumn[]
  rows: Record<string, unknown>[]
  values: unknown[]
  totalRowCount: number
  selectedRowIndex: number | null
  onSelectRow: (rowIndex: number) => void
}

/** Real computed values for the first `rows.length` rows — never the full table (docs/CALCULATED_COLUMNS.md "Preview"). */
export function CalculatedColumnPreview({
  resultColumnName,
  sourceColumns,
  rows,
  values,
  totalRowCount,
  selectedRowIndex,
  onSelectRow,
}: CalculatedColumnPreviewProps) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {sourceColumns.map((column) => (
              <th key={column.id}>
                <span className="data-table__name">{column.name}</span>
                <span className="type-badge">{column.dataType}</span>
              </th>
            ))}
            <th className="calculated-column-preview__result-header">
              <span className="data-table__name">fx {resultColumnName}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={rowIndex === selectedRowIndex ? 'calculated-column-preview__row--selected' : undefined}
              onClick={() => onSelectRow(rowIndex)}
            >
              {sourceColumns.map((column) => (
                <td key={column.id}>{formatCell(row[column.name])}</td>
              ))}
              <td className="calculated-column-preview__result-cell">{formatCell(values[rowIndex])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-scroll__note">
        {rows.length === totalRowCount
          ? `${totalRowCount.toLocaleString()} row${totalRowCount === 1 ? '' : 's'} evaluated. Select a row to inspect its row context.`
          : `Showing first ${rows.length} of ${totalRowCount.toLocaleString()} rows evaluated. Select a row to inspect its row context.`}
      </p>
    </div>
  )
}
