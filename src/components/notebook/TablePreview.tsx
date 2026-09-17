import type { DataTable } from '../../domain/data'

const PREVIEW_ROW_LIMIT = 100

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function TablePreview({ table }: { table: DataTable }) {
  const rows = table.rows.slice(0, PREVIEW_ROW_LIMIT)

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.id}>
                <span className="data-table__name">{column.name}</span>
                <span className="type-badge">{column.dataType}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {table.columns.map((column) => (
                <td key={column.id}>{formatCell(row[column.name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rowCount > PREVIEW_ROW_LIMIT && (
        <p className="table-scroll__note">
          Showing first {PREVIEW_ROW_LIMIT} of {table.rowCount.toLocaleString()} rows.
        </p>
      )}
    </div>
  )
}
