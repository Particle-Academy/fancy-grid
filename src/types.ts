import type { ComponentType, Key, ReactNode, Ref } from "react";

/** A select option: its text, or a stored value with a different label. */
export type FancyGridSelectOption = string | { value: string; label: string };

/**
 * How a column is edited, as JSON. The same declaration governs a human's editor,
 * an agent's tool call and a paste, so all three accept and refuse the same values.
 */
export type FancyGridEditor =
  | { type: "text"; required?: boolean; maxLength?: number; placeholder?: string }
  | { type: "number"; required?: boolean; min?: number; max?: number; step?: number; placeholder?: string }
  | { type: "select"; required?: boolean; options: FancyGridSelectOption[]; placeholder?: string };

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
  /**
   * Makes this a GROUP: a header spanning these columns, with no cells of its
   * own. Nest as deep as you like. A group's `id` names the header handle
   * (`data-fancy-grid-header-group`); sorting, filtering, hiding and pinning all
   * address leaves, because those are what have cells.
   */
  columns?: FancyGridColumn<TRow>[];
  /**
   * Makes the cells editable: `true` for text, or a {@link FancyGridEditor}. Writes
   * go to `onCellEdit`; the grid never changes `rows` itself.
   */
  editable?: boolean | FancyGridEditor;
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

/** Leaf column ids stuck to each edge, in display order from the left. */
export interface FancyGridColumnPinning {
  left?: string[];
  right?: string[];
}

/** One leaf column as an agent sees it. All JSON. */
export interface FancyGridColumnInfo {
  id: string;
  header: string;
  /** Ids of the groups this column sits in, outermost first. */
  group: string[];
  visible: boolean;
  pinned: "left" | "right" | null;
  sortable: boolean;
  filterable: boolean;
  /** What the column accepts, or `null` if it is read-only. */
  editor: FancyGridEditor | null;
}

/** One cell, by identity. Row id and column id, never positions. */
export interface FancyGridCellRef {
  rowId: string;
  columnId: string;
}

/**
 * The editor that is open, as state. It lives here rather than inside the grid so
 * an agent can read what a human is typing, and so the draft survives a virtual
 * window dropping the row while it scrolls past.
 */
export interface FancyGridEditing extends FancyGridCellRef {
  /** What is typed so far. Text until it validates; not yet a stored value. */
  draft: unknown;
  /** Why the last commit was refused. */
  error?: string | null;
  /** A write is in flight; the editor is held. */
  pending?: boolean;
}

/** One write, as the host receives it. All JSON. */
export interface FancyGridCellEdit extends FancyGridCellRef {
  /** The column's dot-path, for a host that writes generically. */
  accessor: string;
  /** Validated and coerced: a number column gets a number or `null`. */
  value: unknown;
  previous: unknown;
  source: "human" | "agent";
}

export type FancyGridEditFailure = "unknown-row" | "unknown-column" | "not-editable" | "invalid" | "rejected";

export type FancyGridEditResult =
  | { ok: true; value: unknown; changed: boolean }
  | { ok: false; code: FancyGridEditFailure; error: string };

export interface FancyGridPasteLimits {
  /** Default 1000. */
  maxRows: number;
  /** Default 100. */
  maxColumns: number;
  /** Default 2,000,000. Checked before a character is read. */
  maxChars: number;
}

export type FancyGridPasteRefusalCode =
  | "empty"
  | "too-large"
  | "too-many-rows"
  | "too-many-columns"
  | "no-target"
  | "taller-than-grid"
  | "wider-than-grid"
  | "pending-exists"
  | "read-only";

/** Why a paste was not staged. Shown on the grid, in state. */
export interface FancyGridPasteRefusal {
  code: FancyGridPasteRefusalCode;
  error: string;
}

/** One cell of a staged paste. */
export interface FancyGridStagedCell extends FancyGridCellRef {
  /** The pasted text. */
  raw: string;
  /** What it would be stored as. `null` when `error` is set. */
  value: unknown;
  previous: unknown;
  /** Why this cell cannot be applied. */
  error: string | null;
  /** Whether applying it would change anything. */
  changed: boolean;
}

/**
 * A paste waiting for someone to confirm or reject it. Nothing in `rows` has moved.
 * In state, so a human sees the same thing an agent reads.
 */
export interface FancyGridPendingPaste {
  /** Name this to confirm it, so nobody confirms a stage they have not read. */
  id: string;
  /** Who pasted, which is also the `source` on the edits a confirm writes. */
  source: FancyGridCellEdit["source"];
  anchor: FancyGridCellRef;
  rowIds: string[];
  columnIds: string[];
  cells: FancyGridStagedCell[];
  /** Cells that would change. */
  valid: number;
  /** Cells with an `error`. */
  invalid: number;
  /** Cells already holding that value. */
  unchanged: number;
  /** Why the last confirm stopped. */
  error?: string | null;
  /** A confirm is in flight. */
  pending?: boolean;
}

export type FancyGridStagePasteResult =
  | { ok: true; id: string; rows: number; columns: number; valid: number; invalid: number; unchanged: number }
  | { ok: false; code: FancyGridPasteRefusalCode; error: string };

export type FancyGridConfirmPasteResult =
  | { ok: true; applied: number; skipped: number }
  | { ok: false; code: "none" | "stale" | "busy" | "invalid" | "rejected"; error: string; applied?: number };

export interface FancyGridCopyOptions {
  /** Default: the selected rows, or every row in the current model. */
  rowIds?: string[];
  /** Default: the visible columns, in display order. */
  columnIds?: string[];
  includeHeaders?: boolean;
}

/** Props for a button in the paste review. */
export interface FancyGridButtonProps {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
  /** The stable handle, spread onto the rendered button. */
  handle: Record<string, string>;
}

/** Props for one editor control. See `@particle-academy/fancy-grid/controls`. */
export interface FancyGridEditorProps {
  editor: FancyGridEditor;
  draft: unknown;
  onDraftChange: (next: unknown) => void;
  invalid: boolean;
  disabled: boolean;
  /** The column's header, for an accessible name. */
  label: string;
}

/**
 * What the grid renders its interactive parts with.
 *
 * Supplied rather than imported so a read-only grid never installs `react-fancy`.
 * `fancyGridControls` from `./controls` is the kit's set.
 */
export interface FancyGridControls {
  text?: ComponentType<FancyGridEditorProps>;
  number?: ComponentType<FancyGridEditorProps>;
  select?: ComponentType<FancyGridEditorProps>;
  /** The paste review's Confirm and Reject. Without it, a person cannot paste. */
  button?: ComponentType<FancyGridButtonProps>;
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
  /**
   * Keyed by leaf column id. `false` hides; no entry means visible, so a saved
   * state from before a column existed still shows it.
   */
  columnVisibility?: Record<string, boolean>;
  /** An id named on both sides is pinned left. */
  columnPinning?: FancyGridColumnPinning;
  /** The cell keyboard navigation is on. */
  activeCell?: FancyGridCellRef | null;
  /** The open editor. See {@link FancyGridEditing}. */
  editing?: FancyGridEditing | null;
  /** A paste awaiting confirmation. See {@link FancyGridPendingPaste}. */
  pendingPaste?: FancyGridPendingPaste | null;
  /** Why the last paste was refused. */
  pasteRefusal?: FancyGridPasteRefusal | null;
}

/**
 * Imperative access to a mounted grid, through `ref`.
 *
 * Everything in `state` is reachable without this. The handle is for what is not
 * state: reading what the grid resolved its columns and rows to, and (through
 * `createGridBridgeAdapter`) giving a bridge the same path a human's gesture takes.
 */
export interface FancyDataGridHandle {
  /** Leaf column ids, in definition order, hidden ones included. */
  getColumnIds: () => string[];
  /** Ids of the rows in the current model: filtered, sorted, on this page. */
  getRowIds: () => string[];
  getColumnInfo: () => FancyGridColumnInfo[];
  /**
   * Write one cell through the path a human's commit takes: the column's rules,
   * then `validateCell`, then `onCellEdit`. Never rejects; a refusal is a result.
   */
  editCell: (
    rowId: string,
    columnId: string,
    value: unknown,
    options?: { source?: FancyGridCellEdit["source"] },
  ) => Promise<FancyGridEditResult>;
  /** The same checks, writing nothing. */
  validateCell: (rowId: string, columnId: string, value: unknown) => FancyGridEditResult;
  /** The cells as TSV, formula injection neutralized. What the copy shortcut writes. */
  copy: (options?: FancyGridCopyOptions) => string;
  /**
   * Stage spreadsheet text into `state.pendingPaste`. Writes nothing. Refuses, and
   * says why, rather than dropping anything; refuses too while another paste is
   * under review, so nobody confirms something other than what they read.
   */
  stagePaste: (
    text: string,
    options?: { anchor?: FancyGridCellRef; source?: FancyGridCellEdit["source"] },
  ) => FancyGridStagePasteResult;
  /**
   * Apply the staged paste. Refuses a cell that changed since it was staged, and any
   * stage with errors unless `skipInvalid`. Omit `id` only from a human's own button.
   */
  confirmPaste: (options?: { id?: string; skipInvalid?: boolean }) => Promise<FancyGridConfirmPasteResult>;
  /** Drop the staged paste. Writes nothing. */
  rejectPaste: (id?: string) => boolean;
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
  /** Lets keyboard navigation bring a row outside the window into view. */
  scrollToIndex?: (index: number) => void;
}

export interface FancyDataGridProps<TRow = Record<string, unknown>> {
  /** See {@link FancyDataGridHandle}. */
  ref?: Ref<FancyDataGridHandle>;
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
  /**
   * Label columns `A`, `B`, `C` … instead of their `header`, and address cells
   * A1-style.
   *
   * The spreadsheet presentation. `data-fancy-grid-cell` keeps the column id —
   * the A1 address goes on a separate `data-fancy-grid-address`, deliberately.
   *
   * A1 is POSITIONAL: `B2` names whatever currently sits in the second column of
   * the second row, so it moves under a sort or a filter. This package's rule is
   * that handles are keyed by identity and never by index, precisely because an
   * index-keyed handle silently points at a different row afterwards. Overloading
   * the stable handle with a positional one would have broken that quietly, so
   * they are two attributes: address it as a human reads it, key on it as code
   * must.
   *
   * Row 1 is the first DATA row — a spreadsheet's row 1 is not its header.
   */
  columnLabels?: "header" | "letters";
  /** Render the row-number gutter down the left edge. */
  rowNumbers?: boolean;
  /**
   * Receives every write, human or agent. Return `{ error }` or throw to refuse;
   * the message is shown on the cell. May be async, in which case the editor holds
   * until it settles. Without this prop, no write can succeed.
   */
  onCellEdit?: (edit: FancyGridCellEdit) => void | { error: string } | Promise<void | { error: string }>;
  /**
   * Receives a confirmed paste as one batch, for a host that writes atomically.
   * Same contract as `onCellEdit`. Without it, each cell goes to `onCellEdit` in turn.
   */
  onCellEdits?: (edits: FancyGridCellEdit[]) => void | { error: string } | Promise<void | { error: string }>;
  /** A host's own rule, run after the column's. Return a message to refuse. */
  validateCell?: (edit: FancyGridCellEdit) => string | null | undefined;
  /**
   * Controls for the interactive parts. Without them an editable column still takes
   * writes through the handle, but no editor can open.
   */
  controls?: FancyGridControls;
  /**
   * Copy to TSV and paste through a stage-and-confirm step. Off by default. `true`,
   * or choose: `{ copy?: boolean; paste?: boolean; limits?: Partial<FancyGridPasteLimits> }`.
   */
  clipboard?: boolean | { copy?: boolean; paste?: boolean; limits?: Partial<FancyGridPasteLimits> };
  /** Shown when there are no rows. */
  emptyMessage?: ReactNode;
  className?: string;
}
