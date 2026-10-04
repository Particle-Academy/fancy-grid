// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { FancyDataGrid } from "../src/FancyDataGrid";
import type { FancyGridColumn } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Row = { id: number; name: string };

const COLUMNS: FancyGridColumn<Row>[] = [{ id: "name", header: "Name", sortable: true }];
const ROWS: Row[] = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Linus" },
];

/**
 * A sort click must not cause a render storm.
 *
 * ---------------------------------------------------------------------------
 * Read this before trusting it: the reported bug was NOT reproduced
 * ---------------------------------------------------------------------------
 *
 * The YouGene estate reported that clicking a sortable header hung the page
 * (React 19 Vite SPA, `@tanstack/react-table` ^8), and diagnosed it as the grid
 * handing `useReactTable` a fresh identity for any state slice the caller omits:
 *
 *     sorting: (current.sorting ?? []) as SortingState,
 *     columnFilters: (current.filters ?? []) as ColumnFiltersState,
 *     rowSelection: (current.rowSelection ?? {}) as RowSelectionState,
 *
 * **That source reading is correct** — those literals are rebuilt every render.
 * **The hang was not reproducible here**, across six shapes on
 * `@tanstack/react-table` 8.21.3 and React 19.2.8: plain uncontrolled; plus
 * `onStateChange`; with the parent re-rendering on every state change; with
 * `columns`/`rows` rebuilt inline each render; partially controlled with only
 * `pagination`; and partially controlled with the state object rebuilt inline.
 * Every one settled in 0–1 renders after the click.
 *
 * So this is a GUARD, not a regression test, and the distinction matters: **it
 * passed before any change was made, so it has never been observed to fail.** It
 * encodes the bound the reporter's symptom would have violated, and it is cheap,
 * but nobody should read it as evidence that the reported defect is fixed — no
 * fix was made, because nothing here could be shown to be broken.
 *
 * The sorting BEHAVIOUR is already covered by "sorts itself when uncontrolled"
 * in `grid.test.tsx`; this adds only the render bound, which nothing else asserts.
 *
 * If the reporter's repro arrives and reproduces, replace this docblock with what
 * actually happened and make the fix land against a failing version of this test.
 */
describe("uncontrolled sort does not storm", () => {
  it("settles within a few renders of a sort click", () => {
    let renders = 0;

    function Counted() {
      renders += 1;
      return <FancyDataGrid columns={COLUMNS} rows={ROWS} />;
    }

    const { host, unmount } = mount(<Counted />);

    const header = Array.from(host.querySelectorAll("th, [role='columnheader']")).find((el) =>
      (el.textContent ?? "").includes("Name"),
    );

    expect(header, "expected a sortable Name header").toBeTruthy();

    const before = renders;

    // React aborts a runaway update loop with "Maximum update depth exceeded"
    // rather than hanging forever, so the storm this guards against surfaces as a
    // throw here rather than a timeout.
    act(() => {
      (header as HTMLElement).click();
    });

    expect(renders - before).toBeLessThan(25);

    unmount();
  });
});
