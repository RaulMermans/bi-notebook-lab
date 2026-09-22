import type { DataColumn, Dataset } from '../../domain/data'
import { generateId } from '../ids'

function column(name: string, dataType: DataColumn['dataType']): DataColumn {
  return { id: generateId('col'), name, dataType, nullable: false }
}

/**
 * A small, deliberately wide table — Sprint 14's Power Query lesson (see
 * docs/LEARNING_SYSTEM.md) uses it to make Unpivot Columns pedagogically
 * obvious: `Jan`/`Feb`/`Mar`/`Apr` are clearly "the same kind of thing"
 * repeated across columns, exactly the shape Unpivot exists to fix. Values
 * are hand-picked to all be distinct, so a lesson checkpoint can identify
 * an unpivoted row by its `Target` value alone (a `QueryRowSelector` needs
 * only one equality match).
 */
export function generateMonthlyTargetsDataset(): Dataset {
  const productCol = column('Product', 'string')
  const janCol = column('Jan', 'integer')
  const febCol = column('Feb', 'integer')
  const marCol = column('Mar', 'integer')
  const aprCol = column('Apr', 'integer')

  const rows = [
    { Product: 'A', Jan: 100, Feb: 120, Mar: 130, Apr: 140 },
    { Product: 'B', Jan: 80, Feb: 90, Mar: 95, Apr: 105 },
    { Product: 'C', Jan: 60, Feb: 65, Mar: 70, Apr: 75 },
  ]

  return {
    id: generateId('dataset'),
    name: 'Monthly_Targets_Wide',
    source: { type: 'sample', key: 'monthly-targets-wide' },
    tables: [
      {
        id: generateId('table'),
        name: 'Monthly_Targets_Wide',
        columns: [productCol, janCol, febCol, marCol, aprCol],
        rows,
        rowCount: rows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}
