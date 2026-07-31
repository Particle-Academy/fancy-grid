import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/virtual.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Every engine stays external. Bundling one here would put a second copy of
  // TanStack Table in a consumer's tree — the failure that already cost this
  // suite a co-install (fancy-flow bundling @xyflow/react shipped zustand@4 and
  // made fancy-screens impossible to install alongside it).
  external: ["react", "react-dom", "@tanstack/react-table", "@tanstack/react-virtual"],
  treeshake: true,
});
