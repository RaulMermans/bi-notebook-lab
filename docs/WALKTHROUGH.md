# Guided walkthrough

> A hands-on tour of the runtime, moved from the README. Each step uses the built-in sample data.

## Start

```bash
npm install
npm run dev
```

Open **Free Lab** and pick a card from the **Practice projects** gallery
(Retail Modeling, DAX Playground, Power Query Cleaning, or Filter Context
Lab) to start from a working example, or import a `.csv`/`.xlsx` file to
bring your own data. Use **Export project**/**Import project** at any time
to save your work as a portable `.bilab.json` file and restore it later or
on another machine — see
[`docs/PROJECT_BUNDLE.md`](./docs/PROJECT_BUNDLE.md).

Click **Load Power Query Lab Dataset** to try Power Query on deliberately
messy data (`Sales_Jan`/`Sales_Feb`/`Products`/`Customers_Dirty`). On
`Customers_Dirty`, click **Transform Data**, then use the toolbar to Rename
`customer_id` → `CustomerID`, Change Type to `integer`, Replace `"ES "` →
`"ES"` in `Country`, Filter `CustomerID` is-not-blank, and Remove
Duplicates by `CustomerID` — click any Applied Step to see the table as it
existed at that point. Use **+ Reference Query** on `Sales_Jan`/`Sales_Feb`
to build `Sales Combined` with an Append Queries step, then Merge Queries
against a `Products` query to expand `ProductName`/`Category`/`UnitPrice`,
and Group By `Category` to total `Revenue`. Add the transformed queries'
outputs (not the raw `DataCell`s) to a Model cell — everything downstream
(relationships, measures, visuals, validation) works exactly as it does on
raw data, because it's reading the same kind of `Dataset` either way.

Add a Model cell to select tables into a semantic
model and build a star schema (Customers/Products/Calendar 1:* Sales), then
use **+ New calculated column** to write a row-level expression such as
`Sales[Revenue] - Sales[Cost]` or `RELATED(Products[Category])`.

Use **+ New measure** to create `SUM(Sales[Revenue])`, `DISTINCTCOUNT(Sales[OrderID])`
or `DIVIDE([Total Revenue], [Orders])`, then expand the measure cell to add
filters (e.g. `Customers[Country] = Spain`) and watch the result recompute
with a full execution trace.

Once you have a model, use **+ Add Retail checkpoint** to add the built-in
scored checkpoint, then click **Check solution** to grade your model,
`Margin` column, and measures against frozen expected results — including
under several filter contexts, so a hardcoded number can't pass.

Expand a Model cell and switch to its **Context Explorer** tab to pick any
measure, add filters (e.g. `Customers[Country] = Spain`), and watch the
relationship-propagation diagram, baseline/current comparison, and
plain-English narrative update from the real runtime.

Use **+ Add Visual** to create a KPI on `Total Revenue`, a Bar chart of
`Products[Category]` by `Total Revenue`, a Line chart of `Calendar[Date]` by
`Total Revenue`, a Table of `Customers[Country]` with `Total Revenue`/
`Orders`/`Average Order Value`, and a `Customers[Country]` Slicer — then pick
a country and watch every visual recompute together, matching the exact
number the Context Explorer shows for the same filter.

Create `Spain Revenue = CALCULATE([Total Revenue], Customers[Country] = "Spain")`,
put it on a KPI, then set the `Customers[Country]` Slicer to France: `Total
Revenue` follows the slicer, `Spain Revenue` doesn't — same-column
replacement, not intersection. Add `Revenue All Countries =
CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))` to see a
slicer-proof grand total, and open either measure in the Context Explorer to
see the internal CALCULATE modification laid out step by step.

Create `Gross Margin X = SUMX(Sales, Sales[Revenue] - Sales[Cost])` and
compare it to `Total Revenue - Total Cost`; create `Calculated Revenue =
SUMX(Sales, Sales[Quantity] * RELATED(Products[UnitPrice]))` and compare it
to `SUM(Sales[Revenue])`; create `Selected Country = SELECTEDVALUE(
Customers[Country], "Multiple Countries")`, put it on a KPI, and watch it
switch between `"Multiple Countries"` and a single country name as you change
the `Customers[Country]` Slicer. Add a calculated column `Revenue Band =
SWITCH(TRUE(), Sales[Revenue] >= 2000, "Large", Sales[Revenue] >= 500,
"Medium", "Small")` and preview it row by row.

Mark `Calendar` as a Date Table (using `Calendar[Date]`) in the Model
editor, then create `Revenue LY = CALCULATE([Total Revenue],
SAMEPERIODLASTYEAR(Calendar[Date]))`. Select `Year = 2025, Month = March`
in the Context Explorer and watch `Revenue LY` compute March 2024's
revenue — not blank, and not intersected with `Year = 2025`. Add `Revenue
YoY = [Total Revenue] - [Revenue LY]`, `Revenue PM =
CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))` and `Revenue YTD
= TOTALYTD([Total Revenue], Calendar[Date])`, put all four on a Line
Visual against `Calendar[Month]`, and compare `Revenue YTD` to
`CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))` — they always
match.
