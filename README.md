# @particle-academy/fancy-grid

[![Fancified](art/fancified.svg)](https://particle.academy)

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
  columnVisibility?: Record<string, boolean>;       // false hides; no entry shows
  columnPinning?:    { left?: string[]; right?: string[] };
  activeCell?:       { rowId: string; columnId: string } | null;
  editing?:          { rowId: string; columnId: string; draft: unknown; error?: string | null; pending?: boolean } | null;
}
```

It round-trips through JSON, so it survives a URL, a saved view, or an MCP tool
call. Sorting is **ascending on the first click for every column** — TanStack
defaults to descending-first on numeric columns, which makes the same gesture
mean different things depending on the data type.

Selection is keyed by row id, not index, so it survives a re-sort. Pass
`getRowId` when rows have no `id` field.

## Columns

A column with `columns` is a group: a header spanning its leaves, with no cells of
its own. It is still plain JSON, so an agent can emit it.

```ts
const columns: FancyGridColumn[] = [
  { id: "name", header: "Name", width: 180 },
  {
    id: "contact",
    header: "Contact",
    columns: [
      { id: "email", header: "Email" },
      { id: "phone", header: "Phone" },
    ],
  },
  { id: "balance", header: "Balance", align: "end" },
];

const state: FancyGridState = {
  columnVisibility: { phone: false },
  columnPinning: { left: ["name"], right: ["balance"] },
};
```

Hiding, pinning, sorting and filtering all address **leaf** ids, because those are
what have cells. A group shrinks as its leaves are hidden and disappears with the
last one, and one straddling the pin boundary becomes two header cells, one stuck
and one scrolling.

**Pinned columns need a scrolling parent** (`overflow: auto`), and they work under
virtualization. Offsets come from the width the browser laid out, so a column with
no declared `width` is fine. Pinned cells paint an opaque surface, white or
`zinc-900` by default. On any other background, set the surface to match:

```css
.my-card { --fancy-grid-surface: #fafaf9; }
```

## Editing

Declare it on the column. It is JSON, so an agent can emit it too:

```tsx
import { fancyGridControls } from "@particle-academy/fancy-grid/controls";

const columns: FancyGridColumn[] = [
  { id: "title", header: "Title", editable: { type: "text", required: true, maxLength: 80 } },
  { id: "count", header: "Count", editable: { type: "number", min: 0 } },
  { id: "stage", header: "Stage", editable: { type: "select", options: ["new", { value: "done", label: "Finished" }] } },
  { id: "notes", header: "Notes", editable: true }, // true is a text cell
];

<FancyDataGrid
  columns={columns}
  rows={rows}
  state={state}
  onStateChange={setState}
  controls={fancyGridControls}
  onCellEdit={async ({ rowId, columnId, value }) => {
    // Return { error: "..." } or throw to refuse; the message shows on the cell.
    await save(rowId, columnId, value);
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [columnId]: value } : r)));
  }}
/>
```

`./controls` is its own entry because `react-fancy` is an **optional peer**:
`npm install @particle-academy/react-fancy`. A read-only grid never needs it.
Without `controls`, no editor can open, though the handle still takes writes.

The grid **never changes `rows`**. `onCellEdit` receives `{ rowId, columnId, accessor,
value, previous, source }`, with `value` already validated and coerced: a number
column gives a number or `null`, and a blank is `null`, never `0`.

| Key | Not editing | Editing |
|---|---|---|
| Arrows | move the active cell | belong to the input |
| Enter / F2 | open the editor | Enter commits and moves down |
| Tab | leaves the grid | commits and opens the next editable cell |
| Shift+Tab | leaves the grid | commits and opens the previous one |
| Escape | | cancels and restores |

A double click also opens. A click on another cell commits; moving focus out of the
grid does not. If a commit is refused, the editor stays open with the message on it.

**Agents take the same path.** `ref.current.editCell(rowId, columnId, value)` applies
the column's rules, then your `validateCell`, then `onCellEdit` with `source: "agent"`,
and resolves to a result rather than throwing, so a value refused from the keyboard
is refused from a tool call with the same words. The open editor's `draft` is in
`state`, so an agent can see what a person is typing before it writes.

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
| `data-fancy-grid-header="<columnId>"` | each leaf header cell |
| `data-fancy-grid-header-group="<groupId>"` | a group's header cell |
| `data-fancy-grid-header-placeholder="<columnId>"` | the empty cell above an ungrouped column |
| `data-fancy-grid-pinned="left\|right"` | a stuck header or cell |
| `data-fancy-grid-pinned-edge` | the innermost stuck column on its side |
| `data-fancy-grid-sort="asc\|desc"` | a sorted header |
| `data-fancy-grid-row="<rowId>"` | each row |
| `data-fancy-grid-selected` | a selected row |
| `data-fancy-grid-cell="<columnId>"` | each cell |
| `data-fancy-grid-cell-row="<rowId>"` | each cell |
| `data-fancy-grid-editable` | a cell that can be edited |
| `data-fancy-grid-active` | the active cell |
| `data-fancy-grid-editing` | the cell with the open editor |
| `data-fancy-grid-editor="text\|number\|select"` | the editor inside it |
| `data-fancy-grid-edit-error` | why its last commit was refused |
| `data-fancy-grid-empty` | the empty state |

Together with the controlled state contract, that is what an MCP bridge needs:
an agent reads the grid, sorts it, filters it and points at one cell without
scraping the DOM or guessing selectors. `registerGridBridge` from
`@particle-academy/agent-integrations/bridges/grid` is that bridge, and
`createGridBridgeAdapter` points it at a mounted grid:

```tsx
const gridRef = useRef<FancyDataGridHandle>(null);
const stateRef = useRef(state);
stateRef.current = state;

useEffect(() => {
  const bridge = registerGridBridge(server, {
    adapter: createGridBridgeAdapter(gridRef, {
      id: "orders",
      getState: () => stateRef.current,
      setState,
    }),
  });
  return () => bridge.dispose();
}, []);

<FancyDataGrid ref={gridRef} gridId="orders" state={state} onStateChange={setState} … />
```

## License

MIT
