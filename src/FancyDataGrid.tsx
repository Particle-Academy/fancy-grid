import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import type { FancyDataGridProps, FancyGridColumn, FancyGridState } from "./types";

/** Read a dot-path out of a row. Missing segments yield `undefined`, never throw. */
function readPath(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, row);
}

const ALIGN: Record<string, string> = {
  start: "text-left",
  center: "text-center",
  end: "text-right",
};

/**
 * Warn once when `columns` or `rows` change identity every render.
 *
 * TanStack Table's most-reported failure: a `columns` array built inline is a
 * new reference each render, which re-creates the table and can loop forever.
 * The symptom is a frozen tab with no error, so it is worth naming out loud
 * rather than leaving to the docs nobody reads at 2am.
 */
function useStableReferenceWarning(gridId: string, columns: unknown, rows: unknown): void {
  const prev = useRef<{ columns: unknown; rows: unknown }>({ columns, rows });
  const churn = useRef(0);
  const warned = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || warned.current) return;

    const changed = prev.current.columns !== columns || prev.current.rows !== rows;
    prev.current = { columns, rows };
    churn.current = changed ? churn.current + 1 : 0;

    // Five consecutive identity changes is not a data update, it is an inline
    // literal. A real data change settles.
    if (churn.current >= 5) {
      warned.current = true;
      console.warn(
        `[fancy-grid] Grid "${gridId}": \`columns\`/\`rows\` changed identity on 5 renders in a row. ` +
          "They are almost certainly built inline. Hoist them or wrap in useMemo — TanStack Table " +
          "re-creates the table on every new reference, which can render-loop.",
      );
    }
  });
}

/**
 * A data grid whose state is JSON and whose every element has a stable handle.
 *
 * TanStack Table does the row/column work; this owns the surface, the handles,
 * and the state contract. The engine is a PEER — installing this package never
 * drags a table engine into a tree that does not use one, and nothing else in
 * the Fancy suite gains a TanStack dependency because this exists.
 *
 * The Human+ half is the part that is easy to skip: `state` is one serializable
 * object, and every row, cell and header carries a `data-fancy-grid-*` handle
 * keyed by `gridId` plus row id plus column id. An agent can read the grid, sort
 * it, filter it, and point at one cell without scraping the DOM or guessing.
 */
export function FancyDataGrid<TRow = Record<string, unknown>>({
  gridId,
  columns,
  rows,
  state,
  onStateChange,
  defaultState,
  getRowId,
  serverSide = false,
  rowCount,
  virtual,
  emptyMessage = "No rows",
  className,
}: FancyDataGridProps<TRow>) {
  useStableReferenceWarning(gridId, columns, rows);

  const [internal, setInternal] = useState<FancyGridState>(defaultState ?? {});
  const current = state ?? internal;

  // One channel for every state change: the caller always receives the FULL
  // next state, so a controlled host never has to merge slices to know what the
  // grid is showing — and neither does an agent reading it back.
  const emit = useCallback(
    (patch: Partial<FancyGridState>) => {
      const next = { ...current, ...patch };
      if (state === undefined) setInternal(next);
      onStateChange?.(next);
    },
    [current, state, onStateChange],
  );

  const tanstackColumns = useMemo<ColumnDef<TRow>[]>(
    () =>
      columns.map((col: FancyGridColumn<TRow>) => ({
        id: col.id,
        header: col.header,
        accessorFn: (row: TRow) => readPath(row, col.accessor ?? col.id),
        enableSorting: col.sortable ?? false,
        enableColumnFilter: col.filterable ?? false,
        size: col.width,
        cell: col.cell
          ? (ctx) => col.cell!(ctx.getValue(), ctx.row.original)
          : (ctx) => {
              const value = ctx.getValue();
              return value === null || value === undefined ? "" : String(value);
            },
      })),
    [columns],
  );

  const table = useReactTable<TRow>({
    data: rows,
    columns: tanstackColumns,
    state: {
      sorting: (current.sorting ?? []) as SortingState,
      columnFilters: (current.filters ?? []) as ColumnFiltersState,
      rowSelection: (current.rowSelection ?? {}) as RowSelectionState,
      ...(current.pagination ? { pagination: current.pagination as PaginationState } : {}),
    },
    getRowId: getRowId
      ? (row, index) => getRowId(row, index)
      : (row, index) => {
          const id = (row as { id?: unknown }).id;
          return id === undefined || id === null ? String(index) : String(id);
        },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater((current.sorting ?? []) as SortingState) : updater;
      emit({ sorting: next as FancyGridState["sorting"] });
    },
    onColumnFiltersChange: (updater) => {
      const base = (current.filters ?? []) as ColumnFiltersState;
      const next = typeof updater === "function" ? updater(base) : updater;
      emit({ filters: next as FancyGridState["filters"] });
    },
    onRowSelectionChange: (updater) => {
      const base = (current.rowSelection ?? {}) as RowSelectionState;
      const next = typeof updater === "function" ? updater(base) : updater;
      emit({ rowSelection: next });
    },
    onPaginationChange: (updater) => {
      const base = (current.pagination ?? { pageIndex: 0, pageSize: 25 }) as PaginationState;
      const next = typeof updater === "function" ? updater(base) : updater;
      emit({ pagination: next });
    },
    // Server-side mode hands sorting/filtering/pagination to the host and keeps
    // the grid reporting intent only. Without `manual*` the grid would re-sort
    // the ONE PAGE it holds and present it as the sorted whole — a wrong answer
    // that looks entirely correct.
    // Ascending on the first click, for EVERY column. TanStack defaults to
    // descending-first on numeric columns and ascending-first on text, so the
    // same gesture means different things depending on the data type — and the
    // JSON state an agent reads back flips with it. One rule is worth more here
    // than matching the engine's default.
    sortDescFirst: false,
    manualSorting: serverSide,
    manualFiltering: serverSide,
    manualPagination: serverSide,
    ...(serverSide && rowCount !== undefined ? { rowCount } : {}),
    getCoreRowModel: getCoreRowModel(),
    ...(serverSide
      ? {}
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          ...(current.pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
        }),
  });

  if (process.env.NODE_ENV !== "production" && serverSide && rowCount === undefined) {
    console.warn(
      `[fancy-grid] Grid "${gridId}": \`serverSide\` without \`rowCount\`. The grid holds one page ` +
        "and cannot know the total, so pagination will under-report. Pass the count from the server.",
    );
  }

  const modelRows = table.getRowModel().rows;
  const visible = virtual ? virtual.items.map((item) => modelRows[item.index]).filter(Boolean) : modelRows;

  // Spacer rows rather than transforms: a translated <tr> is not a valid table
  // row box in every engine, and spacers keep the table semantics screen
  // readers depend on.
  const padTop = virtual && virtual.items.length > 0 ? virtual.items[0].start : 0;
  const padBottom =
    virtual && virtual.items.length > 0
      ? Math.max(0, virtual.totalSize - virtual.items[virtual.items.length - 1].end)
      : 0;

  return (
    <table
      data-fancy-grid={gridId}
      data-fancy-grid-server-side={serverSide || undefined}
      className={["w-full border-collapse text-sm", className].filter(Boolean).join(" ")}
    >
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const col = columns.find((c) => c.id === header.column.id);
              const sortable = header.column.getCanSort();
              const dir = header.column.getIsSorted();

              return (
                <th
                  key={header.id}
                  data-fancy-grid-header={header.column.id}
                  data-fancy-grid-sort={dir || undefined}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  scope="col"
                  style={col?.width ? { width: col.width } : undefined}
                  className={[
                    "border-b border-zinc-200 px-3 py-2 font-medium text-zinc-600",
                    "dark:border-zinc-800 dark:text-zinc-400",
                    ALIGN[col?.align ?? "start"],
                    sortable ? "cursor-pointer select-none" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {dir === "asc" ? " ↑" : dir === "desc" ? " ↓" : ""}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>

      <tbody>
        {padTop > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columns.length} style={{ height: padTop }} />
          </tr>
        )}

        {visible.length === 0 && (
          <tr data-fancy-grid-empty="">
            <td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
              {emptyMessage}
            </td>
          </tr>
        )}

        {visible.map((row) => (
          <tr
            key={row.id}
            data-fancy-grid-row={row.id}
            data-fancy-grid-selected={row.getIsSelected() || undefined}
            ref={virtual?.measureElement}
            data-index={virtual ? row.index : undefined}
            className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
          >
            {row.getVisibleCells().map((cell) => {
              const col = columns.find((c) => c.id === cell.column.id);

              return (
                <td
                  key={cell.id}
                  data-fancy-grid-cell={cell.column.id}
                  className={[
                    "px-3 py-2 text-zinc-800 dark:text-zinc-200",
                    ALIGN[col?.align ?? "start"],
                  ].join(" ")}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}

        {padBottom > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columns.length} style={{ height: padBottom }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

FancyDataGrid.displayName = "FancyDataGrid";
