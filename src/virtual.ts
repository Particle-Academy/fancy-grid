import { useVirtualizer } from "@tanstack/react-virtual";
import type { FancyGridVirtual } from "./types";

export interface UseGridVirtualizerOptions {
  /** Number of rows in the model — `rows.length`, not the page size. */
  count: number;
  /** The scroll container. */
  getScrollElement: () => HTMLElement | null;
  /** Estimated row height in px. Rows are measured after mount. */
  estimateSize?: number;
  /** Rows rendered beyond the viewport, each side. */
  overscan?: number;
}

/**
 * Windowing for {@link FancyDataGrid}, on a separate entry point.
 *
 * `@tanstack/react-virtual` is an OPTIONAL peer, and an optional peer imported
 * from the root entry is not optional — the import runs whether or not the
 * consumer virtualizes anything. Keeping it here means a grid of 40 rows never
 * pays for, or has to install, a virtualizer.
 *
 * ```tsx
 * const scrollRef = useRef<HTMLDivElement>(null);
 * const virtual = useGridVirtualizer({
 *   count: rows.length,
 *   getScrollElement: () => scrollRef.current,
 * });
 *
 * <div ref={scrollRef} style={{ height: 600, overflow: "auto" }}>
 *   <FancyDataGrid gridId="orders" columns={columns} rows={rows} virtual={virtual} />
 * </div>
 * ```
 *
 * Nothing else in the suite windows anything today, so this is deliberately
 * shaped as a general row-windowing seam rather than a grid-only one — the file
 * browser, kanban and sheet surfaces can adopt the same hook.
 */
export function useGridVirtualizer({
  count,
  getScrollElement,
  estimateSize = 36,
  overscan = 8,
}: UseGridVirtualizerOptions): FancyGridVirtual {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
  });

  return {
    items: virtualizer.getVirtualItems().map((item) => ({
      index: item.index,
      start: item.start,
      end: item.end,
      key: item.key,
    })),
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
  };
}
