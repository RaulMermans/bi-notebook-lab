import type { DataTable } from '../../domain/data'
import { profileColumn } from '../../lib/profiling/profileColumn'

export function TableProfile({ table }: { table: DataTable }) {
  return (
    <div className="profile-grid">
      {table.columns.map((column) => {
        const profile = profileColumn(column, table.rows)
        return (
          <div className="profile-card" key={column.id}>
            <div className="profile-card__header">
              <strong>{column.name}</strong>
              <span className="type-badge">{column.dataType}</span>
              {profile.isPotentialKey && <span className="key-badge">Potential key</span>}
            </div>
            <dl>
              <div>
                <dt>Rows</dt>
                <dd>{profile.rowCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Nulls</dt>
                <dd>
                  {profile.nullCount.toLocaleString()} ({profile.nullPercentage}%)
                </dd>
              </div>
              <div>
                <dt>Distinct</dt>
                <dd>
                  {profile.distinctCount.toLocaleString()} ({profile.distinctPercentage}%)
                </dd>
              </div>
              {profile.min !== undefined && (
                <div>
                  <dt>Min</dt>
                  <dd>{String(profile.min)}</dd>
                </div>
              )}
              {profile.max !== undefined && (
                <div>
                  <dt>Max</dt>
                  <dd>{String(profile.max)}</dd>
                </div>
              )}
              {profile.mean !== undefined && (
                <div>
                  <dt>Mean</dt>
                  <dd>{profile.mean}</dd>
                </div>
              )}
              {profile.minLength !== undefined && (
                <div>
                  <dt>Shortest</dt>
                  <dd>{profile.minLength}</dd>
                </div>
              )}
              {profile.maxLength !== undefined && (
                <div>
                  <dt>Longest</dt>
                  <dd>{profile.maxLength}</dd>
                </div>
              )}
            </dl>
          </div>
        )
      })}
    </div>
  )
}
