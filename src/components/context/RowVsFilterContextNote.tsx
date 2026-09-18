/**
 * A compact, always-available reminder of the core Sprint 3 vs. Sprint 4
 * distinction (brief §25): a calculated column evaluates once per row in
 * `RowContext`, a measure evaluates once per query in `FilterContext`. Static
 * educational copy — it doesn't read any runtime state, unlike everything
 * else in `components/context/`.
 */
export function RowVsFilterContextNote() {
  return (
    <div className="row-vs-filter-context-note">
      <div className="row-vs-filter-context-note__card">
        <h5>Calculated Column</h5>
        <dl>
          <div>
            <dt>Evaluated</dt>
            <dd>once per row</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>Row Context</dd>
          </div>
          <div>
            <dt>Example</dt>
            <dd>
              <code>Sales[Revenue] - Sales[Cost]</code>
            </dd>
          </div>
        </dl>
      </div>
      <div className="row-vs-filter-context-note__card">
        <h5>Measure</h5>
        <dl>
          <div>
            <dt>Evaluated</dt>
            <dd>once per query / filter state</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>Filter Context</dd>
          </div>
          <div>
            <dt>Example</dt>
            <dd>
              <code>SUM(Sales[Revenue])</code>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
