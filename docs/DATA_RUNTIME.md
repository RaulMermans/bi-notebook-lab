# Data Runtime (Sprint 1)

This document describes the data layer added in Sprint 1: importing files,
turning them into datasets, inferring types, profiling columns, and
persisting a notebook locally.

## Pipeline

```text
File (CSV/XLSX) or sample generator
  → lib/csv | lib/excel | lib/sample   (raw header/row grid)
  → lib/buildDataTable                  (limits, empty-row filtering, type
                                          inference, value coercion)
  → domain/data: Dataset / DataTable / DataColumn
  → runtime/notebook: NotebookRuntime   (adds a DataCell, registers the
                                          dataset in memory)
  → persistence/notebookStore           (IndexedDB: notebook doc + dataset)
```

`runtime/data/dataRuntime.ts` is the entry point the UI calls
(`importCsvFile`, `listWorkbookSheets`, `importWorkbookSheets`,
`loadSampleRetailDataset`). It enforces file-size limits before any parsing
happens and turns parser failures into a `DataImportError` with a
user-facing message.

## Supported file types

- **CSV** (`.csv`) — parsed with PapaParse. Handles quoted fields, commas
  inside quotes, blank values, numeric/boolean-looking values, and drops
  fully empty rows.
- **Excel** (`.xlsx`, `.xls`) — parsed with SheetJS (`xlsx`). The workbook is
  read once to list sheet names; the user picks which sheets to import.
  **Each selected sheet becomes its own `Dataset`** (see "One table per
  dataset" below), so a multi-sheet workbook adds one DataCell per sheet.
  The `xlsx` package (~330 KB) is loaded via a dynamic `import()` only when
  an Excel file is actually opened, so CSV-only sessions don't pay for it.
- **Sample dataset** — a seeded, deterministic generator
  (`lib/sample/generateRetailDataset.ts`) produces Customers (120 rows),
  Products (20 rows), Sales (1,500 rows) and Calendar (731 rows) as four
  separate datasets. `Revenue = Quantity × UnitPrice` and
  `Cost = Quantity × UnitCost` hold for every row, so later sprints can build
  margin/revenue exercises on top of it.

## One table per dataset

The product spec's `Dataset.source` contract carries a single `sheetName`
(for xlsx) or `key` (for samples) — one value, not an array — while
`Dataset.tables` is an array. Sprint 1 resolves this by giving each import
action **exactly one table per dataset**: a CSV file, one selected Excel
sheet, or one sample table each produce their own `Dataset`. A multi-sheet
Excel import therefore produces multiple `Dataset`s (and multiple DataCells)
in one action, matching the product doc's "Load Retail Dataset" example
where Customers/Products/Sales/Calendar appear as four separate `[Data: ...]`
cells. `tables` stays an array so a future sprint could introduce
multi-table datasets without a domain contract change.

## Type inference

`lib/profiling/inferType.ts` classifies a bounded sample (first 500 values)
of each column, then reduces the classifications:

- All values the same type → that type.
- Mixed `integer`/`decimal` → widens to `decimal`.
- Mixed `date`/`datetime` → widens to `datetime`.
- Anything else mixed → falls back to `string` (no destructive coercion —
  see the product doc's `1, 2, hello, 4 → string` example).
- All values blank → `null`. Zero values sampled (empty table) → `unknown`.

Recognized value shapes: integers (`-?\d+`), decimals (`-?\d+\.\d+`),
booleans (`true`/`false`, case-insensitive), ISO dates (`YYYY-MM-DD`), and
ISO datetimes (`YYYY-MM-DDTHH:mm[:ss][.sss][Z|±HH:mm]`). Excel cells that
SheetJS already returns as native `number`/`boolean`/`Date` are classified
directly rather than round-tripped through strings.

Once a column's type is decided, `coerceValue` converts each raw cell into
the stored representation: numbers for integer/decimal, booleans for
boolean, ISO strings for date/datetime, and `null` for any blank cell
(never `0` or `""`, even for numeric columns).

## Profiling

`lib/profiling/profileColumn.ts` computes, per column: row count, null
count/percentage, distinct count/percentage, and — depending on type — min/
max/mean (numeric), shortest/longest length (string), or min/max (temporal).
A column is flagged `isPotentialKey` when `distinctCount === rowCount &&
nullCount === 0`. This is informational only; Sprint 1 does not create
relationships.

## Dataset limits

Defined in `domain/data.ts`:

| Limit | Value |
|---|---|
| Max file size | 25 MB |
| Max rows per table | 100,000 |
| Max columns | 200 |

Exceeding any limit raises a `DataImportError` with a specific message
(e.g. *"has 150,000 rows, which exceeds the limit of 100,000 rows for this
training environment"*) shown in the import panel — the row/column grid is
never silently truncated.

## Persistence

`persistence/notebookStore.ts` wraps two IndexedDB object stores via
`idb-keyval`:

- `bi-notebook-lab-notebooks` — a single "active notebook" document
  (metadata + cell order + `datasetId` references). Saved on every
  structural change (add/remove/move/update cell).
- `bi-notebook-lab-datasets` — one entry per `Dataset`, keyed by id,
  including its rows. Saved once at import time and deleted when the
  dataset is removed, so editing the notebook never rewrites row data.

On load, `useNotebookRuntime` reads the notebook document, then loads only
the datasets its cells actually reference.

## Known limitation

The `xlsx` (SheetJS) package has open advisories (prototype pollution,
ReDoS) with no fix published to the npm registry — see
[GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and
[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).
Both require a maliciously crafted workbook to be opened. Since this app
only parses files the local user chooses to import (no server-side or
multi-user processing), the risk is accepted for this sprint; revisit if a
patched release becomes available or the app ever processes files from
untrusted third parties.
