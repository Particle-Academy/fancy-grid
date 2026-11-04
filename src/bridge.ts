import type { RefObject } from "react";
import type { FancyDataGridHandle, FancyGridColumnInfo, FancyGridState } from "./types";

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
        }),
  };
}
