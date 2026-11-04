// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createRef, useState, type ComponentProps, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { FancyDataGrid } from "../src/FancyDataGrid";
import { createGridBridgeAdapter } from "../src/bridge";
import { fancyGridControls } from "../src/controls";
import type { FancyDataGridHandle, FancyGridCellEdit, FancyGridColumn, FancyGridState } from "../src/types";

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

type Row = { id: string; name: string; qty: number | null; status: string; note: string };

const COLUMNS: FancyGridColumn<Row>[] = [
  { id: "name", header: "Name", editable: { type: "text", required: true } },
  { id: "qty", header: "Qty", editable: { type: "number", min: 0 } },
  { id: "status", header: "Status", editable: { type: "select", options: ["open", "done"] } },
  { id: "note", header: "Note" },
];

const makeRows = (): Row[] => [
  { id: "a", name: "Ada", qty: 1, status: "open", note: "n1" },
  { id: "b", name: "Grace", qty: 2, status: "done", note: "n2" },
  { id: "c", name: "Linus", qty: 3, status: "open", note: "n3" },
];

type HostProps = {
  gridRef?: React.Ref<FancyDataGridHandle>;
  initial?: FancyGridState;
  onEdit?: (edit: FancyGridCellEdit) => void | { error: string } | Promise<void | { error: string }>;
  extra?: Partial<ComponentProps<typeof FancyDataGrid<Row>>>;
  rows?: Row[];
};
let latest: { state: FancyGridState; rows: Row[] };
let setLatestRows: (updater: (rows: Row[]) => Row[]) => void;
function Host({ gridRef, initial, onEdit, extra }: HostProps) {
  const [state, setState] = useState<FancyGridState>(initial ?? {});
  const [rows, setRows] = useState<Row[]>(makeRows);
  latest = { state, rows };
  setLatestRows = setRows;
  return (
    <FancyDataGrid<Row>
      ref={gridRef}
      gridId="g"
      columns={COLUMNS}
      rows={rows}
      state={state}
      onStateChange={setState}
      controls={fancyGridControls}
      clipboard
      onCellEdit={async (edit) => {
        const refused = await onEdit?.(edit);
        if (refused) return refused;
        setRows((prev) => prev.map((r) => (r.id === edit.rowId ? { ...r, [edit.columnId]: edit.value } : r)));
      }}
      {...extra}
    />
  );
}

const cell = (rowId: string, col: string) =>
  document.querySelector(`[data-fancy-grid-row="${rowId}"] [data-fancy-grid-cell="${col}"]`) as HTMLElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const focus = (el: HTMLElement) => act(() => el.focus());

function clipboardEvent(type: "paste" | "copy", text = "") {
  const store = new Map<string, string>([["text/plain", text]]);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (k: string) => store.get(k) ?? "", setData: (k: string, v: string) => store.set(k, v), types: [...store.keys()] },
  });
  return { event, store };
}
function paste(target: HTMLElement, text: string, html?: string) {
  const { event, store } = clipboardEvent("paste", text);
  if (html) store.set("text/html", html);
  act(() => { target.dispatchEvent(event); });
  return event;
}
function copy(target: HTMLElement) {
  const { event, store } = clipboardEvent("copy");
  store.delete("text/plain");
  act(() => { target.dispatchEvent(event); });
  return { event, text: store.get("text/plain"), html: store.get("text/html") };
}
const confirmButton = () => document.querySelector("[data-fancy-grid-paste-confirm]") as HTMLButtonElement;
const rejectButton = () => document.querySelector("[data-fancy-grid-paste-reject]") as HTMLButtonElement;
const click = (el: HTMLElement) => act(() => el.click());

describe("copy", () => {
  it("copies the active cell when no row is selected", () => {
    mount(<Host />);
    focus(cell("a", "qty"));
    const { event, text } = copy(cell("a", "qty"));

    expect(text).toBe("1\r\n");
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies selected rows in display order, visible columns only", () => {
    mount(<Host initial={{ rowSelection: { c: true, a: true }, columnVisibility: { note: false } }} />);
    focus(cell("a", "name"));

    expect(copy(cell("a", "name")).text).toBe("Ada\t1\topen\r\nLinus\t3\topen\r\n");
  });

  it("copies in the order on screen, not the order in the data", () => {
    const sorted: FancyGridColumn<Row>[] = [
      { id: "name", header: "Name", sortable: true, editable: true },
      { id: "qty", header: "Qty", sortable: true },
    ];
    mount(
      <Host
        initial={{ rowSelection: { a: true, b: true }, sorting: [{ id: "qty", desc: true }], columnPinning: { left: ["qty"] } }}
        extra={{ columns: sorted }}
      />,
    );
    focus(cell("a", "name"));

    expect(copy(cell("a", "name")).text).toBe("2\tGrace\r\n1\tAda\r\n");
  });

  it("neutralizes formula injection on the way out, and keeps a real negative", () => {
    const hostile = [{ id: "a", name: "=HYPERLINK(1)", qty: -5, status: "@SUM(A1)", note: "+1" }];
    const ref = createRef<FancyDataGridHandle>();
    mount(
      <FancyDataGrid<Row> ref={ref} gridId="g" columns={COLUMNS} rows={hostile} controls={fancyGridControls} clipboard />,
    );

    expect(ref.current!.copy({ rowIds: ["a"] })).toBe("'=HYPERLINK(1)\t-5\t'@SUM(A1)\t'+1\r\n");
  });

  it("neutralizes a formula in a number column, where the check is easiest to skip", () => {
    const hostile = [{ id: "a", name: "x", qty: "-1+1" as unknown as number, status: "open", note: "" }];
    const ref = createRef<FancyDataGridHandle>();
    mount(<FancyDataGrid<Row> ref={ref} gridId="g" columns={COLUMNS} rows={hostile} clipboard />);

    expect(ref.current!.copy({ rowIds: ["a"], columnIds: ["qty"] })).toBe("'-1+1\r\n");
  });

  it("puts only plain text on the clipboard", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    expect(copy(cell("a", "name")).html).toBeUndefined();
  });

  it("neutralizes a native text selection dragged across the table", () => {
    const hostile = [{ id: "a", name: "=EVIL()", qty: -5, status: "open", note: "" }];
    mount(<FancyDataGrid<Row> gridId="g" columns={COLUMNS} rows={hostile} controls={fancyGridControls} clipboard />);
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "=EVIL()\t-5\topen",
      anchorNode: cell("a", "name"),
    } as unknown as Selection);

    expect(copy(cell("a", "name")).text).toBe("'=EVIL()\t-5\topen");
  });

  it("leaves copying from an open editor to the browser", () => {
    mount(<Host initial={{ editing: { rowId: "a", columnId: "name", draft: "Ada" } }} />);
    const input = document.querySelector("[data-fancy-grid-editor] input") as HTMLElement;
    const { event } = copy(input);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing at all without the clipboard prop", () => {
    mount(<Host extra={{ clipboard: false }} />);
    focus(cell("a", "name"));
    expect(copy(cell("a", "name")).event.defaultPrevented).toBe(false);
    expect(paste(cell("a", "name"), "x").defaultPrevented).toBe(false);
    expect(latest.state.pendingPaste ?? null).toBeNull();
  });

  it("includes neutralized headers on request", () => {
    const ref = createRef<FancyDataGridHandle>();
    const risky: FancyGridColumn<Row>[] = [{ id: "name", header: "=Name" }];
    mount(<FancyDataGrid<Row> ref={ref} gridId="g" columns={risky} rows={makeRows()} clipboard />);

    expect(ref.current!.copy({ rowIds: ["a"], includeHeaders: true })).toBe("'=Name\r\nAda\r\n");
  });
});

describe("paste stages; nothing changes until it is confirmed", () => {
  it("stages from the active cell and writes nothing", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    const event = paste(cell("a", "name"), "Adele\t10\r\nGrace B\t20\r\n");
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.rows).toEqual(makeRows());

    const staged = latest.state.pendingPaste!;
    expect(staged.source).toBe("human");
    expect(staged.anchor).toEqual({ rowId: "a", columnId: "name" });
    expect(staged.rowIds).toEqual(["a", "b"]);
    expect(staged.columnIds).toEqual(["name", "qty"]);
    expect(staged.cells.find((c) => c.rowId === "a" && c.columnId === "qty")).toMatchObject({
      raw: "10",
      value: 10,
      previous: 1,
      error: null,
      changed: true,
    });
    expect(JSON.parse(JSON.stringify(staged))).toEqual(staged);
  });

  it("shows every staged row in the grid, with the old value kept on the cell", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele\t10\r\nGrace B\t20\r\n");

    const a = cell("a", "qty");
    expect(a.getAttribute("data-fancy-grid-staged")).toBe("change");
    expect(a.querySelector("[data-fancy-grid-staged-value]")?.textContent).toBe("10");
    expect(a.getAttribute("title")).toBe("Was: 1");
    // A line break a reviewer cannot see is one they cannot judge.
    expect(a.querySelector("[data-fancy-grid-staged-value]")?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(cell("b", "name").querySelector("[data-fancy-grid-staged-value]")?.textContent).toBe("Grace B");
    expect(cell("c", "name").hasAttribute("data-fancy-grid-staged")).toBe(false);
  });

  it("marks a cell the paste leaves as it was, and counts it apart", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Ada\t10");

    expect(cell("a", "name").getAttribute("data-fancy-grid-staged")).toBe("same");
    expect(latest.state.pendingPaste).toMatchObject({ valid: 1, unchanged: 1, invalid: 0 });
  });

  it("confirm writes every changed cell through onCellEdit, then clears", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele\t10\r\nGrace\t20\r\n");
    click(confirmButton());
    await settle();

    // Grace is unchanged, so three writes rather than four.
    expect(onEdit.mock.calls.map(([e]) => [e.rowId, e.columnId, e.value, e.previous, e.source])).toEqual([
      ["a", "name", "Adele", "Ada", "human"],
      ["a", "qty", 10, 1, "human"],
      ["b", "qty", 20, 2, "human"],
    ]);
    expect(latest.rows[0]).toMatchObject({ name: "Adele", qty: 10 });
    expect(latest.rows[1]).toMatchObject({ name: "Grace", qty: 20 });
    expect(latest.state.pendingPaste).toBeNull();
    expect(document.querySelector("[data-fancy-grid-paste-review]")).toBeNull();
  });

  it("reject writes nothing and restores the view", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele");
    click(rejectButton());
    await settle();

    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.state.pendingPaste).toBeNull();
    expect(cell("a", "name").textContent).toBe("Ada");
    expect(cell("a", "name").hasAttribute("data-fancy-grid-staged")).toBe(false);
  });

  it("Escape on a cell rejects it too", async () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele");
    act(() => { cell("a", "name").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await settle();

    expect(latest.state.pendingPaste).toBeNull();
  });

  it("uses onCellEdits for the whole batch when the host offers it", async () => {
    const onCellEdits = vi.fn();
    const onCellEdit = vi.fn();
    mount(<Host extra={{ onCellEdits, onCellEdit }} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele\t10");
    click(confirmButton());
    await settle();

    expect(onCellEdit).not.toHaveBeenCalled();
    expect(onCellEdits).toHaveBeenCalledTimes(1);
    expect(onCellEdits.mock.calls[0][0].map((e: FancyGridCellEdit) => e.columnId)).toEqual(["name", "qty"]);
    expect(latest.state.pendingPaste).toBeNull();
  });

  it("leaves pasting into an open editor to the browser", () => {
    mount(<Host initial={{ editing: { rowId: "a", columnId: "name", draft: "Ada" } }} />);
    const input = document.querySelector("[data-fancy-grid-editor] input") as HTMLElement;

    expect(paste(input, "typed").defaultPrevented).toBe(false);
    expect(latest.state.pendingPaste ?? null).toBeNull();
  });
});

describe("the stage is type-checked against each column", () => {
  it("marks bad cells with the same message a human or agent would get", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "\tabc\tnope\tx\r\n");

    const staged = latest.state.pendingPaste!;
    const error = (columnId: string) => staged.cells.find((c) => c.columnId === columnId)?.error;
    expect(error("name")).toBe("Required.");
    expect(error("qty")).toBe("Enter a number.");
    expect(error("status")).toBe("Must be one of: open, done.");
    expect(error("note")).toContain("not editable");
    expect(staged.invalid).toBe(4);
    expect(cell("a", "qty").getAttribute("data-fancy-grid-staged")).toBe("invalid");
    expect(cell("a", "qty").querySelector("[data-fancy-grid-staged-error]")?.textContent).toBe("Enter a number.");
    // The bad text is visible, not silently blanked.
    expect(cell("a", "qty").querySelector("[data-fancy-grid-staged-value]")?.textContent).toBe("abc");
  });

  it("makes a blank pasted into a number column null", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "qty"));
    paste(cell("a", "qty"), "\r\n5\r\n");
    click(confirmButton());
    await settle();

    expect(onEdit.mock.calls[0][0]).toMatchObject({ rowId: "a", value: null });
    expect(onEdit.mock.calls[1][0]).toMatchObject({ rowId: "b", value: 5 });
  });

  it("takes Excel's formatted numbers, and refuses what it cannot read for certain", () => {
    mount(<Host />);
    focus(cell("a", "qty"));
    paste(cell("a", "qty"), "1,234.50\r\n1,5\r\n$5\r\n");

    const cells = latest.state.pendingPaste!.cells;
    expect(cells[0]).toMatchObject({ value: 1234.5, error: null });
    expect(cells[1].error).toBe("Enter a number.");
    expect(cells[2].error).toBe("Enter a number.");
  });

  it("flags a control character or bidi override instead of staging it", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "a\u0007b\r\n‮gnp.exe\r\n");

    const cells = latest.state.pendingPaste!.cells;
    expect(cells[0].error).toBe("Contains a hidden character (U+0007).");
    expect(cells[1].error).toBe("Contains a hidden character (U+202E).");
  });

  it("will not confirm a stage with errors until told to skip them, and says so on the button", async () => {
    const onEdit = vi.fn();
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host onEdit={onEdit} gridRef={ref} />);
    focus(cell("a", "qty"));
    paste(cell("a", "qty"), "9\r\nabc\r\n");
    const id = latest.state.pendingPaste!.id;

    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id }); });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(onEdit).not.toHaveBeenCalled();

    expect(confirmButton().textContent).toBe("Apply 1 valid, skip 1");
    click(confirmButton());
    await settle();

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toMatchObject({ rowId: "a", value: 9 });
    expect(latest.rows[1].qty).toBe(2);
    expect(latest.state.pendingPaste).toBeNull();
  });

  it("offers nothing to confirm when no cell would change", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Ada");

    expect(confirmButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("pasted text is hostile", () => {
  it("renders markup as text, and never reads the HTML flavour", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), '<img src=x onerror="alert(1)">', '<table><tr><td>from html</td></tr></table>');

    const shown = cell("a", "name").querySelector("[data-fancy-grid-staged-value]") as HTMLElement;
    expect(shown.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(document.querySelector("img")).toBeNull();
    expect(latest.state.pendingPaste!.cells[0].raw).not.toContain("from html");
  });

  it("does not run a pasted value through a custom cell renderer before it is confirmed", () => {
    const render = vi.fn((v: unknown) => <b>{String(v)}</b>);
    const custom: FancyGridColumn<Row>[] = [{ id: "name", header: "Name", editable: true, cell: render }];
    mount(<Host extra={{ columns: custom }} />);
    focus(cell("a", "name"));
    render.mockClear();
    paste(cell("a", "name"), "Adele");

    expect(render.mock.calls.flat()).not.toContain("Adele");
  });

  it("refuses too many rows, clearly, and stages nothing", () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} extra={{ clipboard: { limits: { maxRows: 2 } } }} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "a\nb\nc\n");

    expect(latest.state.pendingPaste ?? null).toBeNull();
    expect(latest.state.pasteRefusal).toEqual({
      code: "too-many-rows",
      error: "This paste has more than 2 rows. The limit is 2.",
    });
    expect(document.querySelector("[data-fancy-grid-paste-refused]")?.textContent).toContain("more than 2 rows");
  });

  it("refuses a paste taller than the rows below the anchor rather than dropping some", () => {
    mount(<Host />);
    focus(cell("b", "name"));
    paste(cell("b", "name"), "x\ny\nz\n");

    expect(latest.state.pendingPaste ?? null).toBeNull();
    expect(latest.state.pasteRefusal).toMatchObject({ code: "taller-than-grid" });
    expect(latest.state.pasteRefusal?.error).toBe("This paste has 3 rows, and only 2 are available from here.");
  });

  it("refuses one wider than the columns right of the anchor rather than dropping some", () => {
    mount(<Host />);
    focus(cell("a", "status"));
    paste(cell("a", "status"), "x\ty\tz");

    expect(latest.state.pendingPaste ?? null).toBeNull();
    expect(latest.state.pasteRefusal).toMatchObject({ code: "wider-than-grid" });
  });

  it("clears a refusal on the next good paste", () => {
    mount(<Host />);
    focus(cell("b", "name"));
    paste(cell("b", "name"), "x\ny\nz\n");
    paste(cell("b", "name"), "x");

    expect(latest.state.pasteRefusal).toBeNull();
    expect(latest.state.pendingPaste).not.toBeNull();
  });

  it("will not let a second paste replace the one under review", () => {
    // Otherwise whoever is watching confirms something other than what they read.
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "what the human read");
    const first = latest.state.pendingPaste!.id;

    const result = ref.current!.stagePaste("swapped by someone else", { source: "agent" });

    expect(result).toMatchObject({ ok: false, code: "pending-exists" });
    expect(latest.state.pendingPaste!.id).toBe(first);
    expect(latest.state.pendingPaste!.cells[0].raw).toBe("what the human read");
  });

  it("refuses a confirm naming a different stage", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "x");

    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id: "not-this-one" }); });

    expect(result).toMatchObject({ ok: false, code: "stale" });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("refuses a confirm when a staged cell changed underneath it, rather than overwriting", async () => {
    // What was approved is what gets applied, or nothing is.
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele");
    const { id } = latest.state.pendingPaste!;

    act(() => setLatestRows((rows) => rows.map((r) => (r.id === "a" ? { ...r, name: "Someone else" } : r))));

    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id }); });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.state.pendingPaste!.cells[0].error).toBe("Changed since this paste was staged.");
  });

  it("refuses when a staged row has gone", async () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele");
    const { id } = latest.state.pendingPaste!;

    act(() => setLatestRows((rows) => rows.filter((r) => r.id !== "a")));

    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id }); });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("a confirm that fails partway", () => {
  it("keeps only what is still unwritten, and says how far it got", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn((edit: FancyGridCellEdit) => (edit.columnId === "qty" && edit.rowId === "b" ? { error: "Locked." } : undefined));
    mount(<Host gridRef={ref} onEdit={onEdit} />);
    focus(cell("a", "qty"));
    paste(cell("a", "qty"), "10\r\n20\r\n30\r\n");
    const { id } = latest.state.pendingPaste!;

    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id }); });
    await settle();

    expect(result).toMatchObject({ ok: false, code: "rejected", applied: 1, error: "Locked." });
    const staged = latest.state.pendingPaste!;
    expect(staged.cells.map((c) => c.rowId)).toEqual(["b", "c"]);
    expect(staged.error).toBe("1 written, then: Locked.");
    expect(document.querySelector("[data-fancy-grid-paste-review]")?.textContent).toContain("1 written, then: Locked.");
    expect(latest.rows[0].qty).toBe(10);
    expect(latest.rows[1].qty).toBe(2);
  });

  it("guards a second confirm while one is running", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onEdit = vi.fn(() => gate);
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host onEdit={onEdit} gridRef={ref} />);
    focus(cell("a", "name"));
    paste(cell("a", "name"), "Adele");
    click(confirmButton());
    await settle();

    expect(latest.state.pendingPaste?.pending).toBe(true);
    expect(confirmButton().hasAttribute("disabled")).toBe(true);

    // The button is one way in. The handle, which an agent uses, is the other.
    let second: unknown;
    await act(async () => { second = await ref.current!.confirmPaste({}); });
    expect(second).toMatchObject({ ok: false, code: "busy" });

    release();
    await settle();

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(latest.state.pendingPaste).toBeNull();
  });
});

describe("agents take the same path", () => {
  it("stages, reads back and confirms through the handle, attributed to the agent", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);

    let staged: ReturnType<FancyDataGridHandle["stagePaste"]>;
    act(() => { staged = ref.current!.stagePaste("Adele\t10", { anchor: { rowId: "a", columnId: "name" }, source: "agent" }); });
    expect(staged!).toMatchObject({ ok: true, valid: 2, invalid: 0 });
    expect(latest.state.pendingPaste?.source).toBe("agent");
    expect(onEdit).not.toHaveBeenCalled();
    expect(document.querySelector("[data-fancy-grid-paste-review]")?.textContent).toContain("agent");

    const id = (staged! as { id: string }).id;
    let result: unknown;
    await act(async () => { result = await ref.current!.confirmPaste({ id, source: "agent" }); });

    expect(result).toEqual({ ok: true, applied: 2, skipped: 0 });
    expect(onEdit.mock.calls.every(([e]) => e.source === "agent")).toBe(true);
  });

  it("anchors at the first visible cell when told nothing", () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);
    act(() => { ref.current!.stagePaste("x"); });
    expect(latest.state.pendingPaste?.anchor).toEqual({ rowId: "a", columnId: "name" });
  });

  it("refuses an anchor that does not exist or is hidden, by name", () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} initial={{ columnVisibility: { qty: false } }} />);

    expect(ref.current!.stagePaste("x", { anchor: { rowId: "zz", columnId: "name" } })).toMatchObject({ ok: false, code: "no-target" });
    expect(ref.current!.stagePaste("x", { anchor: { rowId: "a", columnId: "qty" } })).toMatchObject({ ok: false, code: "no-target" });
  });

  it("the adapter stages and confirms through the handle", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);
    const adapter = createGridBridgeAdapter(ref, { id: "g", getState: () => latest.state, setState: () => {} });

    let staged: { ok: boolean; id?: string };
    act(() => { staged = adapter.stagePaste!("Adele") as { ok: boolean; id?: string }; });
    expect(staged!.ok).toBe(true);
    expect(latest.state.pendingPaste?.source).toBe("agent");

    await act(async () => { await adapter.confirmPaste!({ id: staged!.id! }); });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(adapter.copy!({ rowIds: ["a"], columnIds: ["qty"] })).toBe("1\r\n");
  });

  it("adds no write paths to a read-only adapter, but can still copy", () => {
    const ref = createRef<FancyDataGridHandle>();
    const adapter = createGridBridgeAdapter(ref, { id: "g", getState: () => ({}), setState: () => {}, readOnly: true });

    expect(adapter.stagePaste).toBeUndefined();
    expect(adapter.confirmPaste).toBeUndefined();
    expect(adapter.rejectPaste).toBeUndefined();
    expect(adapter.copy).toBeDefined();
  });
});

describe("a copy pastes back unchanged", () => {
  it("round-trips a formula-looking value and a negative through the grid", async () => {
    const start = [{ id: "a", name: "=SUM(A1)", qty: 5, status: "open", note: "" }, { id: "b", name: "x", qty: 2, status: "done", note: "" }];
    const ref = createRef<FancyDataGridHandle>();
    const onCellEdit = vi.fn();
    function Round() {
      const [state, setState] = useState<FancyGridState>({});
      latest = { state, rows: start };
      return <FancyDataGrid<Row> ref={ref} gridId="g" columns={COLUMNS} rows={start} state={state} onStateChange={setState} clipboard onCellEdit={onCellEdit} controls={fancyGridControls} />;
    }
    mount(<Round />);

    const text = ref.current!.copy({ rowIds: ["a"], columnIds: ["name", "qty"] });
    expect(text).toBe("'=SUM(A1)\t5\r\n");

    act(() => { ref.current!.stagePaste(text, { anchor: { rowId: "b", columnId: "name" } }); });
    expect(latest.state.pendingPaste!.cells[0]).toMatchObject({ raw: "=SUM(A1)", value: "=SUM(A1)", error: null });
  });
});
