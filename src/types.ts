import type { Key, ReactNode } from "react";

/**
 * A column, described as data rather than as React.
 *
 * Everything an agent needs to emit a working grid is a primitive or a plain
 * object — no `columnHelper`, no render functions, no class instances. `cell` is
 * the escape hatch for a human writing custom markup; a grid never needs it to
 * function, which is what keeps the whole definition agent-emittable.
 */
export interface FancyGridColumn<TRow = Record<string, unknown>> {
  /** Stable identity. Also the `data-fancy-grid-cell` value an agent addresses. */
  id: string;
  /** Header text. */
  header: string;
  /**
   * Dot-path into the row (`"customer.name"`). Defaults to `id`. A path rather
   * than a function so a column survives JSON round-tripping.
   */
  accessor?: string;
  sortable?: boolean;
  filterable?: boolean;
  align?: "start" | "center" | "end";
  /** Fixed width in px. Omit to size from content. */
  width?: number;
  /** Custom cell renderer. Human-authored only — agents use `accessor`. */
  cell?: (value: unknown, row: TRow) => ReactNode;
}

/** One sort instruction. Mirrors TanStack's `SortingState` entry exactly. */
export interface FancyGridSort {
  id: string;
  desc: boolean;
}

/** One filter instruction. Mirrors TanStack's `ColumnFiltersState` entry. */
export interface FancyGridFilter {
  id: string;
  value: string;
}

export interface FancyGridPagination {
  pageIndex: number;
  pageSize: number;
}

/**
 * The whole grid, as JSON.
 *
 * Deliberately isomorphic to the TanStack state slices it drives, so the state
 * an agent reads is the state the engine runs on — no translation layer to
 * disagree with itself. It serializes, so it round-trips through a URL, a saved
 * view, or an MCP tool call without loss.
 */
export interface FancyGridState {
  sorting?: FancyGridSort[];
  filters?: FancyGridFilter[];
  /** Keyed by row id — see `getRowId`. */
  rowSelection?: Record<string, boolean>;
  pagination?: FancyGridPagination;
}

/**
 * The slice of a TanStack virtualizer the grid renders from.
 *
 * Structural rather than an import: the root entry must not pull in
 * `@tanstack/react-virtual`, which is an OPTIONAL peer. Consumers who want
 * windowing import `useGridVirtualizer` from `@particle-academy/fancy-grid/virtual`
 * and hand the result back here.
 */
export interface FancyGridVirtual {
  items: { index: number; start: number; end: number; key: Key }[];
  totalSize: number;
  measureElement?: (el: HTMLElement | null) => void;
}

export interface FancyDataGridProps<TRow = Record<string, unknown>> {
  /**
   * Stable identity for this grid. Roots every `data-fancy-grid-*` handle, so an
   * agent can address one grid on a page holding several.
   */
  gridId: string;
  columns: FancyGridColumn<TRow>[];
  rows: TRow[];
  /** Controlled state. Omit to let the grid hold its own (not agent-driveable). */
  state?: FancyGridState;
  /** Called with the FULL next state — one channel, always serializable. */
  onStateChange?: (next: FancyGridState) => void;
  /** Initial state when uncontrolled. Ignored when `state` is passed. */
  defaultState?: FancyGridState;
  /**
   * Row identity, and the key `rowSelection` is written against. Defaults to
   * `row.id`, falling back to the index — pass this when rows have no `id`, or
   * selection will not survive a re-sort.
   */
  getRowId?: (row: TRow, index: number) => string;
  /**
   * The host sorts / filters / paginates (SQL, an API), and the grid only
   * reports intent. `rowCount` is required with it — the grid is holding one
   * page and cannot know the total.
   */
  serverSide?: boolean;
  /** Total row count across all pages. Required when `serverSide`. */
  rowCount?: number;
  /** Windowing, from `@particle-academy/fancy-grid/virtual`. */
  virtual?: FancyGridVirtual;
  /** Shown when there are no rows. */
  emptyMessage?: ReactNode;
  className?: string;
}
