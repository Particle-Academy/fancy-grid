import type { RefObject } from "react";
import type { FancyDataGridHandle, FancyGridColumnInfo, FancyGridState } from "./types";

export interface FancyGridBridgeAdapterOptions {
  id: string;
  title?: string;
  screenId?: string;
  /** The same state the grid is controlled with. */
  getState: () => FancyGridState;
  setState: (next: FancyGridState) => void;
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
  };
}
