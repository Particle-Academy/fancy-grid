import { describe, expect, it } from "vitest";
import {
  DEFAULT_PASTE_LIMITS,
  cellToClipboardText,
  findUnsafeCharacter,
  neutralizeFormula,
  parseClipboardText,
  restoreNeutralized,
  selectionToClipboardText,
  serializeTsv,
} from "../src/clipboard";

const rows = (text: string, limits = DEFAULT_PASTE_LIMITS) => {
  const parsed = parseClipboardText(text, limits);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rows;
};

describe("neutralizeFormula: the same rule as holy-sheet's Exchange/Csv.php", () => {
  it.each(["=SUM(A1)", "+1+1", "-1+1", "@SUM(A1)", "\tleading tab", "\rleading cr"])("prefixes %j", (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it.each(["plain", "", "a=b", " =spaced", "1+1", "'quoted"])("leaves %j alone", (text) => {
    expect(neutralizeFormula(text)).toBe(text);
  });
});

describe("cellToClipboardText", () => {
  it("never touches a real number, negative included", () => {
    // holy-sheet's rule: the check is on the TYPE, so -5 stays a number in Excel.
    expect(cellToClipboardText(-5)).toBe("-5");
    expect(cellToClipboardText(-1234.5)).toBe("-1234.5");
    expect(cellToClipboardText(1e21)).toBe("1e+21");
    expect(cellToClipboardText(0)).toBe("0");
  });

  it("neutralizes a string that merely looks like a negative number", () => {
    // Also holy-sheet's rule: a string is a string.
    expect(cellToClipboardText("-5")).toBe("'-5");
    expect(cellToClipboardText("-5", { type: "text" })).toBe("'-5");
  });

  it("lets plain decimal text through in a column DECLARED as a number", () => {
    // Stacks that send decimals as strings ("-1250.00") would otherwise paste as
    // text into every spreadsheet. It cannot execute: the whole string is a number.
    expect(cellToClipboardText("-1250.00", { type: "number" })).toBe("-1250.00");
    expect(cellToClipboardText("-5e3", { type: "number" })).toBe("-5e3");
  });

  it("still neutralizes anything else in a number column", () => {
    expect(cellToClipboardText("-1+cmd|' /C calc'!A0", { type: "number" })).toBe("'-1+cmd|' /C calc'!A0");
    expect(cellToClipboardText("=1+1", { type: "number" })).toBe("'=1+1");
    expect(cellToClipboardText("+5", { type: "number" })).toBe("'+5");
  });

  it("makes nothing of null and undefined, and never [object Object]", () => {
    expect(cellToClipboardText(null)).toBe("");
    expect(cellToClipboardText(undefined)).toBe("");
    expect(cellToClipboardText({ a: 1 })).toBe('{"a":1}');
    expect(cellToClipboardText(true)).toBe("true");
    expect(cellToClipboardText(["=x"])).toBe('["=x"]');
  });

  it("neutralizes what a structured value serializes to, not just strings", () => {
    expect(cellToClipboardText({ toJSON: () => -5 })).toBe("'-5");
  });
});

describe("serializeTsv", () => {
  it("joins with tabs and ends every row with CRLF, like Excel", () => {
    expect(serializeTsv([["a", "b"], ["c", "d"]])).toBe("a\tb\r\nc\td\r\n");
  });

  it("quotes a cell holding a tab, a newline or a quote, doubling the quotes", () => {
    expect(serializeTsv([["a\tb", 'say "hi"', "two\nlines", "cr\rhere"]])).toBe('"a\tb"\t"say ""hi"""\t"two\nlines"\t"cr\rhere"\r\n');
  });

  it("neutralizes before quoting, so the apostrophe is inside the quotes", () => {
    expect(serializeTsv([[neutralizeFormula('=A1&"x"')]])).toBe(`"'=A1&""x"""\r\n`);
  });
});

describe("parseClipboardText", () => {
  it("reads Excel's plain shape, with its trailing CRLF", () => {
    expect(rows("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("takes LF and bare CR as row breaks too", () => {
    expect(rows("a\nb\rc")).toEqual([["a"], ["b"], ["c"]]);
  });

  it("keeps blank cells and a blank row in the middle", () => {
    expect(rows("a\t\tc\r\n\r\nd\r\n")).toEqual([["a", "", "c"], [""], ["d"]]);
  });

  it("drops only ONE trailing line break", () => {
    expect(rows("a\r\n\r\n")).toEqual([["a"], [""]]);
  });

  it("reads quoted cells with embedded newlines, tabs and doubled quotes", () => {
    expect(rows('"two\nlines"\tb\r\n"tab\there"\t"say ""hi"""\r\n')).toEqual([
      ["two\nlines", "b"],
      ["tab\there", 'say "hi"'],
    ]);
  });

  it("makes a CRLF inside a quoted cell the LF a spreadsheet line break is", () => {
    // Windows turns LF into CRLF on the clipboard, seen in a real browser here. Left
    // alone, a value copied out of a grid and pasted back reads as changed.
    expect(rows('"a\r\nb"\tc')).toEqual([["a\nb", "c"]]);
  });

  it("treats a quote that does not open a well-formed cell as a literal", () => {
    // Excel only quotes when it must, so `"hello" world` arrives bare.
    expect(rows('"hello" world\tb')).toEqual([['"hello" world', "b"]]);
    expect(rows('5" nail\tb')).toEqual([['5" nail', "b"]]);
    expect(rows('"unterminated\tb\r\nc')).toEqual([['"unterminated', "b"], ["c"]]);
  });

  it("reads a whole quoted cell at the very end", () => {
    expect(rows('a\t"b"')).toEqual([["a", "b"]]);
    expect(rows('""')).toEqual([[""]]);
  });

  it("strips a byte-order mark", () => {
    expect(rows("﻿a\tb")).toEqual([["a", "b"]]);
  });

  it("round-trips what serializeTsv writes", () => {
    const table = [["a\tb", 'q"q', "n\nl", "plain"], ["", "x", "y", "z"]];
    expect(rows(serializeTsv(table))).toEqual(table);
  });

  it("refuses an empty paste", () => {
    expect(parseClipboardText("", DEFAULT_PASTE_LIMITS)).toMatchObject({ ok: false, code: "empty" });
  });

  it("refuses too many characters before reading any of them", () => {
    const result = parseClipboardText("x".repeat(101), { ...DEFAULT_PASTE_LIMITS, maxChars: 100 });
    expect(result).toEqual({ ok: false, code: "too-large", error: "This paste has 101 characters. The limit is 100." });
  });

  it("refuses too many rows, naming the limit", () => {
    const result = parseClipboardText("a\nb\nc\n", { ...DEFAULT_PASTE_LIMITS, maxRows: 2 });
    expect(result).toEqual({ ok: false, code: "too-many-rows", error: "This paste has more than 2 rows. The limit is 2." });
  });

  it("refuses too many columns, naming the limit", () => {
    const result = parseClipboardText("a\tb\tc", { ...DEFAULT_PASTE_LIMITS, maxColumns: 2 });
    expect(result).toEqual({ ok: false, code: "too-many-columns", error: "This paste has more than 2 columns. The limit is 2." });
  });

  it("has sensible defaults a real sheet fits inside", () => {
    expect(DEFAULT_PASTE_LIMITS).toEqual({ maxRows: 1000, maxColumns: 100, maxChars: 2_000_000 });
  });

  it("stays fast on text built to make a quote scanner backtrack", () => {
    // Every cell opens a quote that fails only much later. An unbounded rescan is
    // quadratic here, which a hostile paste could use to freeze the tab.
    const shapes = [
      `"""x\t`.repeat(200_000),
      `"x\t""`.repeat(200_000),
      `"`.repeat(1_000_000),
      `""\t`.repeat(300_000),
      `"a"b\t`.repeat(200_000),
      `"""x\t""y\t`.repeat(100_000),
      `"${`""`.repeat(500_000)}`,
    ];
    const limits = { maxRows: 1_000_000, maxColumns: 1_000_000, maxChars: 2_000_000 };
    for (const text of shapes) {
      const started = performance.now();
      parseClipboardText(text, limits);
      expect(performance.now() - started, text.slice(0, 8)).toBeLessThan(1500);
    }
  });
});

describe("restoreNeutralized: the inverse, so a copy pastes back unchanged", () => {
  it("removes our apostrophe from a formula-leading cell", () => {
    expect(restoreNeutralized("'=A1")).toBe("=A1");
    expect(restoreNeutralized("'-5")).toBe("-5");
    expect(restoreNeutralized("'\tx")).toBe("\tx");
  });

  it("leaves any other apostrophe alone", () => {
    expect(restoreNeutralized("'tis")).toBe("'tis");
    expect(restoreNeutralized("don't")).toBe("don't");
    expect(restoreNeutralized("'")).toBe("'");
  });
});

describe("findUnsafeCharacter", () => {
  it("finds control characters and bidi overrides that make a preview lie", () => {
    expect(findUnsafeCharacter("ok\u0000")).toBe("U+0000");
    expect(findUnsafeCharacter("a\u0007b")).toBe("U+0007");
    expect(findUnsafeCharacter("‮gnp.exe")).toBe("U+202E");
    expect(findUnsafeCharacter("x⁦y")).toBe("U+2066");
    expect(findUnsafeCharacter("\u009B")).toBe("U+009B");
  });

  it("allows tabs, newlines and ordinary text in any script", () => {
    for (const ok of ["a\tb", "two\nlines", "\r\n", "naïve 日本語 العربية", "<b>tag</b>"]) {
      expect(findUnsafeCharacter(ok), ok).toBeNull();
    }
  });
});

describe("selectionToClipboardText: dragging over the table cannot bypass it", () => {
  it("neutralizes each cell of a dragged selection", () => {
    expect(selectionToClipboardText("=A1\tok\n@x\t+1")).toBe("'=A1\tok\n'@x\t'+1");
  });

  it("leaves a plain number alone, since a rendered cell has lost its type", () => {
    expect(selectionToClipboardText("-5\t-1.5\n3")).toBe("-5\t-1.5\n3");
  });

  it("still catches a formula that begins with a minus", () => {
    expect(selectionToClipboardText("-1+1")).toBe("'-1+1");
  });
});
