import type { DataTable } from '../../domain/data'

export function TableSchema({ table }: { table: DataTable }) {
  return (
    <table className="schema-table">
      <thead>
        <tr>
          <th>Column</th>
          <th>Type</th>
          <th>Nullable</th>
        </tr>
      </thead>
      <tbody>
        {table.columns.map((column) => (
          <tr key={column.id}>
            <td>{column.name}</td>
            <td>
              <span className="type-badge">{column.dataType}</span>
            </td>
            <td>{column.nullable ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
