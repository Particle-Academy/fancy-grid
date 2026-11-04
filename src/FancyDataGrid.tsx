import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
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
 * What an omitted slice reads as, with one identity for the life of the page. A
 * `?? []` is a new array every render, and the engine reads a new array as "the
 * filters changed": it recomputes the model and resets the page index, that write
 * re-renders a controlled host, and the next render does it again.
 */
const NO_SORTING: SortingState = [];
const NO_FILTERS: ColumnFiltersState = [];
const NO_SELECTION: RowSelectionState = {};
const NO_VISIBILITY: VisibilityState = {};

/** A column with cells, and the groups it sits in. */
interface LeafColumn<TRow> {
  column: FancyGridColumn<TRow>;
  group: string[];
}

function collectLeaves<TRow>(columns: FancyGridColumn<TRow>[], group: string[] = []): LeafColumn<TRow>[] {
  return columns.flatMap((column) =>
    column.columns ? collectLeaves(column.columns, [...group, column.id]) : [{ column, group }],
  );
}

function toEngineColumn<TRow>(col: FancyGridColumn<TRow>): ColumnDef<TRow> {
  if (col.columns) {
    return { id: col.id, header: col.header, columns: col.columns.map(toEngineColumn) };
  }
  return {
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
  };
}

/** Key the row-number gutter's width is held under, beside the column ids. */
const GUTTER_KEY = "\u0000gutter";
/** `w-10`, until the browser has laid it out. */
const GUTTER_WIDTH = 40;

/**
 * The width each pinned column actually got.
 *
 * A table stretches and shrinks columns to fit and an undeclared column has no
 * width to read, so an offset computed from `width` overlaps or gaps as soon as
 * the two differ. Measured after every render (a virtual window can change what a
 * column needs) and on resize (a container or a font can change it with no render
 * at all). Only the headers are read: every cell in a column shares that width.
 */
function usePinnedWidths(
  tableRef: { current: HTMLTableElement | null },
  enabled: boolean,
  pinKey: string,
): Record<string, number> {
  const [widths, setWidths] = useState<Record<string, number>>({});

  const cells = useCallback(() => {
    const head = tableRef.current?.tHead;
    return head
      ? Array.from(
          head.querySelectorAll<HTMLElement>(
            "[data-fancy-grid-header][data-fancy-grid-pinned], [data-fancy-grid-gutter-corner]",
          ),
        )
      : [];
  }, [tableRef]);

  const measure = useCallback(() => {
    const next: Record<string, number> = {};
    for (const el of cells()) {
      const width = el.getBoundingClientRect().width;
      if (width > 0) next[el.getAttribute("data-fancy-grid-header") ?? GUTTER_KEY] = width;
    }
    setWidths((prev) => {
      const keys = Object.keys(next);
      const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
  }, [cells]);

  useLayoutEffect(() => {
    if (enabled) measure();
  });

  useEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    for (const el of cells()) observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, pinKey, cells, measure]);

  return widths;
}

/**
 * Opaque, because the body scrolls underneath. The surface is a token since the
 * grid cannot know what it sits on: set `--fancy-grid-surface` on any ancestor to
 * match a card that is not the default. The bottom rule is a shadow rather than a
 * border because a collapsed border belongs to the table and does not travel with
 * a sticky cell.
 */
const PINNED_CELL =
  "z-10 bg-[var(--fancy-grid-surface,#fff)] dark:bg-[var(--fancy-grid-surface,#18181b)] " +
  "shadow-[inset_0_-1px_0_0_#f4f4f5] dark:shadow-[inset_0_-1px_0_0_#27272a] " +
  "group-hover/fancy-grid-row:bg-zinc-50 dark:group-hover/fancy-grid-row:bg-[#1e1e21]";
const PINNED_HEAD =
  "z-20 bg-[var(--fancy-grid-surface,#fff)] dark:bg-[var(--fancy-grid-surface,#18181b)] " +
  "shadow-[inset_0_-1px_0_0_#e4e4e7] dark:shadow-[inset_0_-1px_0_0_#27272a]";
/** The seam between stuck and scrolling content, drawn the same way. */
const SEAM_LEFT = "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-zinc-300 dark:after:bg-zinc-700";
const SEAM_RIGHT = "after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-zinc-300 dark:after:bg-zinc-700";

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
  ref,
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
  columnLabels = "header",
  rowNumbers = false,
}: FancyDataGridProps<TRow>) {
  /** 0 -> A, 25 -> Z, 26 -> AA. Spreadsheet column labels are base-26 bijective. */
  const columnLetter = (index: number): string => {
    let n = index;
    let out = "";
    while (n >= 0) {
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26) - 1;
    }
    return out;
  };
  const spreadsheet = columnLabels === "letters";
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

  const tanstackColumns = useMemo<ColumnDef<TRow>[]>(() => columns.map(toEngineColumn), [columns]);
  const leaves = useMemo(() => collectLeaves(columns), [columns]);
  const leafById = useMemo(() => new Map(leaves.map((leaf) => [leaf.column.id, leaf.column])), [leaves]);

  // An id on both sides would render in both, which is one column twice.
  const pinning = useMemo<ColumnPinningState>(() => {
    const left = current.columnPinning?.left ?? [];
    return { left, right: (current.columnPinning?.right ?? []).filter((id) => !left.includes(id)) };
  }, [current.columnPinning]);

  const table = useReactTable<TRow>({
    data: rows,
    columns: tanstackColumns,
    state: {
      sorting: (current.sorting ?? NO_SORTING) as SortingState,
      columnFilters: (current.filters ?? NO_FILTERS) as ColumnFiltersState,
      rowSelection: (current.rowSelection ?? NO_SELECTION) as RowSelectionState,
      columnVisibility: (current.columnVisibility ?? NO_VISIBILITY) as VisibilityState,
      columnPinning: pinning,
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
    onColumnVisibilityChange: (updater) => {
      const base = (current.columnVisibility ?? {}) as VisibilityState;
      emit({ columnVisibility: typeof updater === "function" ? updater(base) : updater });
    },
    onColumnPinningChange: (updater) => {
      emit({ columnPinning: typeof updater === "function" ? updater(pinning) : updater });
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
    // The reset writes a whole `pagination` object, so on a grid that has none it
    // would invent one and silently cut the table to 25 rows.
    autoResetPageIndex: !serverSide && current.pagination !== undefined,
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
  // The window names positions in the model, and so must `data-index`: after a
  // sort a row's original index is some other row's position, and the virtualizer
  // would file this row's height under it.
  const visible = virtual
    ? virtual.items.flatMap((item) => {
        const row = modelRows[item.index];
        return row ? [{ row, position: item.index }] : [];
      })
    : modelRows.map((row, position) => ({ row, position }));

  const tableRef = useRef<HTMLTableElement | null>(null);
  const leftLeaves = table.getLeftVisibleLeafColumns();
  const rightLeaves = table.getRightVisibleLeafColumns();
  const hasPinned = leftLeaves.length + rightLeaves.length > 0;
  const stickGutter = rowNumbers && leftLeaves.length > 0;
  const measured = usePinnedWidths(
    tableRef,
    hasPinned,
    [...leftLeaves, ...rightLeaves].map((c) => c.id).join("\u0000") + String(rowNumbers),
  );

  const leafWidth = (id: string): number => measured[id] ?? leafById.get(id)?.width ?? 0;
  const pinOffsets = new Map<string, { side: "left" | "right"; offset: number; edge: boolean }>();
  let leftEdge = stickGutter ? (measured[GUTTER_KEY] ?? GUTTER_WIDTH) : 0;
  leftLeaves.forEach((c, i) => {
    pinOffsets.set(c.id, { side: "left", offset: leftEdge, edge: i === leftLeaves.length - 1 });
    leftEdge += leafWidth(c.id);
  });
  let rightEdge = 0;
  [...rightLeaves].reverse().forEach((c, i) => {
    pinOffsets.set(c.id, { side: "right", offset: rightEdge, edge: i === rightLeaves.length - 1 });
    rightEdge += leafWidth(c.id);
  });

  /** Style + handles for a cell stuck in place. A group sticks by its outermost leaf. */
  const pinProps = (leafIds: string[]) => {
    const first = pinOffsets.get(leafIds[0]);
    if (!first) return null;
    const pin = first.side === "left" ? first : (pinOffsets.get(leafIds[leafIds.length - 1]) ?? first);
    const edge = leafIds.some((id) => pinOffsets.get(id)?.edge);
    return {
      style: { position: "sticky" as const, [pin.side]: pin.offset },
      attrs: {
        "data-fancy-grid-pinned": pin.side,
        "data-fancy-grid-pinned-edge": edge ? "" : undefined,
      },
      seam: edge ? (pin.side === "left" ? SEAM_LEFT : SEAM_RIGHT) : "",
    };
  };

  useImperativeHandle(ref, () => ({
    getColumnIds: () => leaves.map((leaf) => leaf.column.id),
    getRowIds: () => table.getRowModel().rows.map((row) => row.id),
    getColumnInfo: () =>
      leaves.map(({ column, group }) => ({
        id: column.id,
        header: column.header,
        group,
        visible: current.columnVisibility?.[column.id] !== false,
        pinned: pinning.left?.includes(column.id) ? "left" : pinning.right?.includes(column.id) ? "right" : null,
        sortable: column.sortable ?? false,
        filterable: column.filterable ?? false,
      })),
  }));

  // Spacer rows rather than transforms: a translated <tr> is not a valid table
  // row box in every engine, and spacers keep the table semantics screen
  // readers depend on.
  const padTop = virtual && virtual.items.length > 0 ? virtual.items[0].start : 0;
  const padBottom =
    virtual && virtual.items.length > 0
      ? Math.max(0, virtual.totalSize - virtual.items[virtual.items.length - 1].end)
      : 0;

  const columnSpan = table.getVisibleLeafColumns().length + (rowNumbers ? 1 : 0);
  // Built per family rather than from `getHeaderGroups()`, which merges a group
  // straddling the pin boundary into one cell: it would then be wholly stuck or
  // wholly scrolling, over columns that do not move together. Aligned from the
  // bottom, where every family has its leaves.
  const families = [table.getLeftHeaderGroups(), table.getCenterHeaderGroups(), table.getRightHeaderGroups()];
  const headerDepth = Math.max(...families.map((family) => family.length));
  const headerGroups = Array.from({ length: headerDepth }, (_, level) => ({
    id: String(level),
    headers: families.flatMap((family) => family[family.length - headerDepth + level]?.headers ?? []),
  }));
  // Letters address leaves; a group row above them would be labelled by nothing.
  const shownHeaderGroups = spreadsheet ? headerGroups.slice(-1) : headerGroups;

  return (
    <table
      ref={tableRef}
      data-fancy-grid={gridId}
      data-fancy-grid-server-side={serverSide || undefined}
      className={["w-full border-collapse text-sm", className].filter(Boolean).join(" ")}
    >
      <thead>
        {shownHeaderGroups.map((group, groupIndex) => (
          <tr key={group.id}>
            {rowNumbers && groupIndex === 0 && (
              // The corner above the row numbers. It stays EMPTY: numbering it
              // is the classic off-by-one that makes every row label wrong.
              <th
                data-fancy-grid-gutter-corner=""
                rowSpan={shownHeaderGroups.length > 1 ? shownHeaderGroups.length : undefined}
                style={stickGutter ? { position: "sticky", left: 0 } : undefined}
                className={["w-10 border-b border-zinc-200 dark:border-zinc-800", stickGutter ? PINNED_HEAD : ""].join(" ")}
              />
            )}
            {group.headers.map((header, colIndex) => {
              const leafIds = header
                .getLeafHeaders()
                .filter((h) => h.subHeaders.length === 0)
                .map((h) => h.column.id);
              const pin = pinProps(leafIds);

              if (header.isPlaceholder) {
                return (
                  <th
                    key={header.id}
                    aria-hidden="true"
                    colSpan={header.colSpan}
                    data-fancy-grid-header-placeholder={header.column.id}
                    {...pin?.attrs}
                    style={pin?.style}
                    className={[pin ? PINNED_HEAD : "", pin?.seam ?? ""].join(" ")}
                  />
                );
              }

              if (header.column.columns.length > 0) {
                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    scope="colgroup"
                    data-fancy-grid-header-group={header.column.id}
                    {...pin?.attrs}
                    style={pin?.style}
                    className={[
                      "border-b border-zinc-200 px-3 py-2 text-center font-medium text-zinc-600",
                      "dark:border-zinc-800 dark:text-zinc-400",
                      pin ? PINNED_HEAD : "",
                      pin?.seam ?? "",
                    ].join(" ")}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              }

              const col = leafById.get(header.column.id);
              const sortable = header.column.getCanSort();
              const dir = header.column.getIsSorted();

              return (
                <th
                  key={header.id}
                  data-fancy-grid-header={header.column.id}
                  data-fancy-grid-label={spreadsheet ? columnLetter(colIndex) : undefined}
                  data-fancy-grid-sort={dir || undefined}
                  {...pin?.attrs}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  scope="col"
                  style={{ ...(col?.width ? { width: col.width, minWidth: col.width } : null), ...pin?.style }}
                  className={[
                    "border-b border-zinc-200 px-3 py-2 font-medium text-zinc-600",
                    "dark:border-zinc-800 dark:text-zinc-400",
                    ALIGN[col?.align ?? "start"],
                    sortable ? "cursor-pointer select-none" : "",
                    pin ? PINNED_HEAD : "",
                    pin?.seam ?? "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                >
                  {spreadsheet
                    ? columnLetter(colIndex)
                    : flexRender(header.column.columnDef.header, header.getContext())}
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
            <td colSpan={columnSpan} style={{ height: padTop }} />
          </tr>
        )}

        {visible.length === 0 && (
          <tr data-fancy-grid-empty="">
            <td colSpan={columnSpan} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
              {emptyMessage}
            </td>
          </tr>
        )}

        {visible.map(({ row, position }) => (
          <tr
            key={row.id}
            data-fancy-grid-row={row.id}
            data-fancy-grid-selected={row.getIsSelected() || undefined}
            ref={virtual?.measureElement}
            data-index={virtual ? position : undefined}
            className="group/fancy-grid-row border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
          >
            {rowNumbers && (
              <td
                data-fancy-grid-gutter={row.index + 1}
                style={stickGutter ? { position: "sticky", left: 0 } : undefined}
                className={[
                  "w-10 select-none border-r border-zinc-200 bg-zinc-50 px-2 py-2 text-right font-mono text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40",
                  // Opaque when stuck, or the scrolling cells show through it.
                  stickGutter ? "z-10 dark:bg-zinc-900" : "",
                ].join(" ")}
              >
                {row.index + 1}
              </td>
            )}
            {row.getVisibleCells().map((cell, colIndex) => {
              const col = leafById.get(cell.column.id);
              // A1 addresses the first DATA row as 1.
              const address = spreadsheet ? `${columnLetter(colIndex)}${row.index + 1}` : null;
              const pin = pinProps([cell.column.id]);

              return (
                <td
                  key={cell.id}
                  data-fancy-grid-cell={cell.column.id}
                  data-fancy-grid-address={address ?? undefined}
                  {...pin?.attrs}
                  style={pin?.style}
                  className={[
                    "px-3 py-2 text-zinc-800 dark:text-zinc-200",
                    ALIGN[col?.align ?? "start"],
                    pin ? PINNED_CELL : "",
                    pin?.seam ?? "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}

        {padBottom > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columnSpan} style={{ height: padBottom }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

FancyDataGrid.displayName = "FancyDataGrid";
