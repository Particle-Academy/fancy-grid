import { describe, expect, it } from "vitest";
import { parseNumberText } from "../src/editing";

describe("parseNumberText", () => {
  it("reads a very long run of digits in linear time", () => {
    const started = performance.now();
    expect(parseNumberText(`${"9".repeat(100_000)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads every shape of decimal", () => {
    for (const [text, want] of [
      ["5", 5],
      ["5.", 5],
      ["5.25", 5.25],
      [".5", 0.5],
      ["-5.5", -5.5],
      ["+5", 5],
      ["1e2", 100],
      ["1.5e-1", 0.15],
      ["5.e2", 500],
      ["1,234.50", 1234.5],
      [".", null],
      ["-", null],
      ["1.2.3", null],
      ["1,5", null],
    ] as const) {
      expect(parseNumberText(text), text).toBe(want);
    }
  });
});
