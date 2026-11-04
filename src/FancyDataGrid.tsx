import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
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
import { coerceCellValue, isSameCellValue, resolveEditor } from "./editing";
import type {
  FancyDataGridProps,
  FancyGridCellEdit,
  FancyGridCellRef,
  FancyGridColumn,
  FancyGridEditResult,
  FancyGridEditing,
  FancyGridState,
} from "./types";

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
 * Scroll a focused cell out from under the pinned columns.
 *
 * A cell beneath a sticky column is inside the scrollport, so to the browser it is
 * already in view and `focus()` scrolls nothing: the active cell is simply hidden.
 * `scroll-margin` does not cover it either. It widens the box being aligned, and
 * with margins on both sides that box outgrows the gap between the pins.
 */
function revealPastPins(cell: HTMLElement | null, leftEdge: number, rightEdge: number): void {
  if (!cell || cell.hasAttribute("data-fancy-grid-pinned") || leftEdge + rightEdge === 0) return;
  let scroller = cell.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
  if (!scroller) return;

  const box = scroller.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const clearLeft = box.left + scroller.clientLeft + leftEdge;
  const clearRight = box.left + scroller.clientLeft + scroller.clientWidth - rightEdge;
  if (rect.left < clearLeft) scroller.scrollLeft -= clearLeft - rect.left;
  else if (rect.right > clearRight) scroller.scrollLeft += rect.right - clearRight;
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
  onCellEdit,
  validateCell,
  controls,
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
  // Read through a ref because a write can settle long after the render that
  // started it, and merging into that render's state would undo everything since.
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });
  const emit = useCallback(
    (patch: Partial<FancyGridState>) => {
      const next = { ...latest.current, ...patch };
      if (state === undefined) setInternal(next);
      onStateChange?.(next);
    },
    [state, onStateChange],
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

  const interactive = leaves.some((leaf) => resolveEditor(leaf.column) !== null);

  /**
   * The path every write takes, whoever made it. Column rules, then the host's
   * validator, and only then is it an edit.
   */
  const checkEdit = (
    rowId: string,
    columnId: string,
    raw: unknown,
    source: FancyGridCellEdit["source"],
  ): { failure: Extract<FancyGridEditResult, { ok: false }> } | { edit: FancyGridCellEdit; changed: boolean } => {
    const refuse = (code: Extract<FancyGridEditResult, { ok: false }>["code"], error: string) => ({
      failure: { ok: false as const, code, error },
    });
    const column = leafById.get(columnId);
    if (!column) return refuse("unknown-column", `Unknown column "${columnId}".`);
    const row = table.getCoreRowModel().rowsById[rowId];
    if (!row) return refuse("unknown-row", `Unknown row "${rowId}".`);
    const editor = resolveEditor(column);
    if (!editor) return refuse("not-editable", `Column "${columnId}" is not editable.`);

    const coerced = coerceCellValue(editor, raw);
    if (!coerced.ok) return refuse("invalid", coerced.error);

    const accessor = column.accessor ?? column.id;
    const previous = readPath(row.original, accessor);
    const edit: FancyGridCellEdit = { rowId, columnId, accessor, value: coerced.value, previous, source };
    const hostRefusal = validateCell?.(edit);
    if (hostRefusal) return refuse("invalid", hostRefusal);

    return { edit, changed: !isSameCellValue(previous, coerced.value) };
  };

  /** Hand an edit to the host. Synchronous when the host is, so a sync host gets one state change. */
  const deliverEdit = (edit: FancyGridCellEdit): FancyGridEditResult | Promise<FancyGridEditResult> => {
    const rejected = (error: string): FancyGridEditResult => ({ ok: false, code: "rejected", error });
    const settled = (out: void | { error: string }): FancyGridEditResult =>
      out && typeof out === "object" && "error" in out
        ? rejected(out.error)
        : { ok: true, value: edit.value, changed: true };
    const failed = (e: unknown) => rejected(e instanceof Error ? e.message : String(e));

    if (!onCellEdit) return rejected("This grid has no onCellEdit to receive the write.");
    try {
      const out = onCellEdit(edit);
      return out instanceof Promise ? out.then(settled, failed) : settled(out);
    } catch (e) {
      return failed(e);
    }
  };

  const applyEdit = async (
    rowId: string,
    columnId: string,
    raw: unknown,
    source: FancyGridCellEdit["source"],
  ): Promise<FancyGridEditResult> => {
    const check = checkEdit(rowId, columnId, raw, source);
    if ("failure" in check) return check.failure;
    if (!check.changed) return { ok: true, value: check.edit.value, changed: false };
    return deliverEdit(check.edit);
  };

  const draftFor = (rowId: string, columnId: string): unknown => {
    const row = table.getCoreRowModel().rowsById[rowId];
    const column = leafById.get(columnId);
    const value = row && column ? readPath(row.original, column.accessor ?? column.id) : null;
    return value ?? null;
  };

  /** Columns in the order they are on screen, which pinning changes. */
  const displayColumns = () =>
    [...leftLeaves, ...table.getCenterVisibleLeafColumns(), ...rightLeaves].map((c) => c.id);

  const warnedNoControls = useRef(false);
  const startEditing = (rowId: string, columnId: string): void => {
    const editor = resolveEditor(leafById.get(columnId));
    if (!editor) return;
    if (!controls?.[editor.type]) {
      if (process.env.NODE_ENV !== "production" && !warnedNoControls.current) {
        warnedNoControls.current = true;
        console.warn(
          `[fancy-grid] Grid "${gridId}": column "${columnId}" is editable but no \`controls\` supply a ` +
            `"${editor.type}" editor, so none can open. Pass \`fancyGridControls\` from ` +
            "@particle-academy/fancy-grid/controls. Agents can still write through the handle.",
        );
      }
      return;
    }
    emit({ activeCell: { rowId, columnId }, editing: { rowId, columnId, draft: draftFor(rowId, columnId), error: null } });
  };

  /**
   * Commit the open editor. On success, `next` says where focus goes; on a refusal
   * the editor stays where it is with the message on it.
   */
  const commitEditing = (next: { activeCell: FancyGridCellRef; open?: boolean }): void => {
    const editing = latest.current.editing;
    if (!editing || editing.pending) return;
    const { rowId, columnId, draft } = editing;
    const isStillOpen = () => {
      const open = latest.current.editing;
      return open?.rowId === rowId && open.columnId === columnId;
    };
    const finish = () =>
      emit({
        activeCell: next.activeCell,
        editing: next.open
          ? { ...next.activeCell, draft: draftFor(next.activeCell.rowId, next.activeCell.columnId), error: null }
          : null,
      });
    const refuse = (held: FancyGridEditing, error: string) => emit({ editing: { ...held, pending: false, error } });

    const check = checkEdit(rowId, columnId, draft, "human");
    if ("failure" in check) return refuse(editing, check.failure.error);
    if (!check.changed) return finish();

    const delivered = deliverEdit(check.edit);
    if (delivered instanceof Promise) {
      emit({ editing: { ...editing, pending: true, error: null } });
      void delivered.then((result) => {
        if (!isStillOpen()) return; // Cancelled while it was in flight.
        if (result.ok) finish();
        else refuse(editing, result.error);
      });
    } else if (delivered.ok) {
      finish();
    } else {
      refuse(editing, delivered.error);
    }
  };

  /** The next editable cell in reading order, or `null` at either end of the table. */
  const nextEditableCell = (from: FancyGridCellRef, direction: 1 | -1): FancyGridCellRef | null => {
    const order = displayColumns();
    const rowIds = modelRows.map((r) => r.id);
    let r = rowIds.indexOf(from.rowId);
    let c = order.indexOf(from.columnId);
    if (r < 0 || c < 0) return null;
    for (;;) {
      c += direction;
      if (c < 0 || c >= order.length) {
        r += direction;
        c = direction === 1 ? 0 : order.length - 1;
      }
      if (r < 0 || r >= rowIds.length) return null;
      if (resolveEditor(leafById.get(order[c]))) return { rowId: rowIds[r], columnId: order[c] };
    }
  };

  // Focus follows the state, so an agent or a host moving the active cell moves it
  // too. It only ever moves if the person is already in the grid: `wantsFocus` is
  // set by a gesture here and cleared when focus goes somewhere else on purpose.
  const wantsFocus = useRef(false);
  useEffect(() => {
    const root = tableRef.current;
    if (!interactive || !wantsFocus.current || !root) return;
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;

    const editorInput = root.querySelector<HTMLElement>(
      "[data-fancy-grid-editor] input:not([type=hidden]), [data-fancy-grid-editor] select, [data-fancy-grid-editor] textarea",
    );
    if (editorInput) {
      if (active === editorInput) return;
      editorInput.focus();
      if (editorInput instanceof HTMLInputElement) editorInput.select();
      revealPastPins(editorInput.closest("td"), leftEdge, rightEdge);
      return;
    }
    const cell = root.querySelector<HTMLElement>("[data-fancy-grid-active]");
    if (cell && !cell.contains(active)) {
      cell.focus();
      revealPastPins(cell, leftEdge, rightEdge);
    }
  });

  const cellFrom = (target: EventTarget | null): (FancyGridCellRef & { el: HTMLElement }) | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>("[data-fancy-grid-cell]");
    const rowId = el?.getAttribute("data-fancy-grid-cell-row");
    const columnId = el?.getAttribute("data-fancy-grid-cell");
    return el && rowId !== null && rowId !== undefined && columnId ? { el, rowId, columnId } : null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableElement>): void => {
    if (e.nativeEvent.isComposing) return;
    wantsFocus.current = true;
    const editing = latest.current.editing;

    if (editing) {
      if (!(e.target instanceof Element) || !e.target.closest("[data-fancy-grid-editor]")) return;
      const here = { rowId: editing.rowId, columnId: editing.columnId };

      if (e.key === "Escape") {
        e.preventDefault();
        emit({ editing: null, activeCell: here });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const below = modelRows[modelRows.findIndex((r) => r.id === editing.rowId) + 1];
        commitEditing({ activeCell: below ? { rowId: below.id, columnId: editing.columnId } : here });
      } else if (e.key === "Tab") {
        const target = nextEditableCell(here, e.shiftKey ? -1 : 1);
        const check = checkEdit(here.rowId, here.columnId, editing.draft, "human");
        // Off the end of the table, a valid cell lets focus leave as Tab should.
        if (target || "failure" in check || editing.pending) e.preventDefault();
        commitEditing(target ? { activeCell: target, open: true } : { activeCell: here });
      }
      return;
    }

    // Only a key pressed ON a cell. One pressed on a button inside a custom cell
    // belongs to that button.
    const from = e.target instanceof HTMLElement && e.target.hasAttribute("data-fancy-grid-cell") ? cellFrom(e.target) : null;
    if (!from || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEditing(from.rowId, from.columnId);
      return;
    }

    const steps: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();

    const order = displayColumns();
    const r = modelRows.findIndex((row) => row.id === from.rowId);
    const c = order.indexOf(from.columnId);
    const nextR = Math.min(Math.max(r + step[0], 0), modelRows.length - 1);
    const nextC = Math.min(Math.max(c + step[1], 0), order.length - 1);
    if (virtual && !virtual.items.some((item) => item.index === nextR)) virtual.scrollToIndex?.(nextR);
    emit({ activeCell: { rowId: modelRows[nextR].id, columnId: order[nextC] } });
  };

  const handleFocus = (e: FocusEvent<HTMLTableElement>): void => {
    wantsFocus.current = true;
    const to = cellFrom(e.target);
    if (!to) return;
    const editing = latest.current.editing;
    const target = { rowId: to.rowId, columnId: to.columnId };
    if (editing) {
      // A click on another cell commits this one. If it is refused, the editor
      // stays open and the focus effect takes the person back to it.
      if (editing.rowId !== to.rowId || editing.columnId !== to.columnId) commitEditing({ activeCell: target });
      return;
    }
    const active = latest.current.activeCell;
    if (active?.rowId !== to.rowId || active.columnId !== to.columnId) emit({ activeCell: target });
  };

  const handleBlur = (e: FocusEvent<HTMLTableElement>): void => {
    // `relatedTarget` is null when a focused row leaves the virtual window, and
    // that must not count as the person having gone elsewhere.
    if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) wantsFocus.current = false;
  };

  const handleDoubleClick = (e: MouseEvent<HTMLTableElement>): void => {
    const from = cellFrom(e.target);
    if (from && !latest.current.editing) {
      wantsFocus.current = true;
      startEditing(from.rowId, from.columnId);
    }
  };

  useImperativeHandle(ref, () => ({
    editCell: (rowId, columnId, value, options) => applyEdit(rowId, columnId, value, options?.source ?? "agent"),
    validateCell: (rowId, columnId, value) => {
      const check = checkEdit(rowId, columnId, value, "agent");
      return "failure" in check ? check.failure : { ok: true, value: check.edit.value, changed: check.changed };
    },
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
        editor: resolveEditor(column),
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

  const activeShown = visible.some((v) => v.row.id === current.activeCell?.rowId);
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
      role={interactive ? "grid" : undefined}
      className={["w-full border-collapse text-sm", className].filter(Boolean).join(" ")}
      {...(interactive
        ? { onKeyDown: handleKeyDown, onFocus: handleFocus, onBlur: handleBlur, onDoubleClick: handleDoubleClick }
        : {})}
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

        {visible.map(({ row, position }, rowIndex) => (
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
              const editor = resolveEditor(col);
              const isActive = current.activeCell?.rowId === row.id && current.activeCell.columnId === cell.column.id;
              const isEditing = current.editing?.rowId === row.id && current.editing.columnId === cell.column.id;
              const Control = isEditing && editor ? controls?.[editor.type] : undefined;
              // One tab stop in the whole grid: the active cell, or the first one.
              const isTabStop = isActive || (!activeShown && rowIndex === 0 && colIndex === 0);

              return (
                <td
                  key={cell.id}
                  data-fancy-grid-cell={cell.column.id}
                  data-fancy-grid-cell-row={row.id}
                  data-fancy-grid-address={address ?? undefined}
                  data-fancy-grid-editable={editor ? "" : undefined}
                  data-fancy-grid-active={isActive ? "" : undefined}
                  data-fancy-grid-editing={Control ? "" : undefined}
                  aria-invalid={Control && current.editing?.error ? true : undefined}
                  tabIndex={interactive ? (isTabStop ? 0 : -1) : undefined}
                  {...pin?.attrs}
                  style={pin?.style}
                  className={[
                    "px-3 py-2 text-zinc-800 dark:text-zinc-200",
                    ALIGN[col?.align ?? "start"],
                    interactive ? "outline-none" : "",
                    isActive && !Control ? "outline-2 -outline-offset-2 outline-blue-500" : "",
                    Control ? "!p-1" : "",
                    pin ? PINNED_CELL : "",
                    pin?.seam ?? "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {Control && editor && current.editing ? (
                    <>
                      <div data-fancy-grid-editor={editor.type}>
                        <Control
                          editor={editor}
                          draft={current.editing.draft}
                          onDraftChange={(draft) => {
                            const open = latest.current.editing;
                            if (open) emit({ editing: { ...open, draft, error: null } });
                          }}
                          invalid={Boolean(current.editing.error)}
                          disabled={Boolean(current.editing.pending)}
                          label={col?.header ?? cell.column.id}
                        />
                      </div>
                      {current.editing.error ? (
                        <p
                          role="alert"
                          data-fancy-grid-edit-error=""
                          className="mt-1 px-1 text-xs font-normal text-red-600 dark:text-red-400"
                        >
                          {current.editing.error}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    flexRender(cell.column.columnDef.cell, cell.getContext())
                  )}
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
