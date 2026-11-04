import type { FancyGridColumn, FancyGridEditor } from "./types";

/** What a column's `editable` declares, resolved. `true` is a text cell. */
export function resolveEditor<TRow>(column: FancyGridColumn<TRow> | undefined): FancyGridEditor | null {
  const editable = column?.editable;
  if (!editable) return null;
  return editable === true ? { type: "text" } : editable;
}

/** Plain decimal notation, the same grammar react-fancy's NumberField reads. */
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const WHOLE = /^[+-]?\d+$/;
/** `1,234.50`, which is what Excel puts on the clipboard for a formatted cell. */
const GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/** The number a piece of text says, or `null` if it does not say one. */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim();
  const plain = GROUPED.test(trimmed) ? trimmed.replace(/,/g, "") : trimmed;
  if (!NUMBER.test(plain)) return null;

  const n = Number(plain);
  if (!Number.isFinite(n)) return null;
  // Past 2^53 a whole number rounds to a different one than was written.
  if (WHOLE.test(plain) && !Number.isSafeInteger(n)) return null;

  return n === 0 ? 0 : n; // -0 is 0
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

const isBlank = (raw: unknown): boolean =>
  raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");

function optionsOf(editor: Extract<FancyGridEditor, { type: "select" }>) {
  return editor.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

/**
 * The one definition of a valid cell: what a value becomes, or why it cannot be.
 *
 * A human's keystrokes, an agent's tool call and a pasted cell all land here, so a
 * value cannot be acceptable on one path and refused on another. It takes text or
 * a JSON value and returns the value to store.
 *
 * - A blank is `null` in a number or select column, never `0` or the first option.
 * - Numbers are plain decimal notation plus well-formed thousands groups. `1,5`,
 *   `$5` and `(5)` are refused rather than guessed at: the guess is a wrong number
 *   that looks right.
 * - A select matches an option's value, then its exact label, and stores the value.
 * - Text is stored verbatim.
 */
export function coerceCellValue(editor: FancyGridEditor, raw: unknown): CoerceResult {
  if (isBlank(raw)) {
    if (editor.required) return { ok: false, error: "Required." };
    if (editor.type !== "text") return { ok: true, value: null };
    return { ok: true, value: raw ?? null };
  }

  switch (editor.type) {
    case "number": {
      let n: number | null = null;
      if (typeof raw === "number") n = Number.isFinite(raw) ? raw : null;
      else if (typeof raw === "string") n = parseNumberText(raw);
      if (n === null) return { ok: false, error: "Enter a number." };
      if (editor.min !== undefined && n < editor.min) return { ok: false, error: `Must be at least ${editor.min}.` };
      if (editor.max !== undefined && n > editor.max) return { ok: false, error: `Must be at most ${editor.max}.` };
      if (editor.step !== undefined && editor.step > 0) {
        const position = (n - (editor.min ?? 0)) / editor.step;
        if (Math.abs(position - Math.round(position)) > 1e-9) {
          return { ok: false, error: `Must be in steps of ${editor.step}.` };
        }
      }
      return { ok: true, value: n };
    }

    case "select": {
      const options = optionsOf(editor);
      const text = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
      const match = options.find((o) => o.value === text) ?? options.find((o) => o.label === text);
      if (match) return { ok: true, value: match.value };
      const named = options.slice(0, 10).map((o) => o.label).join(", ");
      return { ok: false, error: `Must be one of: ${named}${options.length > 10 ? ", ..." : ""}.` };
    }

    case "text": {
      if (typeof raw === "object" || typeof raw === "function") return { ok: false, error: "Enter text." };
      const text = String(raw);
      if (editor.maxLength !== undefined && text.length > editor.maxLength) {
        return { ok: false, error: `Must be at most ${editor.maxLength} characters.` };
      }
      return { ok: true, value: text };
    }
  }
}

/** Whether writing `next` over `previous` changes anything. All blanks are one blank. */
export function isSameCellValue(previous: unknown, next: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (blank(previous) && blank(next)) return true;
  return Object.is(previous, next);
}
