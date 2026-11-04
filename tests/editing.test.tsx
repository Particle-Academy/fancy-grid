// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createRef, useState, type ComponentProps, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { FancyDataGrid } from "../src/FancyDataGrid";
import { createGridBridgeAdapter } from "../src/bridge";
import { fancyGridControls } from "../src/controls";
import { coerceCellValue } from "../src/editing";
import type {
  FancyDataGridHandle,
  FancyGridCellEdit,
  FancyGridColumn,
  FancyGridState,
} from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, rerender: (next: ReactElement) => act(() => root.render(next)), unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Row = { id: string; name: string; qty: number | null; status: string; note: string; meta: { owner: string } };

const COLUMNS: FancyGridColumn<Row>[] = [
  { id: "name", header: "Name", editable: { type: "text", required: true, maxLength: 12 } },
  { id: "qty", header: "Qty", editable: { type: "number", min: 0, max: 100 } },
  { id: "status", header: "Status", editable: { type: "select", options: ["open", { value: "done", label: "Finished" }] } },
  { id: "note", header: "Note" },
  { id: "owner", header: "Owner", accessor: "meta.owner", editable: true },
];

const makeRows = (): Row[] => [
  { id: "a", name: "Ada", qty: 1, status: "open", note: "n1", meta: { owner: "x" } },
  { id: "b", name: "Grace", qty: null, status: "done", note: "n2", meta: { owner: "y" } },
  { id: "c", name: "Linus", qty: 3, status: "open", note: "n3", meta: { owner: "z" } },
];

/**
 * A real controlled host: the state lives out here, and so do the rows. If the
 * grid held anything of its own, `latest` would disagree with what is on screen.
 */
type HostProps = {
  onEdit?: (edit: FancyGridCellEdit, rows: Row[]) => void | { error: string } | Promise<void | { error: string }>;
  gridRef?: React.Ref<FancyDataGridHandle>;
  initial?: FancyGridState;
  extra?: Partial<ComponentProps<typeof FancyDataGrid<Row>>>;
};
let latest: { state: FancyGridState; rows: Row[] };
function Host({ onEdit, gridRef, initial, extra }: HostProps) {
  const [state, setState] = useState<FancyGridState>(initial ?? {});
  const [rows, setRows] = useState<Row[]>(makeRows);
  latest = { state, rows };
  return (
    <FancyDataGrid<Row>
      ref={gridRef}
      gridId="g"
      columns={COLUMNS}
      rows={rows}
      state={state}
      onStateChange={setState}
      controls={fancyGridControls}
      onCellEdit={async (edit) => {
        const refused = await onEdit?.(edit, rows);
        if (refused) return refused;
        setRows((prev) =>
          prev.map((r) => {
            if (r.id !== edit.rowId) return r;
            if (edit.columnId === "owner") return { ...r, meta: { owner: edit.value as string } };
            return { ...r, [edit.columnId]: edit.value };
          }),
        );
      }}
      {...extra}
    />
  );
}

const cell = (rowId: string, col: string) =>
  document.querySelector(`[data-fancy-grid-row="${rowId}"] [data-fancy-grid-cell="${col}"]`) as HTMLElement;
const editor = () => document.querySelector("[data-fancy-grid-editor] input, [data-fancy-grid-editor] select") as HTMLInputElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function press(el: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}
function focus(el: HTMLElement) {
  act(() => el.focus());
}
function type(value: string) {
  const input = editor();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function choose(value: string) {
  const select = editor() as unknown as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("coerceCellValue: one definition of a valid cell", () => {
  it("makes a blank number null, never 0", () => {
    expect(coerceCellValue({ type: "number" }, "")).toEqual({ ok: true, value: null });
    expect(coerceCellValue({ type: "number" }, "   ")).toEqual({ ok: true, value: null });
    expect(coerceCellValue({ type: "number" }, null)).toEqual({ ok: true, value: null });
    expect(coerceCellValue({ type: "number" }, undefined)).toEqual({ ok: true, value: null });
  });

  it("refuses a blank in a required column", () => {
    expect(coerceCellValue({ type: "number", required: true }, "")).toMatchObject({ ok: false });
    expect(coerceCellValue({ type: "text", required: true }, "  ")).toMatchObject({ ok: false });
    expect(coerceCellValue({ type: "select", required: true, options: ["a"] }, "")).toMatchObject({ ok: false });
  });

  it("reads decimal text the way NumberField does, and nothing else", () => {
    for (const [text, n] of [["12", 12], ["-3.5", -3.5], [" 7 ", 7], ["+4", 4], ["1e3", 1000], ["-0", 0]] as const) {
      expect(coerceCellValue({ type: "number" }, text), text).toEqual({ ok: true, value: n });
    }
    for (const text of ["abc", "0x10", "Infinity", "NaN", "1e999", "12abc", "--1", "1 2", "9007199254740993", "$5", "(5)"]) {
      expect(coerceCellValue({ type: "number" }, text), text).toMatchObject({ ok: false });
    }
  });

  it("takes Excel's thousands separators only when they are well-formed", () => {
    expect(coerceCellValue({ type: "number" }, "1,234.50")).toEqual({ ok: true, value: 1234.5 });
    expect(coerceCellValue({ type: "number" }, "-1,234,567")).toEqual({ ok: true, value: -1234567 });
    // "1,5" is one and a half in half the world. Guessing writes a wrong number.
    expect(coerceCellValue({ type: "number" }, "1,5")).toMatchObject({ ok: false });
    expect(coerceCellValue({ type: "number" }, "12,34")).toMatchObject({ ok: false });
  });

  it("takes a real number from an agent and refuses what is not one", () => {
    expect(coerceCellValue({ type: "number" }, -2)).toEqual({ ok: true, value: -2 });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, true, {}, []]) {
      expect(coerceCellValue({ type: "number" }, bad)).toMatchObject({ ok: false });
    }
  });

  it("enforces min and max with the bound in the message", () => {
    expect(coerceCellValue({ type: "number", min: 0 }, -1)).toEqual({ ok: false, error: "Must be at least 0." });
    expect(coerceCellValue({ type: "number", max: 5 }, 6)).toEqual({ ok: false, error: "Must be at most 5." });
    expect(coerceCellValue({ type: "number", step: 0.5 }, 0.25)).toEqual({ ok: false, error: "Must be in steps of 0.5." });
    expect(coerceCellValue({ type: "number", step: 0.1 }, 0.3)).toEqual({ ok: true, value: 0.3 });
  });

  it("matches a select by value, then by exact label, and stores the value", () => {
    const editor = { type: "select" as const, options: ["open", { value: "done", label: "Finished" }] };
    expect(coerceCellValue(editor, "open")).toEqual({ ok: true, value: "open" });
    expect(coerceCellValue(editor, "done")).toEqual({ ok: true, value: "done" });
    expect(coerceCellValue(editor, "Finished")).toEqual({ ok: true, value: "done" });
    expect(coerceCellValue(editor, "")).toEqual({ ok: true, value: null });
    expect(coerceCellValue(editor, "finished")).toMatchObject({ ok: false });
  });

  it("keeps text verbatim and enforces maxLength", () => {
    expect(coerceCellValue({ type: "text" }, "  a b ")).toEqual({ ok: true, value: "  a b " });
    expect(coerceCellValue({ type: "text" }, 5)).toEqual({ ok: true, value: "5" });
    expect(coerceCellValue({ type: "text", maxLength: 2 }, "abc")).toEqual({ ok: false, error: "Must be at most 2 characters." });
    expect(coerceCellValue({ type: "text" }, { a: 1 })).toMatchObject({ ok: false });
  });
});

describe("declared in JSON", () => {
  it("survives a JSON round trip and still edits", async () => {
    const onCellEdit = vi.fn();
    const parsed = JSON.parse(JSON.stringify(COLUMNS)) as FancyGridColumn<Row>[];
    const ref = createRef<FancyDataGridHandle>();
    mount(<FancyDataGrid<Row> ref={ref} gridId="g" columns={parsed} rows={makeRows()} onCellEdit={onCellEdit} />);

    await act(async () => { await ref.current!.editCell("a", "qty", "9"); });

    expect(onCellEdit.mock.calls[0][0]).toMatchObject({ rowId: "a", columnId: "qty", value: 9 });
  });

  it("marks only editable cells, and the handles name row and column", () => {
    mount(<Host />);

    expect(cell("a", "name").hasAttribute("data-fancy-grid-editable")).toBe(true);
    expect(cell("a", "note").hasAttribute("data-fancy-grid-editable")).toBe(false);
    expect(cell("b", "qty").getAttribute("data-fancy-grid-cell-row")).toBe("b");
  });

  it("adds nothing to a read-only grid: no tabindex, no grid role", () => {
    // A table an existing consumer already ships must not grow tab stops.
    const plain: FancyGridColumn<Row>[] = [{ id: "note", header: "Note" }];
    mount(<FancyDataGrid<Row> gridId="g" columns={plain} rows={makeRows()} />);

    expect(document.querySelector("[tabindex]")).toBeNull();
    expect(document.querySelector("table")?.getAttribute("role")).toBeNull();
  });

  it("reports the editor from the handle, so an agent knows what a column takes", () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);

    const info = ref.current!.getColumnInfo();
    expect(info.find((c) => c.id === "qty")?.editor).toEqual({ type: "number", min: 0, max: 100 });
    expect(info.find((c) => c.id === "owner")?.editor).toEqual({ type: "text" });
    expect(info.find((c) => c.id === "note")?.editor).toBeNull();
  });
});

describe("keyboard", () => {
  it("makes one cell the tab stop, and Tab can leave the grid when not editing", () => {
    mount(<Host />);

    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cell("a", "name").getAttribute("tabindex")).toBe("0");

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    focus(cell("a", "name"));
    act(() => { cell("a", "name").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it("moves the active cell with the arrows, through state, and clamps at the edges", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    expect(latest.state.activeCell).toEqual({ rowId: "a", columnId: "name" });

    press(cell("a", "name"), "ArrowRight");
    expect(latest.state.activeCell).toEqual({ rowId: "a", columnId: "qty" });
    expect(document.activeElement).toBe(cell("a", "qty"));
    expect(cell("a", "qty").hasAttribute("data-fancy-grid-active")).toBe(true);

    press(cell("a", "qty"), "ArrowDown");
    expect(latest.state.activeCell).toEqual({ rowId: "b", columnId: "qty" });

    press(cell("b", "qty"), "ArrowLeft");
    press(cell("b", "name"), "ArrowLeft");
    expect(latest.state.activeCell).toEqual({ rowId: "b", columnId: "name" });

    press(cell("b", "name"), "ArrowUp");
    press(cell("a", "name"), "ArrowUp");
    expect(latest.state.activeCell).toEqual({ rowId: "a", columnId: "name" });
  });

  it("navigates in display order, so a sort or a pin moves it with what is on screen", () => {
    mount(<Host initial={{ columnPinning: { left: ["status"] }, columnVisibility: { qty: false } }} />);

    focus(cell("a", "status"));
    press(cell("a", "status"), "ArrowRight");
    // status (pinned) -> name, skipping nothing; qty is hidden.
    expect(latest.state.activeCell?.columnId).toBe("name");
    press(cell("a", "name"), "ArrowRight");
    expect(latest.state.activeCell?.columnId).toBe("note");
  });

  it("does not take a key from an interactive thing inside a custom cell", () => {
    const custom: FancyGridColumn<Row>[] = [
      { id: "name", header: "Name", editable: true, cell: (v) => <button data-inner="">{String(v)}</button> },
    ];
    const onStateChange = vi.fn();
    mount(<FancyDataGrid<Row> gridId="g" columns={custom} rows={makeRows()} state={{}} onStateChange={onStateChange} controls={fancyGridControls} />);
    onStateChange.mockClear();

    press(document.querySelector("[data-inner]")!, "ArrowDown");
    press(document.querySelector("[data-inner]")!, "Enter");

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("opens the editor with Enter, through state, with the value as the draft", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");

    expect(latest.state.editing).toMatchObject({ rowId: "a", columnId: "name", draft: "Ada" });
    expect(cell("a", "name").hasAttribute("data-fancy-grid-editing")).toBe(true);
    expect(cell("a", "name").querySelector("[data-fancy-grid-editor]")?.getAttribute("data-fancy-grid-editor")).toBe("text");
    expect(editor().value).toBe("Ada");
    expect(document.activeElement).toBe(editor());
  });

  it("opens with a double click too", () => {
    mount(<Host />);
    act(() => { cell("c", "status").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(latest.state.editing).toMatchObject({ rowId: "c", columnId: "status", draft: "open" });
  });

  it("does not open a column that is not editable", () => {
    mount(<Host />);
    focus(cell("a", "note"));
    press(cell("a", "note"), "Enter");
    expect(latest.state.editing ?? null).toBeNull();
  });

  it("keeps the draft in state, so an agent can read what is being typed", () => {
    mount(<Host />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Adele");

    expect(latest.state.editing?.draft).toBe("Adele");
    expect(latest.rows[0].name, "nothing is written while typing").toBe("Ada");
    expect(JSON.parse(JSON.stringify(latest.state))).toEqual(latest.state);
  });

  it("Escape cancels and restores, writing nothing, with focus back on the cell", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Nope");
    press(editor(), "Escape");
    await settle();

    expect(latest.state.editing).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(cell("a", "name").textContent).toBe("Ada");
    expect(document.activeElement).toBe(cell("a", "name"));
  });

  it("Enter commits and moves down, not editing", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Adele");
    press(editor(), "Enter");
    await settle();

    expect(onEdit.mock.calls[0][0]).toEqual({
      rowId: "a",
      columnId: "name",
      accessor: "name",
      value: "Adele",
      previous: "Ada",
      source: "human",
    });
    expect(cell("a", "name").textContent).toBe("Adele");
    expect(latest.state.editing).toBeNull();
    expect(latest.state.activeCell).toEqual({ rowId: "b", columnId: "name" });
    expect(document.activeElement).toBe(cell("b", "name"));
  });

  it("Tab commits and opens the next editable cell, skipping one that is not", async () => {
    mount(<Host />);
    focus(cell("a", "status"));
    press(cell("a", "status"), "Enter");
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { editor().dispatchEvent(event); });
    await settle();

    expect(event.defaultPrevented).toBe(true);
    // status -> note is read-only -> owner
    expect(latest.state.editing).toMatchObject({ rowId: "a", columnId: "owner" });
  });

  it("Tab wraps to the next row and Shift+Tab goes back", async () => {
    mount(<Host />);
    focus(cell("a", "owner"));
    press(cell("a", "owner"), "Enter");
    press(editor(), "Tab");
    await settle();
    expect(latest.state.editing).toMatchObject({ rowId: "b", columnId: "name" });

    press(editor(), "Tab", { shiftKey: true });
    await settle();
    expect(latest.state.editing).toMatchObject({ rowId: "a", columnId: "owner" });
  });

  it("Tab off the last editable cell closes the editor and lets focus leave", async () => {
    mount(<Host />);
    focus(cell("c", "owner"));
    press(cell("c", "owner"), "Enter");
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { editor().dispatchEvent(event); });
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(latest.state.editing).toBeNull();
    expect(latest.state.activeCell).toEqual({ rowId: "c", columnId: "owner" });
  });

  it("stores a select's value, not its label", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "status"));
    press(cell("a", "status"), "Enter");
    choose("done");
    press(editor(), "Enter");
    await settle();

    expect(onEdit.mock.calls[0][0]).toMatchObject({ value: "done", previous: "open" });
  });

  it("writes through a dot-path accessor by naming it", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "owner"));
    press(cell("a", "owner"), "Enter");
    type("w");
    press(editor(), "Enter");
    await settle();

    expect(onEdit.mock.calls[0][0]).toMatchObject({ columnId: "owner", accessor: "meta.owner", value: "w", previous: "x" });
  });

  it("does not call the host when nothing changed", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    press(editor(), "Enter");
    await settle();

    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.state.editing).toBeNull();
  });
});

describe("number cells use the published NumberField", () => {
  it("renders react-fancy's NumberField", () => {
    mount(<Host />);
    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    expect(document.querySelector("[data-fancy-grid-editor] [data-react-fancy-number-field]")).not.toBeNull();
  });

  it("commits a blank as null, not 0", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    type("");
    press(editor(), "Enter");
    await settle();

    expect(onEdit.mock.calls[0][0]).toMatchObject({ value: null, previous: 1 });
    expect(latest.rows[0].qty).toBeNull();
  });

  it("opens an empty cell with an empty field, not 0", () => {
    mount(<Host />);
    focus(cell("b", "qty"));
    press(cell("b", "qty"), "Enter");
    expect(editor().value).toBe("");
    expect(latest.state.editing?.draft).toBeNull();
  });

  it("commits a typed number as a number", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    type("42");
    press(editor(), "Enter");
    await settle();

    expect(onEdit.mock.calls[0][0]).toMatchObject({ value: 42 });
  });

  it("refuses unreadable text instead of letting it become a blank", async () => {
    // NumberField reports "not a number" and "blank" both as null, so committing
    // what it emitted would have overwritten the cell with nothing.
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    type("abc");
    press(editor(), "Enter");
    await settle();

    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.state.editing?.error).toBe("Enter a number.");
    expect(latest.rows[0].qty).toBe(1);
  });
});

describe("validation errors are surfaced", () => {
  const errorText = () => document.querySelector("[data-fancy-grid-edit-error]")?.textContent;

  it("keeps the editor open on the cell, with the message visible and in state", async () => {
    const onEdit = vi.fn();
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("");
    press(editor(), "Enter");
    await settle();

    expect(onEdit).not.toHaveBeenCalled();
    expect(latest.state.editing).toMatchObject({ rowId: "a", columnId: "name", error: "Required." });
    expect(errorText()).toBe("Required.");
    expect(document.querySelector("[data-fancy-grid-edit-error]")?.getAttribute("role")).toBe("alert");
    expect(cell("a", "name").getAttribute("aria-invalid")).toBe("true");
    expect(latest.state.activeCell).toEqual({ rowId: "a", columnId: "name" });
  });

  it("does not move on Tab while the cell is invalid", async () => {
    mount(<Host />);
    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    type("500");
    press(editor(), "Tab");
    await settle();

    expect(latest.state.editing).toMatchObject({ columnId: "qty", error: "Must be at most 100." });
  });

  it("clears the error as soon as the draft changes", async () => {
    mount(<Host />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("");
    press(editor(), "Enter");
    await settle();
    type("x");

    expect(latest.state.editing?.error ?? null).toBeNull();
    expect(errorText()).toBeUndefined();
  });

  it("surfaces a refusal the host returned", async () => {
    mount(<Host onEdit={() => ({ error: "Locked by finance." })} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Adele");
    press(editor(), "Enter");
    await settle();

    expect(errorText()).toBe("Locked by finance.");
    expect(latest.rows[0].name).toBe("Ada");
  });

  it("surfaces a thrown error the host did not catch", async () => {
    mount(<Host onEdit={() => { throw new Error("Network down."); }} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Adele");
    press(editor(), "Enter");
    await settle();

    expect(errorText()).toBe("Network down.");
  });

  it("applies a host's own validator on both paths", async () => {
    const validateCell = vi.fn((edit: FancyGridCellEdit) => (edit.value === "bad" ? "Not that one." : null));
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} extra={{ validateCell }} />);

    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("bad");
    press(editor(), "Enter");
    await settle();
    expect(errorText()).toBe("Not that one.");

    let result: unknown;
    await act(async () => { result = await ref.current!.editCell("b", "name", "bad"); });
    expect(result).toMatchObject({ ok: false, error: "Not that one." });
  });

  it("holds a slow write as pending, and ignores a second Enter meanwhile", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onEdit = vi.fn(() => gate);
    mount(<Host onEdit={onEdit} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("Adele");
    press(editor(), "Enter");
    await settle();

    expect(latest.state.editing?.pending).toBe(true);
    press(editor(), "Enter");
    await settle();
    expect(onEdit).toHaveBeenCalledTimes(1);

    release();
    await settle();
    expect(latest.state.editing).toBeNull();
    expect(cell("a", "name").textContent).toBe("Adele");
  });
});

describe("agents and humans go through one path", () => {
  it("gives the host the same shape from both, differing only in source", async () => {
    const onEdit = vi.fn();
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host onEdit={onEdit} gridRef={ref} />);

    focus(cell("a", "qty"));
    press(cell("a", "qty"), "Enter");
    type("7");
    press(editor(), "Enter");
    await settle();

    await act(async () => { await ref.current!.editCell("c", "qty", "8", { source: "agent" }); });

    const [human, agent] = onEdit.mock.calls.map((call) => call[0] as FancyGridCellEdit);
    expect(human).toEqual({ rowId: "a", columnId: "qty", accessor: "qty", value: 7, previous: 1, source: "human" });
    expect(agent).toEqual({ rowId: "c", columnId: "qty", accessor: "qty", value: 8, previous: 3, source: "agent" });
    expect(cell("c", "qty").textContent).toBe("8");
  });

  it("refuses from the agent path exactly what it refuses from the human one", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);

    const attempts: [string, string, unknown, string][] = [
      ["a", "name", "", "Required."],
      ["a", "name", "much too long for this", "Must be at most 12 characters."],
      ["a", "qty", "abc", "Enter a number."],
      ["a", "qty", 500, "Must be at most 100."],
      ["a", "status", "nope", "Must be one of: open, Finished."],
    ];
    for (const [rowId, columnId, value, error] of attempts) {
      let result: unknown;
      await act(async () => { result = await ref.current!.editCell(rowId, columnId, value); });
      expect(result, String(value)).toEqual({ ok: false, code: "invalid", error });
    }
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("names the failure for an unknown row, unknown column or read-only column", async () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);
    const attempt = async (r: string, c: string) => {
      let result: unknown;
      await act(async () => { result = await ref.current!.editCell(r, c, "x"); });
      return result;
    };

    expect(await attempt("zz", "name")).toMatchObject({ ok: false, code: "unknown-row" });
    expect(await attempt("a", "zz")).toMatchObject({ ok: false, code: "unknown-column" });
    expect(await attempt("a", "note")).toMatchObject({ ok: false, code: "not-editable" });
  });

  it("refuses a write when no host will receive it, rather than reporting success", async () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<FancyDataGrid<Row> ref={ref} gridId="g" columns={COLUMNS} rows={makeRows()} />);

    let result: unknown;
    await act(async () => { result = await ref.current!.editCell("a", "name", "Adele"); });
    expect(result).toMatchObject({ ok: false, code: "rejected" });
  });

  it("an agent edit does not disturb a human's open editor", async () => {
    const ref = createRef<FancyDataGridHandle>();
    mount(<Host gridRef={ref} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("half typed");

    await act(async () => { await ref.current!.editCell("b", "qty", 5, { source: "agent" }); });

    expect(latest.state.editing).toMatchObject({ rowId: "a", columnId: "name", draft: "half typed" });
    expect(cell("b", "qty").textContent).toBe("5");
  });

  it("the bridge adapter's editCell is that path, and throws what it refused", async () => {
    const ref = createRef<FancyDataGridHandle>();
    const onEdit = vi.fn();
    mount(<Host gridRef={ref} onEdit={onEdit} />);
    const adapter = createGridBridgeAdapter(ref, { id: "g", getState: () => latest.state, setState: () => {} });

    await act(async () => { await adapter.editCell!("a", "qty", "11"); });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ rowId: "a", value: 11, source: "agent" });

    await expect(adapter.editCell!("a", "qty", "abc")).rejects.toThrow("Enter a number.");
    expect(adapter.validateCell!("a", "qty", "abc")).toBe("Enter a number.");
    expect(adapter.validateCell!("a", "qty", "11")).toBeNull();
  });

  it("omits editCell from a read-only adapter, so the bridge registers no write tool", () => {
    const ref = createRef<FancyDataGridHandle>();
    const adapter = createGridBridgeAdapter(ref, { id: "g", getState: () => ({}), setState: () => {}, readOnly: true });
    expect(adapter.editCell).toBeUndefined();
  });
});

describe("no controls", () => {
  it("warns once and opens nothing, while the agent path still works", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onCellEdit = vi.fn();
    const ref = createRef<FancyDataGridHandle>();
    mount(<FancyDataGrid<Row> ref={ref} gridId="g" columns={COLUMNS} rows={makeRows()} onCellEdit={onCellEdit} />);

    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    press(cell("a", "name"), "Enter");

    expect(document.querySelector("[data-fancy-grid-editor]")).toBeNull();
    expect(warn.mock.calls.filter(([m]) => String(m).includes("controls"))).toHaveLength(1);

    await act(async () => { await ref.current!.editCell("a", "name", "Adele"); });
    expect(onCellEdit).toHaveBeenCalledTimes(1);
  });
});

describe("survives the row leaving the window", () => {
  it("keeps the draft when a virtual window drops the row, and shows it on return", () => {
    const windowOn = (index: number) => ({ items: [{ index, start: 0, end: 36, key: index }], totalSize: 108 });
    function Windowed({ at }: { at: number }) {
      const [state, setState] = useState<FancyGridState>({});
      latest = { state, rows: [] };
      return (
        <FancyDataGrid<Row>
          gridId="g"
          columns={COLUMNS}
          rows={ROWS_STABLE}
          state={state}
          onStateChange={setState}
          controls={fancyGridControls}
          virtual={windowOn(at)}
        />
      );
    }
    const { rerender } = mount(<Windowed at={0} />);
    focus(cell("a", "name"));
    press(cell("a", "name"), "Enter");
    type("half typed");

    rerender(<Windowed at={2} />);
    expect(document.querySelector("[data-fancy-grid-editor]")).toBeNull();
    expect(latest.state.editing?.draft).toBe("half typed");

    rerender(<Windowed at={0} />);
    expect(editor().value).toBe("half typed");
  });
});

const ROWS_STABLE = makeRows();
