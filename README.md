# @particle-academy/fancy-grid

A data grid whose state is JSON and whose every element has a stable handle —
[TanStack Table](https://tanstack.com/table) (and optionally
[TanStack Virtual](https://tanstack.com/virtual)) under a controlled,
agent-bridgeable surface.

```bash
npm install @particle-academy/fancy-grid @tanstack/react-table
# windowing is opt-in
npm install @tanstack/react-virtual
```

## Why this exists

The Fancy suite had a spreadsheet (`fancy-sheets`) and a presentational
`<Table>`, but no generic grid engine — and **nothing in the suite windowed
anything**, so every data-heavy surface rendered every row it was given.

TanStack is best-in-class at exactly the part that was missing. So it is
**supported, never depended on**: the engines are peer dependencies, nothing is
bundled, and no other package in the suite gains a TanStack dependency because
this one exists. Install `fancy-grid` and you choose your own engine versions;
don't install it and you carry nothing.

## Usage

```tsx
import { FancyDataGrid, type FancyGridColumn, type FancyGridState } from "@particle-academy/fancy-grid";

const columns: FancyGridColumn[] = [
  { id: "customer", header: "Customer", accessor: "customer.name", sortable: true },
  { id: "total", header: "Total", sortable: true, align: "end" },
];

function Orders({ rows }) {
  const [state, setState] = useState<FancyGridState>({});

  return (
    <FancyDataGrid
      gridId="orders"
      columns={columns}
      rows={rows}
      state={state}
      onStateChange={setState}
    />
  );
}
```

`columns` and `rows` must be **stable references** — hoist them or wrap them in
`useMemo`. TanStack Table re-creates the table on every new reference, which can
render-loop; the grid warns in development if it sees identity churn on five
consecutive renders.

## The state contract

One serializable object, and `onStateChange` always receives the **full** next
state — never a slice to merge:

```ts
{
  sorting?:       { id: string; desc: boolean }[];
  filters?:       { id: string; value: string }[];
  rowSelection?:  Record<string, boolean>;   // keyed by row id
  pagination?:    { pageIndex: number; pageSize: number };
}
```

It round-trips through JSON, so it survives a URL, a saved view, or an MCP tool
call. Sorting is **ascending on the first click for every column** — TanStack
defaults to descending-first on numeric columns, which makes the same gesture
mean different things depending on the data type.

Selection is keyed by row id, not index, so it survives a re-sort. Pass
`getRowId` when rows have no `id` field.

## Server-side mode

```tsx
<FancyDataGrid serverSide rowCount={total} state={state} onStateChange={refetch} … />
```

Sorting, filtering and pagination become **intent** the grid reports rather than
work it performs. This matters more than it sounds: without it the grid sorts the
one page it happens to hold and presents that as the sorted whole — a wrong
answer that looks completely correct. `rowCount` is required; the grid cannot
know the total from a single page.

## Virtualization

Windowing lives on its own entry, because an optional peer imported from the
root entry is not optional:

```tsx
import { useGridVirtualizer } from "@particle-academy/fancy-grid/virtual";

const scrollRef = useRef<HTMLDivElement>(null);
const virtual = useGridVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current });

<div ref={scrollRef} style={{ height: 600, overflow: "auto" }}>
  <FancyDataGrid gridId="orders" columns={columns} rows={rows} virtual={virtual} />
</div>
```

Rows outside the window are replaced by spacer rows rather than transforms, so
the table keeps the semantics screen readers depend on.

## Handles

Every element an agent might address carries one, rooted on `gridId`:

| Handle | On |
|---|---|
| `data-fancy-grid="<gridId>"` | the table |
| `data-fancy-grid-header="<columnId>"` | each header cell |
| `data-fancy-grid-sort="asc\|desc"` | a sorted header |
| `data-fancy-grid-row="<rowId>"` | each row |
| `data-fancy-grid-selected` | a selected row |
| `data-fancy-grid-cell="<columnId>"` | each cell |
| `data-fancy-grid-empty` | the empty state |

Together with the controlled state contract, that is what an MCP bridge needs:
an agent reads the grid, sorts it, filters it and points at one cell without
scraping the DOM or guessing selectors. `registerGridBridge` in
`@particle-academy/agent-integrations` is next.

## License

MIT
