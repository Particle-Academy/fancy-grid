import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * The promises this package makes about what it drags into a consumer's tree.
 *
 * `fancy-flow` bundling `@xyflow/react` shipped zustand@4 into every consumer
 * and made `fancy-screens` (peers zustand ^5) impossible to co-install. Nothing
 * reported it — a resolver quietly picking an older version, or installing a
 * second copy of a shared core, looks exactly like success. These assertions are
 * cheap; that class of bug is not.
 */
describe("dependency contract", () => {
  it("declares no runtime dependencies at all", () => {
    // TanStack is SUPPORTED, never depended on. The moment an engine appears
    // here, every consumer of this package installs it whether they use the
    // grid or not.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("keeps both TanStack engines as peers", () => {
    expect(pkg.peerDependencies["@tanstack/react-table"]).toBeDefined();
    expect(pkg.peerDependencies["@tanstack/react-virtual"]).toBeDefined();
  });

  it("marks the virtualizer optional, because windowing is opt-in", () => {
    expect(pkg.peerDependenciesMeta["@tanstack/react-virtual"].optional).toBe(true);
    // Table is NOT optional — there is no grid without it, and a silent
    // "optional" would turn a missing install into a runtime crash instead of
    // an install-time warning.
    expect(pkg.peerDependenciesMeta["@tanstack/react-table"]).toBeUndefined();
  });
});

/**
 * An optional peer imported from the root entry is not optional: the import runs
 * whether or not the consumer virtualizes anything. That is why windowing lives
 * on its own entry, and why this is worth a test rather than a comment.
 */
describe("entry isolation", () => {
  const dist = (file: string) => {
    try {
      return readFileSync(join(root, "dist", file), "utf8");
    } catch {
      return null;
    }
  };

  it("never references the virtualizer from the root entry", () => {
    for (const file of ["index.js", "index.cjs"]) {
      const source = dist(file);
      if (source === null) continue; // not built in this run
      expect(source).not.toContain("@tanstack/react-virtual");
    }
  });

  it("does reference it from the /virtual entry", () => {
    const source = dist("virtual.js");
    if (source === null) return;
    expect(source).toContain("@tanstack/react-virtual");
  });
});
