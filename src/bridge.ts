import type { RefObject } from "react";
import type {
  FancyDataGridHandle,
  FancyGridCellRef,
  FancyGridColumnInfo,
  FancyGridConfirmPasteResult,
  FancyGridCopyOptions,
  FancyGridStagePasteResult,
  FancyGridState,
} from "./types";

export interface FancyGridBridgeAdapterOptions {
  id: string;
  title?: string;
  screenId?: string;
  /** The same state the grid is controlled with. */
  getState: () => FancyGridState;
  setState: (next: FancyGridState) => void;
  /**
   * No writes through this bridge. `grid_edit_cell` is then not registered at all,
   * so an agent learns it from the tool list rather than from a failed call. It is
   * an option because the adapter is built before the grid has mounted.
   */
  readOnly?: boolean;
}

/**
 * The object `registerGridBridge` from `@particle-academy/agent-integrations`
 * takes, built on a mounted grid.
 *
 * Structural, with no import of the bridge package in either direction: neither
 * package may drag the other into a consumer's tree.
 */
export interface FancyGridBridgeAdapter extends FancyGridBridgeAdapterOptions {
  getColumnIds: () => string[];
  getRowIds: () => string[];
  getColumnInfo: () => FancyGridColumnInfo[];
  /** Absent when `readOnly`. Throws what the grid refused. */
  editCell?: (rowId: string, columnId: string, value: unknown) => Promise<void>;
  /** The refusal `editCell` would give, or `null`. Writes nothing. */
  validateCell?: (rowId: string, columnId: string, value: unknown) => string | null;
  /** TSV, formula injection neutralized. Reading, so a read-only bridge has it too. */
  copy: (options?: FancyGridCopyOptions) => string;
  /** Absent when `readOnly`. */
  stagePaste?: (text: string, anchor?: FancyGridCellRef) => FancyGridStagePasteResult;
  /** Absent when `readOnly`. */
  confirmPaste?: (options: { id: string; skipInvalid?: boolean }) => Promise<FancyGridConfirmPasteResult>;
  /** Absent when `readOnly`. */
  rejectPaste?: (id: string) => boolean;
}

/**
 * Point an agent bridge at a grid through its `ref`, so an agent reaches the same
 * code a human's gesture does instead of a second path the host wrote by hand.
 *
 * Reading through an unmounted grid throws. An empty answer would read as a grid
 * with no columns, which is a wrong fact rather than a failure.
 */
export function createGridBridgeAdapter(
  ref: RefObject<FancyDataGridHandle | null>,
  options: FancyGridBridgeAdapterOptions,
): FancyGridBridgeAdapter {
  const grid = (): FancyDataGridHandle => {
    if (!ref.current) throw new Error(`Grid "${options.id}" is not mounted.`);
    return ref.current;
  };

  return {
    ...options,
    getColumnIds: () => grid().getColumnIds(),
    getRowIds: () => grid().getRowIds(),
    getColumnInfo: () => grid().getColumnInfo(),
    copy: (copyOptions) => grid().copy(copyOptions),
    ...(options.readOnly
      ? {}
      : {
          editCell: async (rowId: string, columnId: string, value: unknown) => {
            const result = await grid().editCell(rowId, columnId, value, { source: "agent" });
            if (!result.ok) throw new Error(result.error);
          },
          validateCell: (rowId: string, columnId: string, value: unknown) => {
            const result = grid().validateCell(rowId, columnId, value);
            return result.ok ? null : result.error;
          },
          stagePaste: (text: string, anchor?: FancyGridCellRef) => grid().stagePaste(text, { anchor, source: "agent" }),
          confirmPaste: (confirm: { id: string; skipInvalid?: boolean }) => grid().confirmPaste({ ...confirm, source: "agent" }),
          rejectPaste: (id: string) => grid().rejectPaste(id),
        }),
  };
}
