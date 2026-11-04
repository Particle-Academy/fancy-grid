// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createRef, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { FancyDataGrid } from "../src/FancyDataGrid";
import { createGridBridgeAdapter } from "../src/bridge";
import type { FancyDataGridHandle, FancyGridColumn, FancyGridState } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, rerender: (next: ReactElement) => act(() => root.render(next)) };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const ROWS = [
  { id: "a", sku: "A-1", q1: 1, q2: 2, q3: 3, note: "x" },
  { id: "b", sku: "B-2", q1: 4, q2: 5, q3: 6, note: "y" },
];

const FLAT: FancyGridColumn[] = [
  { id: "sku", header: "SKU", width: 100 },
  { id: "q1", header: "Q1", width: 80 },
  { id: "q2", header: "Q2", width: 60 },
  { id: "note", header: "Note", width: 200 },
];

const GROUPED: FancyGridColumn[] = [
  { id: "sku", header: "SKU", width: 100 },
  {
    id: "sales",
    header: "Sales",
    columns: [
      { id: "q1", header: "Q1", width: 80 },
      { id: "q2", header: "Q2", width: 60 },
      { id: "q3", header: "Q3", width: 60 },
    ],
  },
  { id: "note", header: "Note", width: 200 },
];

const SORTABLE_Q1: FancyGridColumn[] = [{ id: "q1", header: "Q1", sortable: true }];

const headerIds = () =>
  Array.from(document.querySelectorAll("[data-fancy-grid-header]")).map((el) => el.getAttribute("data-fancy-grid-header"));
const cellIds = (rowId: string) =>
  Array.from(document.querySelectorAll(`[data-fancy-grid-row="${rowId}"] [data-fancy-grid-cell]`)).map((el) =>
    el.getAttribute("data-fancy-grid-cell"),
  );
const header = (id: string) => document.querySelector(`[data-fancy-grid-header="${id}"]`) as HTMLElement;
const cell = (rowId: string, col: string) =>
  document.querySelector(`[data-fancy-grid-row="${rowId}"] [data-fancy-grid-cell="${col}"]`) as HTMLElement;

describe("column visibility", () => {
  it("hides a column's header and every cell when its entry is false", () => {
    mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnVisibility: { q1: false } }} />);

    expect(headerIds()).toEqual(["sku", "q2", "note"]);
    expect(cellIds("a")).toEqual(["sku", "q2", "note"]);
    expect(cellIds("b")).toEqual(["sku", "q2", "note"]);
  });

  it("shows a column with no entry, so an old saved state still shows everything", () => {
    mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{}} />);
    expect(headerIds()).toEqual(["sku", "q1", "q2", "note"]);
  });

  it("does not move when controlled and the host leaves the slice alone", () => {
    const { rerender } = mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnVisibility: { q1: false } }} />);
    rerender(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnVisibility: {} }} />);
    expect(headerIds()).toEqual(["sku", "q1", "q2", "note"]);
  });

  it("sizes the empty row and the virtual spacers to what is visible, gutter included", () => {
    // These were `columns.length`: wrong the moment a column is hidden, grouped
    // (a group is one entry but several columns) or a gutter is on.
    const { rerender } = mount(
      <FancyDataGrid gridId="g" columns={GROUPED} rows={[]} rowNumbers state={{ columnVisibility: { q2: false } }} />,
    );
    // sku + q1 + q3 + note + gutter
    expect((document.querySelector("[data-fancy-grid-empty] td") as HTMLTableCellElement).colSpan).toBe(5);

    rerender(
      <FancyDataGrid
        gridId="g"
        columns={GROUPED}
        rows={ROWS}
        state={{ columnVisibility: { q2: false } }}
        virtual={{ items: [{ index: 0, start: 36, end: 72, key: 0 }], totalSize: 144 }}
      />,
    );
    const spacers = Array.from(document.querySelectorAll('tr[aria-hidden="true"] td')) as HTMLTableCellElement[];
    expect(spacers.map((s) => s.colSpan)).toEqual([4, 4]);
  });
});

describe("column pinning", () => {
  it("is off by default: nothing is sticky for an existing consumer", () => {
    mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} />);

    expect(document.querySelector("[data-fancy-grid-pinned]")).toBeNull();
    expect(cell("a", "sku").style.position).toBe("");
    expect(header("sku").style.position).toBe("");
  });

  it("moves pinned columns to the edges in state order, header and cells alike", () => {
    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { left: ["q2"], right: ["sku"] } }} />,
    );

    expect(headerIds()).toEqual(["q2", "q1", "note", "sku"]);
    expect(cellIds("a")).toEqual(["q2", "q1", "note", "sku"]);
    expect(cell("a", "q2").getAttribute("data-fancy-grid-pinned")).toBe("left");
    expect(cell("a", "sku").getAttribute("data-fancy-grid-pinned")).toBe("right");
    expect(cell("a", "q1").getAttribute("data-fancy-grid-pinned")).toBeNull();
  });

  it("stacks left offsets from the widths before each column", () => {
    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { left: ["sku", "q1"] } }} />,
    );

    for (const el of [cell("a", "sku"), header("sku")]) {
      expect(el.style.position).toBe("sticky");
      expect(el.style.left).toBe("0px");
    }
    for (const el of [cell("b", "q1"), header("q1")]) {
      expect(el.style.position).toBe("sticky");
      expect(el.style.left).toBe("100px");
    }
    expect(cell("a", "q2").style.position).toBe("");
  });

  it("stacks right offsets from the far edge inward", () => {
    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { right: ["q2", "note"] } }} />,
    );

    expect(cell("a", "note").style.right).toBe("0px");
    expect(cell("a", "q2").style.right).toBe("200px");
    expect(header("q2").style.right).toBe("200px");
  });

  it("marks the innermost pinned column on each side, which is where the seam is drawn", () => {
    mount(
      <FancyDataGrid
        gridId="g"
        columns={FLAT}
        rows={ROWS}
        state={{ columnPinning: { left: ["sku", "q1"], right: ["q2", "note"] } }}
      />,
    );

    expect(cell("a", "sku").hasAttribute("data-fancy-grid-pinned-edge")).toBe(false);
    expect(cell("a", "q1").hasAttribute("data-fancy-grid-pinned-edge")).toBe(true);
    expect(cell("a", "q2").hasAttribute("data-fancy-grid-pinned-edge")).toBe(true);
    expect(cell("a", "note").hasAttribute("data-fancy-grid-pinned-edge")).toBe(false);
  });

  it("offsets past the row-number gutter, and pins the gutter with them", () => {
    // Otherwise the gutter scrolls away beneath a column that has already left it
    // behind, and row numbers stop lining up with anything.
    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} rowNumbers state={{ columnPinning: { left: ["sku"] } }} />,
    );

    const gutter = document.querySelector("[data-fancy-grid-gutter]") as HTMLElement;
    const corner = document.querySelector("[data-fancy-grid-gutter-corner]") as HTMLElement;
    expect(gutter.style.position).toBe("sticky");
    expect(gutter.style.left).toBe("0px");
    expect(corner.style.position).toBe("sticky");
    expect(cell("a", "sku").style.left).toBe("40px");
  });

  it("uses the width the browser actually laid out, not the declared one", () => {
    // A table stretches and shrinks columns to fit, and a column with no `width`
    // has nothing declared at all. An offset computed from the declaration would
    // overlap or gap as soon as the two differ, and it would look like a styling
    // slip rather than the wrong number it is.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.getAttribute("data-fancy-grid-header") === "sku" ? 137.5 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { left: ["sku", "q1"] } }} />,
    );

    expect(cell("a", "q1").style.left).toBe("137.5px");
  });

  it("re-measures when the browser resizes a pinned column with no render involved", () => {
    const observers: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    let width = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute("data-fancy-grid-header") === "sku" ? width : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { left: ["sku", "q1"] } }} />);
    expect(cell("a", "q1").style.left).toBe("100px");

    width = 150;
    act(() => observers.forEach((notify) => notify()));
    expect(cell("a", "q1").style.left).toBe("150px");

    vi.unstubAllGlobals();
  });

  it("renders an id named on both sides once, on the left", () => {
    mount(
      <FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} state={{ columnPinning: { left: ["sku"], right: ["sku"] } }} />,
    );

    expect(headerIds().filter((id) => id === "sku")).toHaveLength(1);
    expect(cell("a", "sku").getAttribute("data-fancy-grid-pinned")).toBe("left");
  });

  it("honours a declared width when the table is wider than its container", () => {
    // `width` on a table cell is only a preference: auto layout compresses it to
    // min-content, so 17 columns all declaring 120px came out far narrower.
    mount(<FancyDataGrid gridId="g" columns={FLAT} rows={ROWS} />);
    expect(header("sku").style.minWidth).toBe("100px");
  });

  it("keeps a hidden pinned column hidden", () => {
    mount(
      <FancyDataGrid
        gridId="g"
        columns={FLAT}
        rows={ROWS}
        state={{ columnVisibility: { sku: false }, columnPinning: { left: ["sku", "q1"] } }}
      />,
    );

    expect(headerIds()).toEqual(["q1", "q2", "note"]);
    // sku takes no room, so q1 sits at the edge rather than 100px in.
    expect(cell("a", "q1").style.left).toBe("0px");
  });
});

describe("grouped headers", () => {
  const groupRow = () => document.querySelector("[data-fancy-grid-header-group]")?.closest("tr") as HTMLTableRowElement;
  const group = (id: string) => document.querySelector(`[data-fancy-grid-header-group="${id}"]`) as HTMLTableCellElement;

  it("spans a group over its visible leaves with a real colSpan", () => {
    mount(<FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} />);

    expect(document.querySelectorAll("thead tr")).toHaveLength(2);
    expect(group("sales").colSpan).toBe(3);
    expect(group("sales").getAttribute("scope")).toBe("colgroup");
    expect(group("sales").textContent).toBe("Sales");
    expect(groupRow().querySelectorAll("th")).toHaveLength(3);
  });

  it("keeps one data-fancy-grid-header per leaf, on the leaf row", () => {
    // That handle is what an agent sorts by. A group or a placeholder carrying it
    // would give one column id two meanings.
    mount(<FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} />);

    expect(headerIds()).toEqual(["sku", "q1", "q2", "q3", "note"]);
    expect(document.querySelector('[data-fancy-grid-header="sales"]')).toBeNull();
    expect(cellIds("a")).toEqual(["sku", "q1", "q2", "q3", "note"]);
    expect(cell("a", "q2").textContent).toBe("2");
  });

  it("gives an ungrouped column an empty placeholder above it", () => {
    mount(<FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} />);

    const placeholders = Array.from(document.querySelectorAll("[data-fancy-grid-header-placeholder]"));
    expect(placeholders.map((p) => p.getAttribute("data-fancy-grid-header-placeholder"))).toEqual(["sku", "note"]);
    expect(placeholders.every((p) => p.textContent === "")).toBe(true);
  });

  it("shrinks a group as its leaves are hidden and drops it with the last one", () => {
    const { rerender } = mount(
      <FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} state={{ columnVisibility: { q1: false } }} />,
    );
    expect(group("sales").colSpan).toBe(2);

    rerender(
      <FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} state={{ columnVisibility: { q1: false, q2: false, q3: false } }} />,
    );
    expect(group("sales")).toBeNull();
    expect(headerIds()).toEqual(["sku", "note"]);
  });

  it("nests, with every level spanning its own leaves", () => {
    const deep: FancyGridColumn[] = [
      {
        id: "year",
        header: "2026",
        columns: [
          { id: "h1", header: "H1", columns: [{ id: "q1", header: "Q1" }, { id: "q2", header: "Q2" }] },
          { id: "q3", header: "Q3" },
        ],
      },
    ];
    mount(<FancyDataGrid gridId="g" columns={deep} rows={ROWS} />);

    expect(document.querySelectorAll("thead tr")).toHaveLength(3);
    expect(group("year").colSpan).toBe(3);
    expect(group("h1").colSpan).toBe(2);
  });

  it("splits a group around a leaf pinned out of it, and keeps the pinned part stuck", () => {
    mount(
      <FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} state={{ columnPinning: { left: ["sku", "q2"] } }} />,
    );

    expect(headerIds()).toEqual(["sku", "q2", "q1", "q3", "note"]);
    const parts = Array.from(document.querySelectorAll('[data-fancy-grid-header-group="sales"]')) as HTMLTableCellElement[];
    expect(parts.map((p) => p.colSpan)).toEqual([1, 2]);
    expect(parts[0].getAttribute("data-fancy-grid-pinned")).toBe("left");
    expect(parts[0].style.left).toBe("100px");
    expect(parts[1].getAttribute("data-fancy-grid-pinned")).toBeNull();
    // The placeholder above a pinned ungrouped column has to stick too, or the
    // header row shows a hole as the body scrolls under it.
    expect((document.querySelector('[data-fancy-grid-header-placeholder="sku"]') as HTMLElement).style.position).toBe("sticky");
  });

  it("keeps the gutter corner to one cell across every header row", () => {
    mount(<FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} rowNumbers />);

    const corners = document.querySelectorAll("[data-fancy-grid-gutter-corner]");
    expect(corners).toHaveLength(1);
    expect((corners[0] as HTMLTableCellElement).rowSpan).toBe(2);
  });

  it("shows only the letter row in the spreadsheet presentation", () => {
    // Letters address leaves. A group row above them would be labelled by nothing.
    mount(<FancyDataGrid gridId="g" columns={GROUPED} rows={ROWS} columnLabels="letters" />);

    expect(document.querySelectorAll("thead tr")).toHaveLength(1);
    expect(header("q1").textContent).toBe("B");
    expect(cell("a", "q1").getAttribute("data-fancy-grid-address")).toBe("B1");
  });

  it("sorts from a leaf inside a group", () => {
    const sortable: FancyGridColumn[] = [
      { id: "sales", header: "Sales", columns: [{ id: "q1", header: "Q1", sortable: true }] },
    ];
    const onStateChange = vi.fn<(next: FancyGridState) => void>();
    mount(<FancyDataGrid gridId="g" columns={sortable} rows={ROWS} state={{}} onStateChange={onStateChange} />);

    act(() => header("q1").click());

    expect(onStateChange.mock.calls[0][0].sorting).toEqual([{ id: "q1", desc: false }]);
  });
});

describe("state stays JSON", () => {
  it("round-trips the column slices without loss", () => {
    const state: FancyGridState = {
      columnVisibility: { q1: false },
      columnPinning: { left: ["sku"], right: ["note"] },
    };
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("round-trips a whole grouped column definition", () => {
    const parsed = JSON.parse(JSON.stringify(GROUPED)) as FancyGridColumn[];
    mount(<FancyDataGrid gridId="g" columns={parsed} rows={ROWS} />);
    expect(headerIds()).toEqual(["sku", "q1", "q2", "q3", "note"]);
  });
});

describe("the handle", () => {
  it("describes the leaf columns an agent can address", () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(
      <FancyDataGrid
        ref={ref}
        gridId="g"
        columns={GROUPED}
        rows={ROWS}
        state={{ columnVisibility: { note: false }, columnPinning: { left: ["q2"] } }}
      />,
    );

    expect(ref.current?.getColumnIds()).toEqual(["sku", "q1", "q2", "q3", "note"]);
    expect(ref.current?.getRowIds()).toEqual(["a", "b"]);

    const info = ref.current!.getColumnInfo();
    expect(info.find((c) => c.id === "q2")).toMatchObject({ header: "Q2", group: ["sales"], visible: true, pinned: "left" });
    expect(info.find((c) => c.id === "note")).toMatchObject({ visible: false, pinned: null });
    // A group is not addressable: pinning or hiding "sales" would be ignored by
    // the engine, and a silently ignored write is the thing the bridge refuses.
    expect(info.map((c) => c.id)).not.toContain("sales");
  });

  it("backs a bridge adapter that reads through the mounted grid", () => {
    const ref = createRef<FancyDataGridHandle>();
    let state: FancyGridState = {};
    mount(<FancyDataGrid ref={ref} gridId="g" columns={GROUPED} rows={ROWS} state={state} />);

    const adapter = createGridBridgeAdapter(ref, {
      id: "g",
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });

    expect(adapter.getColumnIds()).toContain("q3");
    expect(adapter.getRowIds()).toEqual(["a", "b"]);
    expect(adapter.getColumnInfo().map((c) => c.id)).toContain("note");
  });

  it("refuses through the adapter when the grid is not mounted, rather than reading as empty", () => {
    const ref = createRef<FancyDataGridHandle>();
    const adapter = createGridBridgeAdapter(ref, { id: "g", getState: () => ({}), setState: () => {} });
    expect(() => adapter.getColumnIds()).toThrow(/not mounted/);
  });
});

describe("virtual windows keep the measuring index honest", () => {
  it("writes the model position to data-index, not the row's original index", () => {
    // After a sort the two differ, and the virtualizer files each measured height
    // under whichever row `data-index` names. Measuring the wrong row is how a
    // scrollbar starts to jump.
    mount(
      <FancyDataGrid
        gridId="g"
        columns={SORTABLE_Q1}
        rows={ROWS}
        state={{ sorting: [{ id: "q1", desc: true }] }}
        virtual={{ items: [{ index: 0, start: 0, end: 36, key: 0 }], totalSize: 72 }}
      />,
    );

    const row = document.querySelector("[data-fancy-grid-row]") as HTMLElement;
    expect(row.getAttribute("data-fancy-grid-row")).toBe("b");
    expect(row.getAttribute("data-index")).toBe("0");
  });
});
