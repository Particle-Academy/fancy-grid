// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import { FancyDataGrid } from "../src/FancyDataGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, unmount: () => act(() => root.unmount()) };
}

type Row = { id: string; name: string; qty: number };
// `accessor` is a dot-PATH, not a function — it has to survive JSON.
const columns = [
  { id: "name", header: "Name" },
  { id: "qty", header: "Qty" },
];
const rows: Row[] = [
  { id: "1", name: "Bolt", qty: 4 },
  { id: "2", name: "Nut", qty: 9 },
];

function grid(extra: Record<string, unknown> = {}) {
  return mount(<FancyDataGrid gridId="g" columns={columns} rows={rows} {...extra} />);
}

/**
 * Spreadsheet presentation — story #170, task 234.
 *
 * The gallery's spreadsheet style needed a read-only, cell-addressed grid:
 * column-letter heads, a row-number gutter, A1 cells. `fancy-sheets` is the full
 * editable workbook and far too heavy for a read-only view.
 *
 * Resolved as an EXTENSION of `FancyDataGrid` rather than a new component, per
 * that story's rule that no new export lands where extending would do. It is the
 * same table — rows, columns, cells — presented with different labels, and
 * reusing it keeps selection, virtualisation and server-side mode rather than
 * growing a second grid that slowly reimplements them.
 *
 * The A1 handles are the part that earns its place beyond looks: `A1` is a
 * stable, universally understood address, so an agent can be told "read B2"
 * instead of being handed an internal column id.
 */
describe("spreadsheet presentation", () => {
  it("is off by default — nothing changes for existing consumers", () => {
    const { host, unmount } = grid();

    expect(host.querySelector("[data-fancy-grid-gutter]")).toBeNull();
    expect(host.querySelector("[data-fancy-grid-address]")).toBeNull();
    expect(host.textContent).toContain("Name");

    unmount();
  });

  it("labels columns A, B, … when asked", () => {
    const { host, unmount } = grid({ columnLabels: "letters" });

    const heads = [...host.querySelectorAll("[data-fancy-grid-header]")].map((n) => n.textContent);

    expect(heads).toEqual(["A", "B"]);

    unmount();
  });

  it("addresses cells A1-style", () => {
    const { host, unmount } = grid({ columnLabels: "letters" });

    // Row 1 is the first DATA row: a spreadsheet's row 1 is not its header.
    expect(host.querySelector('[data-fancy-grid-address="A1"]')?.textContent).toBe("Bolt");
    expect(host.querySelector('[data-fancy-grid-address="B2"]')?.textContent).toBe("9");

    unmount();
  });

  it("renders the row-number gutter", () => {
    const { host, unmount } = grid({ rowNumbers: true });

    const gutters = [...host.querySelectorAll("[data-fancy-grid-gutter]")].map((n) => n.textContent);

    expect(gutters).toEqual(["1", "2"]);

    unmount();
  });

  it("keeps the header row's gutter cell empty", () => {
    // The corner above the row numbers. Putting a "1" there is the classic
    // off-by-one, and it makes every row label wrong by one afterwards.
    const { host, unmount } = grid({ rowNumbers: true, columnLabels: "letters" });

    const headRow = host.querySelector("thead tr") as HTMLElement;

    expect(headRow.firstElementChild?.textContent).toBe("");

    unmount();
  });

  it("keeps the STABLE handle stable and the address separate", () => {
    // This package's rule is that handles key on identity, never on index. A1 is
    // positional — B2 names whatever currently sits there, so it moves under a
    // sort. Overloading data-fancy-grid-cell with it would have broken that
    // invariant silently, which is why they are two attributes.
    const { host, unmount } = grid({ columnLabels: "letters" });

    const cell = host.querySelector('[data-fancy-grid-address="A1"]') as HTMLElement;

    expect(cell.getAttribute("data-fancy-grid-cell")).toBe("name");

    unmount();
  });
});
