# Using @particle-academy/fancy-grid — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-grid @tanstack/react-table
# windowing is opt-in
npm install @tanstack/react-virtual
# editing and paste review need react-fancy
npm install @particle-academy/react-fancy
```

- **Peers:** `@tanstack/react-table ^8` (required), `react ^19`, `react-dom ^19`.
  Optional: `@tanstack/react-virtual ^3` (for `./virtual`) and
  `@particle-academy/react-fancy` `>=6.7.1 <7.0.0` (for `./controls`).
- The package has no runtime dependencies; you choose the TanStack versions.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package is the registry entry `fancy-grid`. Find
it with `search-components` ("data grid"), get exact commands with
`install-instructions`, and the source bundle with `get-component`. Vendored
source instead of the npm package: `npx fancy-cli@latest add fancy-grid`.

## API essentials

- **Entries:** the root (`FancyDataGrid`, `FancyGridColumn`, `FancyGridState`,
  `FancyDataGridHandle`), `./controls` (`fancyGridControls`) and `./virtual`
  (`useGridVirtualizer`).
- **Controlled state.** `state` + `onStateChange`; the callback always receives
  the FULL next state, never a slice. It is plain JSON (sorting, filters,
  rowSelection, pagination, columnVisibility, columnPinning, activeCell, editing,
  pendingPaste, pasteRefusal), so it survives a URL, a saved view or an MCP tool
  call.
- **JSON columns.** `id`, `header`, `accessor` (a dot-path, not a function),
  `sortable`, `align`, `width`, `columns` (a group), `editable`
  (`true`, or `{ type: "text" | "number" | "select", ... }`). `cell` is an
  optional custom renderer for humans; nothing needs it.
- **Edits.** The grid never changes `rows`. `onCellEdit({ rowId, columnId,
  accessor, value, previous, source })` receives a validated, coerced value;
  return `{ error }` or throw to refuse. `onCellEdits(edits)` takes a confirmed
  paste as one batch.
- **The handle.** `ref.current.editCell(rowId, columnId, value)` applies the same
  rules as the keyboard and resolves to a result rather than throwing.
  `stagePaste(text)`, `confirmPaste({ id, skipInvalid? })` and
  `rejectPaste(id)` drive the paste review in `state.pendingPaste`.
- **Server-side.** `serverSide` + `rowCount`: sorting, filtering and pagination
  become intent reported through `onStateChange`; the app fetches.
- **Stable handles**, rooted on `gridId`: `data-fancy-grid`, `-row="<rowId>"`,
  `-cell="<columnId>"`, `-header`, `-editing`, `-staged`, `-paste-review` and the
  rest in the README's Handles table.

## Traps

- **`columns` and `rows` must be stable references.** Hoist them or `useMemo`
  them; a new reference each render re-creates the table and can render-loop
  (the grid warns in development).
- **Rows are identified by id, not index.** Pass `getRowId` when rows have no
  `id` field, or selection and handles follow the wrong rows.
- **Without `controls={fancyGridControls}` no editor opens**, though the handle
  still takes writes.
- **`serverSide` needs `rowCount`.** Without server-side mode the grid sorts
  only the page it holds.
- **Pinned columns need a scrolling parent** (`overflow: auto`). On a background
  other than white / `zinc-900`, set `--fancy-grid-surface` to match.
- **A paste never writes directly.** It is staged in `state.pendingPaste` until
  someone confirms; a second paste cannot replace one under review.
- Sorting ascends on the first click for every column, numeric ones included.
- Copy prefixes string cells starting with `=`, `+`, `-`, `@`, tab or CR with `'`
  so spreadsheets do not run them; real numbers are untouched.

## MCP bridge

`registerGridBridge` from `@particle-academy/agent-integrations/bridges/grid`
exposes the grid to an agent: `grid_get`, `grid_sort`, `grid_filter`,
`grid_select_rows`, `grid_set_column_visibility`, `grid_pin_columns`,
`grid_edit_cell`, `grid_copy`, `grid_stage_paste`, `grid_get_staged_paste`,
`grid_confirm_paste`, `grid_reject_paste`. `createGridBridgeAdapter` points it
at a mounted grid:

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
