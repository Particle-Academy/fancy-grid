import type { FancyGridEditor, FancyGridPasteLimits, FancyGridPasteRefusalCode } from "./types";

export const DEFAULT_PASTE_LIMITS: FancyGridPasteLimits = {
  maxRows: 1000,
  maxColumns: 100,
  maxChars: 2_000_000,
};

/**
 * What a spreadsheet reads as the start of a formula or a command. The same list
 * as holy-sheet's `Exchange/Csv.php`, so the suite has one answer to this.
 */
const FORMULA_LEADS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefix an apostrophe, which a spreadsheet takes as "this is text". */
export function neutralizeFormula(text: string): string {
  return text !== "" && FORMULA_LEADS.has(text[0]) ? `'${text}` : text;
}

/** The inverse, so text copied from a grid pastes back as it was. */
export function restoreNeutralized(text: string): string {
  return text.length > 1 && text[0] === "'" && FORMULA_LEADS.has(text[1]) ? text.slice(1) : text;
}

/** A whole string that is one decimal number. It cannot execute, whatever it leads with. */
const PLAIN_NEGATIVE = /^-\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * One cell's value as clipboard text.
 *
 * The rule, matching holy-sheet: **the check is on the value's type.** A number is
 * never neutralized, so `-5` stays a number when it lands in a spreadsheet. A string
 * always is, even one reading `-5`.
 *
 * One addition, because a grid has something a CSV does not: a declared column type.
 * A string in a `type: "number"` column whose ENTIRE text is a plain negative decimal
 * is left alone, because stacks that send decimals as strings (`"-1250.00"`) would
 * otherwise paste as text into every spreadsheet. It cannot execute. Anything else in
 * that column, `-1+1` included, is neutralized.
 */
export function cellToClipboardText(value: unknown, editor?: FancyGridEditor | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    return editor?.type === "number" && PLAIN_NEGATIVE.test(value) ? value : neutralizeFormula(value);
  }
  // A structured value has no spreadsheet form, but "[object Object]" is not one.
  const json = value instanceof Date ? value.toISOString() : JSON.stringify(value);
  return neutralizeFormula(json ?? "");
}

const needsQuotes = /[\t\r\n"]/;

/** TSV as Excel writes it: tabs, CRLF after every row, quotes only where needed. */
export function serializeTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (needsQuotes.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t") + "\r\n")
    .join("");
}

/**
 * A native selection dragged across the table.
 *
 * The browser hands over rendered text, which has already lost each cell's type, so
 * this judges by shape: a cell that is wholly a plain negative number is kept, and
 * anything else leading with a formula character is neutralized. Without this, a
 * mouse drag would be a way around the rule the copy shortcut follows.
 */
export function selectionToClipboardText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((cell) => (PLAIN_NEGATIVE.test(cell.trim()) ? cell : neutralizeFormula(cell)))
        .join("\t"),
    )
    .join("\n");
}

export type ParseResult =
  | { ok: true; rows: string[][] }
  | { ok: false; code: FancyGridPasteRefusalCode; error: string };

/**
 * Read a spreadsheet's clipboard text: TSV, quoted cells, embedded newlines, CRLF.
 *
 * Hostile by assumption, so it is bounded before it is read and refuses rather than
 * trims: a paste silently cut to fit is data lost without anyone being told.
 *
 * A line break inside a quoted cell comes out as LF, the form a spreadsheet stores.
 *
 * A quote opens a quoted cell only if it starts the cell and the closing quote is
 * followed by a tab, a line break or the end. Anything else is a literal character,
 * because Excel quotes only when it must and `"hello" world` arrives bare.
 *
 * That retry stays linear. A failed scan stops at the next odd run of quotes, a cell
 * opening on an even run fails at once, and a later cell can only begin a long scan
 * at an odd run, which is where the last one stopped. A test holds it to that.
 */
export function parseClipboardText(text: string, limits: FancyGridPasteLimits): ParseResult {
  const refuse = (code: FancyGridPasteRefusalCode, error: string): ParseResult => ({ ok: false, code, error });

  if (text.length > limits.maxChars) {
    return refuse("too-large", `This paste has ${text.length} characters. The limit is ${limits.maxChars}.`);
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source === "") return refuse("empty", "There is nothing to paste.");

  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const end = source.length;

  const readQuoted = (start: number): { cell: string; next: number } | null => {
    let cursor = start + 1;
    while (cursor < end) {
      const quote = source.indexOf('"', cursor);
      if (quote === -1) return null;
      if (source[quote + 1] === '"') {
        cursor = quote + 2;
        continue;
      }
      const after = source[quote + 1];
      if (after === undefined || after === "\t" || after === "\n" || after === "\r") {
        // CRLF to LF, because Windows rewrites LF on the clipboard. Otherwise a value
        // with a line break copied out of a grid pastes back reading as changed.
        return { cell: source.slice(start + 1, quote).replace(/""/g, '"').replace(/\r\n/g, "\n"), next: quote + 1 };
      }
      return null;
    }
    return null;
  };

  while (i <= end) {
    let cell: string;
    const quoted = source[i] === '"' ? readQuoted(i) : null;

    if (quoted) {
      cell = quoted.cell;
      i = quoted.next;
    } else {
      let stop = i;
      while (stop < end && source[stop] !== "\t" && source[stop] !== "\n" && source[stop] !== "\r") stop++;
      cell = source.slice(i, stop);
      i = stop;
    }

    row.push(cell);
    if (row.length > limits.maxColumns) {
      return refuse("too-many-columns", `This paste has more than ${limits.maxColumns} columns. The limit is ${limits.maxColumns}.`);
    }

    const separator = source[i];
    if (separator === "\t") {
      i++;
      if (i === end) {
        // A trailing tab is one more, empty, cell.
        row.push("");
        break;
      }
      continue;
    }

    rows.push(row);
    row = [];
    if (rows.length > limits.maxRows) {
      return refuse("too-many-rows", `This paste has more than ${limits.maxRows} rows. The limit is ${limits.maxRows}.`);
    }
    if (separator === undefined) break;
    i += separator === "\r" && source[i + 1] === "\n" ? 2 : 1;
    // The break that ends the last row is not the start of another one.
    if (i >= end) break;
  }
  if (row.length > 0) rows.push(row);

  return { ok: true, rows };
}

/** C0 and C1 controls except tab and line breaks, and the characters that reorder text. */
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

/**
 * A character that would make the stage show something other than what it holds.
 * A person reviewing `U+202E` text reads a different string from the one they would
 * approve, so that defeats the point of reviewing it.
 */
export function findUnsafeCharacter(text: string): string | null {
  const found = UNSAFE.exec(text);
  return found ? `U+${found[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}` : null;
}
