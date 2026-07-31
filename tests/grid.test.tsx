// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { FancyDataGrid } from "../src/FancyDataGrid";
import type { FancyGridColumn, FancyGridState } from "../src/types";

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

interface Order extends Record<string, unknown> {
  id: string;
  customer: { name: string };
  total: number;
}

const ROWS: Order[] = [
  { id: "a", customer: { name: "Ada" }, total: 30 },
  { id: "b", customer: { name: "Grace" }, total: 10 },
  { id: "c", customer: { name: "Linus" }, total: 20 },
];

const COLUMNS: FancyGridColumn<Order>[] = [
  { id: "customer", header: "Customer", accessor: "customer.name", sortable: true },
  { id: "total", header: "Total", sortable: true, align: "end" },
];

const cells = (col: string) =>
  Array.from(document.querySelectorAll(`[data-fancy-grid-cell="${col}"]`)).map((el) => el.textContent);

describe("handles", () => {
  it("roots every handle on the grid id", () => {
    // These are what an MCP bridge addresses. If they move, every agent that
    // learned this grid breaks silently — it finds nothing and reports nothing.
    mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} />);

    expect(document.querySelector('[data-fancy-grid="orders"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-fancy-grid-row]")).toHaveLength(3);
    expect(document.querySelector('[data-fancy-grid-row="a"]')).not.toBeNull();
    expect(document.querySelector('[data-fancy-grid-header="customer"]')).not.toBeNull();
    expect(cells("customer")).toEqual(["Ada", "Grace", "Linus"]);
  });

  it("keys rows by id so selection survives a re-sort", () => {
    const { rerender } = mount(
      <FancyDataGrid
        gridId="orders"
        columns={COLUMNS}
        rows={ROWS}
        state={{ rowSelection: { b: true } }}
      />,
    );

    expect(document.querySelector('[data-fancy-grid-row="b"]')?.getAttribute("data-fancy-grid-selected")).toBe("true");

    rerender(
      <FancyDataGrid
        gridId="orders"
        columns={COLUMNS}
        rows={ROWS}
        state={{ rowSelection: { b: true }, sorting: [{ id: "total", desc: false }] }}
      />,
    );

    // Row order changed; the SAME row is still selected. Index-keyed selection
    // would now be highlighting whichever row moved into slot 1.
    expect(cells("customer")).toEqual(["Grace", "Linus", "Ada"]);
    expect(document.querySelector('[data-fancy-grid-row="b"]')?.getAttribute("data-fancy-grid-selected")).toBe("true");
  });

  it("reads dot-path accessors", () => {
    mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} />);
    expect(cells("customer")).toEqual(["Ada", "Grace", "Linus"]);
  });

  it("renders an empty state rather than a bare table", () => {
    mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={[]} />);
    expect(document.querySelector("[data-fancy-grid-empty]")?.textContent).toBe("No rows");
  });
});

describe("controlled state", () => {
  it("emits the FULL next state, not a slice", () => {
    // A host that receives slices has to merge them to know what the grid is
    // showing, and an agent reading the state back gets whatever the host
    // managed to reassemble. One object, always complete.
    const onStateChange = vi.fn<(next: FancyGridState) => void>();

    mount(
      <FancyDataGrid
        gridId="orders"
        columns={COLUMNS}
        rows={ROWS}
        state={{ rowSelection: { a: true }, pagination: { pageIndex: 0, pageSize: 25 } }}
        onStateChange={onStateChange}
      />,
    );

    act(() => {
      (document.querySelector('[data-fancy-grid-header="total"]') as HTMLElement).click();
    });

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const next = onStateChange.mock.calls[0][0];
    expect(next.sorting).toEqual([{ id: "total", desc: false }]);
    // The slices it did not touch are still there.
    expect(next.rowSelection).toEqual({ a: true });
    expect(next.pagination).toEqual({ pageIndex: 0, pageSize: 25 });
  });

  it("round-trips through JSON without loss", () => {
    // The whole point of the state contract: it survives a URL, a saved view,
    // or an MCP tool call.
    const state: FancyGridState = {
      sorting: [{ id: "total", desc: true }],
      filters: [{ id: "customer", value: "a" }],
      rowSelection: { a: true },
      pagination: { pageIndex: 1, pageSize: 10 },
    };

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("does not move when controlled and the host ignores the change", () => {
    // Controlled means controlled. A grid that sorts itself anyway would drift
    // out of sync with the state an agent believes it set.
    mount(
      <FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} state={{}} onStateChange={() => {}} />,
    );

    act(() => {
      (document.querySelector('[data-fancy-grid-header="total"]') as HTMLElement).click();
    });

    expect(cells("customer")).toEqual(["Ada", "Grace", "Linus"]);
  });

  it("sorts itself when uncontrolled", () => {
    mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} />);

    act(() => {
      (document.querySelector('[data-fancy-grid-header="total"]') as HTMLElement).click();
    });

    expect(cells("total")).toEqual(["10", "20", "30"]);
  });
});

describe("server-side mode", () => {
  it("reports sort intent without re-sorting the page it holds", () => {
    // The bug this prevents: the grid holds ONE page, so sorting it locally
    // presents a page-local order as the sorted whole — a wrong answer that
    // looks completely correct.
    const onStateChange = vi.fn();

    mount(
      <FancyDataGrid
        gridId="orders"
        columns={COLUMNS}
        rows={ROWS}
        serverSide
        rowCount={900}
        state={{}}
        onStateChange={onStateChange}
      />,
    );

    act(() => {
      (document.querySelector('[data-fancy-grid-header="total"]') as HTMLElement).click();
    });

    expect(onStateChange.mock.calls[0][0].sorting).toEqual([{ id: "total", desc: false }]);
    expect(cells("customer")).toEqual(["Ada", "Grace", "Linus"]);
    expect(document.querySelector("[data-fancy-grid-server-side]")).not.toBeNull();
  });

  it("warns when rowCount is missing, because pagination silently under-reports", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} serverSide />);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rowCount"));
  });
});

describe("virtualization", () => {
  it("renders only the windowed rows, with spacers holding the scroll height", () => {
    const many: Order[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      customer: { name: `Person ${i}` },
      total: i,
    }));

    mount(
      <FancyDataGrid
        gridId="big"
        columns={COLUMNS}
        rows={many}
        virtual={{
          items: [
            { index: 500, start: 18000, end: 18036, key: 500 },
            { index: 501, start: 18036, end: 18072, key: 501 },
          ],
          totalSize: 36000,
        }}
      />,
    );

    const rendered = Array.from(document.querySelectorAll("[data-fancy-grid-row]"));
    expect(rendered).toHaveLength(2);
    expect(rendered[0].getAttribute("data-fancy-grid-row")).toBe("r500");

    // Spacers keep the scrollbar honest without transforms, which keeps the
    // table row boxes valid for screen readers.
    const spacers = Array.from(document.querySelectorAll('tr[aria-hidden="true"] td'));
    expect((spacers[0] as HTMLElement).style.height).toBe("18000px");
    expect((spacers[1] as HTMLElement).style.height).toBe("17928px");
  });
});

describe("unstable reference guard", () => {
  it("warns when columns are rebuilt every render", () => {
    // TanStack Table's most-reported failure mode, and the symptom is a frozen
    // tab with no error — worth naming out loud.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = mount(<FancyDataGrid gridId="orders" columns={[...COLUMNS]} rows={ROWS} />);

    for (let i = 0; i < 6; i++) {
      rerender(<FancyDataGrid gridId="orders" columns={[...COLUMNS]} rows={[...ROWS]} />);
    }

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("changed identity on 5 renders"));
  });

  it("stays quiet for stable references", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = mount(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} />);

    for (let i = 0; i < 6; i++) {
      rerender(<FancyDataGrid gridId="orders" columns={COLUMNS} rows={ROWS} />);
    }

    expect(warn).not.toHaveBeenCalled();
  });
});
