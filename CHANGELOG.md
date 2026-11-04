# Changelog

All notable changes to `@particle-academy/fancy-grid` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0: breaking changes land in MINOR releases.** The version number
> cannot promise otherwise until 1.0, so read the `Changed` section before
> taking a new minor — each breaking entry says what you have to do, and most
> of the time the answer is nothing.

## [Unreleased]

## [0.4.1] - 2026-11-04

### Security

- **A cell's number text is read in linear time.** The pattern behind number cells and paste could backtrack badly, so a very long pasted string of digits could freeze the tab. Every number it accepted is still accepted. **Consumer action:** none.

## [0.4.0] - 2026-11-04

### Added

- **Column visibility, pinning and grouped headers**, all declared as JSON. `state.columnVisibility` (`false` hides; no entry means visible) and `state.columnPinning` (`{ left, right }`) are two new slices on the state object, and a column with `columns: [...]` is a group: a header with a real `colSpan` over its leaves, nesting as deep as you like. Nothing is on by default. **Consumer action:** none; an existing grid renders the same table.
  - Pinned columns stick under horizontal and windowed scrolling. Offsets come from the width the browser actually laid out, not the declared one, because a table stretches and shrinks columns to fit. Pinned cells paint an opaque surface; a grid sitting on anything other than white or `zinc-900` should set `--fancy-grid-surface` on an ancestor to match.
  - The row-number gutter sticks with left-pinned columns.
  - A group straddling the pin boundary splits into two header cells, one stuck and one scrolling.
  - The spreadsheet presentation (`columnLabels="letters"`) shows only the letter row, since letters address leaves.
  - New handles: `data-fancy-grid-pinned="left|right"`, `data-fancy-grid-pinned-edge`, `data-fancy-grid-header-group="<id>"`, `data-fancy-grid-header-placeholder="<leafId>"`.
- **A `ref` handle and `createGridBridgeAdapter(ref, { id, getState, setState })`** so `registerGridBridge` from `@particle-academy/agent-integrations` reaches the mounted grid. `getColumnIds()`, `getRowIds()` and `getColumnInfo()` for now. New exports: `createGridBridgeAdapter`, `FancyDataGridHandle`, `FancyGridBridgeAdapter`, `FancyGridBridgeAdapterOptions`, `FancyGridColumnInfo`, `FancyGridColumnPinning`.
- **Inline cell editing, declared on the column.** `editable: true` for text, or `editable: { type: "text" | "number" | "select", required?, min?, max?, step?, maxLength?, options?, placeholder? }`. It is JSON, so an agent can declare it too. Pass `controls={fancyGridControls}` and `onCellEdit`. The grid never changes `rows`: every write goes to `onCellEdit(edit)`, which may be async and may return `{ error }` or throw to refuse. **Consumer action:** none unless you want it. A grid with no editable column gains no tab stops and no `role="grid"`.
  - **New subpath `@particle-academy/fancy-grid/controls`** exports `fancyGridControls`, built from `react-fancy`'s `Input`, `Select` and `NumberField`. **New OPTIONAL peer:** `@particle-academy/react-fancy >=6.7.1 <7.0.0`, needed only if you import that subpath. The root entry never imports it.
  - **Blank is `null`** in a number or select column, never `0`. Unreadable text in a number cell is refused rather than treated as blank.
  - **Keyboard:** arrows move the active cell; Enter or F2 opens; Enter commits and moves down; Tab commits and opens the next editable cell (Shift+Tab goes back, and off the end of the table focus leaves); Escape cancels and restores. A double click also opens. A click on another cell commits; focus leaving the grid does not.
  - **All of it is state.** `state.activeCell` and `state.editing` (`{ rowId, columnId, draft, error, pending }`), so an agent can read what a person is typing, a refusal shows on the cell, and a draft survives its row leaving a virtual window.
  - **One path for humans and agents.** `ref.current.editCell(rowId, columnId, value)` runs what a human's commit runs: the column's rules, then your `validateCell`, then `onCellEdit`, with `source` set to `"agent"`. `createGridBridgeAdapter` wires `grid_edit_cell` to it. New: `coerceCellValue`, `parseNumberText`, and the types `FancyGridCellEdit`, `FancyGridCellRef`, `FancyGridControls`, `FancyGridEditFailure`, `FancyGridEditResult`, `FancyGridEditing`, `FancyGridEditor`, `FancyGridEditorProps`, `FancyGridSelectOption`.
  - New handles: `data-fancy-grid-cell-row="<rowId>"` on every cell, `data-fancy-grid-editable`, `data-fancy-grid-active`, `data-fancy-grid-editing`, `data-fancy-grid-editor="<type>"`, `data-fancy-grid-edit-error`.
  - `FancyGridVirtual` gains an optional `scrollToIndex`, which `useGridVirtualizer` supplies, so keyboard navigation can bring a row into the window. A cell scrolling under a pinned column is scrolled clear of it.
- **Copy and paste, through a stage-and-confirm step.** Opt in with the `clipboard` prop (`true`, or `{ copy?, paste?, limits? }`). **Consumer action:** none unless you want it; it is off by default, and a paste needs `controls` with a `button`, which `fancyGridControls` has.
  - **Copy writes TSV with formula injection neutralized.** A cell beginning with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` before it is quoted, the same rule as holy-sheet's CSV export. **The check is on the value's type: a real number is never touched, so `-5` stays a number in a spreadsheet, while the string `"-5"` is neutralized.** One addition holy-sheet has no column types to need: in a `type: "number"` column, a string that is wholly a plain negative decimal (`"-1250.00"`) is left alone, since it cannot execute. `-1+1` in that column is still neutralized. Ctrl+C copies the selected rows, or the active cell. A mouse drag across the table is neutralized too, by shape, since rendered text has lost its type.
  - **Paste parses a spreadsheet's clipboard** (tabs, quoted cells, embedded newlines, doubled quotes, CRLF) and writes nothing. Every cell is checked against its column with the same rules a human edit and an agent edit get. It lands in `state.pendingPaste` and shows in place in the grid, with the old value on the cell, until someone confirms or rejects it. Confirm goes to `onCellEdits(edits)` if you supply it, or to `onCellEdit` for each cell. New handles: `data-fancy-grid-paste-review`, `data-fancy-grid-paste-confirm`, `data-fancy-grid-paste-reject`, `data-fancy-grid-paste-error`, `data-fancy-grid-paste-refused`, `data-fancy-grid-staged="change|invalid|same"`, `data-fancy-grid-staged-value`, `data-fancy-grid-staged-error`.
  - **Pasted text is treated as hostile.** Only `text/plain` is read, never the HTML flavour. Staged values render as text and never through a custom `cell`. A control character or a bidi override is an error on that cell, because a preview containing one shows something other than what it holds. Bounded before it is read (`maxRows` 1000, `maxColumns` 100, `maxChars` 2,000,000, all overridable), and over the limit is a clear refusal in `state.pasteRefusal`. So is a paste taller or wider than the grid has room for: nothing is ever trimmed to fit, and no rows are created.
  - **What is approved is what gets applied.** A second paste cannot replace one under review. A confirm names the stage's `id`. A cell that changed after it was staged, or a row that has gone, refuses the confirm rather than overwriting. A stage with errors applies only with `skipInvalid`, and the button says what it will skip. If the host refuses partway, the stage keeps only what is still unwritten and says how far it got.
  - A copy pastes back unchanged: a leading `'` before a formula character is removed on paste. So a value literally reading `'=x` loses its apostrophe, visibly, in the review. A line break inside a quoted cell comes in as LF, because Windows rewrites it to CRLF on the clipboard.
  - New on the handle: `copy()`, `stagePaste()`, `confirmPaste()`, `rejectPaste()`, all wired through `createGridBridgeAdapter`. New exports: `DEFAULT_PASTE_LIMITS`, `cellToClipboardText`, `neutralizeFormula`, `parseClipboardText`, `serializeTsv`, and the types `FancyGridButtonProps`, `FancyGridConfirmPasteResult`, `FancyGridCopyOptions`, `FancyGridPasteLimits`, `FancyGridPasteRefusal`, `FancyGridPasteRefusalCode`, `FancyGridPendingPaste`, `FancyGridStagePasteResult`, `FancyGridStagedCell`.

### Fixed

- **A controlled grid re-rendered forever and cut itself to 25 rows.** Any slice the caller omitted was a new `[]` on every render, which the engine read as a changed filter. It reset the page index, and that write reached `onStateChange` as an invented `pagination: { pageIndex: 0, pageSize: 25 }`. A host storing what it was given then showed 25 rows with no error, and queued the next render from the one before. A grid that WAS paged went back to page one on every render. Omitted slices now have one identity, and the reset only runs on a grid that has `pagination`. **Consumer action:** none, unless a saved view captured that invented `pagination`: remove it, or that grid stays paged at 25.
- The empty row and the virtual spacers span what is visible, gutter included. They were `columns.length`, which was already short by one with `rowNumbers` on.
- A column's declared `width` is now a floor as well as a preference (`min-width`). Auto table layout compressed it to min-content, so a wide table's "fixed" columns came out far narrower. **Consumer action:** none, though a table wider than its container now overflows where it used to squeeze, so make sure it has a scrolling parent.
- `data-index` on a windowed row is its position in the model, not its original index. After a sort the two differ, and the virtualizer filed each row's measured height under some other row.
- The README said `registerGridBridge` was still to come. It has shipped, from `@particle-academy/agent-integrations/bridges/grid`, and the README now says so. Consumer action: none.

### Changed

- Test environment: jsdom moved to 30 (devDependency only), dropping the deprecated `whatwg-encoding`. Consumer action: none.

### Fixed

- **`CHANGELOG.md` is now in the published tarball.** `files` did not whitelist it, so npm never shipped it — and this package puts breaking changes in MINOR releases and tells you in the README to read the entry before taking one. The instruction existed for the author, who has the file, and not for the consumer, who is the only one being instructed. Nothing for you to do; the file simply arrives from this release on.

### Security

- `source-map-js` is pinned forward to `^1.2.2` via `overrides`. Versions up to
  1.2.1 allow an event-loop denial of service through indexed source-map section
  offsets, and it arrives here transitively through the build toolchain.
  **Nothing for a consumer to do, and no runtime change**: an npm package does
  not ship a lockfile, so this governs builds OF this repo, not anything
  installed FROM it. Recorded rather than left silent because the override it
  sits beside — `shell-quote` `^1.9.0`, added for an earlier advisory — was
  carried with no note of why, and had drifted back inside the vulnerable range
  before anyone looked.
- **Dev toolchain only — no runtime change, nothing for consumers to do.** The
  lockfile now resolves `vite` 8.3.5 (was 8.2.2), whose bundled
  `launch-editor` fixes GHSA-587h-7wmj-h5pm (HIGH, `fs.existsSync()` check
  bypassable on Windows), GHSA-698v-4r3x-3vcv (`escapeCmdArgs()` omits `%`
  escaping on Windows) and GHSA-r825-w8mm-5pxw (editor CLI flag
  misinterpretation). `vite` is only reached through the test/dev toolchain
  and the published package does not ship our lockfile, so the exposure was
  this repo's own dev server.

- Dev-only lockfile update: `vitest` 4.1.11 to 4.1.12, which brings `@vitest/mocker` 4.1.12 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp). Test tooling only; nothing ships in the package. Consumer action: none.

## [0.3.0] — 2026-08-09

### Added

- **Spreadsheet presentation** — `columnLabels="letters"` and `rowNumbers`.
  Story #170, task 234.

  ```tsx
  <FancyDataGrid gridId="sheet" columns={cols} rows={rows} columnLabels="letters" rowNumbers />
  ```

  Column heads become `A`, `B`, `C`, a row-number gutter runs down the left, and
  each cell gains `data-fancy-grid-address="B2"`.

  The gallery's spreadsheet style needed a read-only cell-addressed grid and
  noted `fancy-sheets` — the full editable workbook — was far too heavy for it.
  This is an **extension rather than a new component**: it is the same table
  presented with different labels, and reusing it keeps selection, virtualisation
  and server-side mode instead of growing a second grid that slowly reimplements
  them.

  **The address is separate from the handle, deliberately.**
  `data-fancy-grid-cell` still carries the column id. A1 is *positional* — `B2`
  names whatever currently sits in the second column of the second row, so it
  moves under a sort or filter. This package's rule is that handles key on
  identity and never on index, exactly because an index-keyed handle silently
  points at a different row afterwards. Overloading the stable handle with a
  positional one would have broken that quietly, so they are two attributes:
  address it as a human reads it, key on it as code must.

  Both options default off; nothing changes for existing consumers, and a test
  asserts that.


## [0.2.0] — 2026-08-07

### Changed

- **BREAKING — Node 22 is now declared as the floor.** `engines.node` is `>=22`, where this package previously declared **nothing at all**.

  Declaring nothing was not the same as supporting old Node: a consumer on 18 installed cleanly and found out at runtime.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

- **BREAKING — React 18 is no longer supported.** `peerDependencies.react` / `react-dom` are now `^19.0.0`.

  **What you must do:** on React 19, nothing. On React 18, stay on the previous release, or upgrade your app to 19 first.

  React 18 support was a claim nothing tested — every build and test in this package ran against 19, so the 18 half of the old range was never executed. An untested compatibility claim is worse than an absent one, because it reads as support.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.


## [0.1.0] - 2026-07-31

First release. Closes the two gaps the suite had in this area: no generic table
engine, and no windowing anywhere at all.

### Added

- **`<FancyDataGrid>`** — TanStack Table under a controlled surface. Sorting,
  filtering, row selection and pagination, with JSON-friendly column definitions
  (`{ id, header, accessor, sortable, align, width }`) that survive a round trip
  through an MCP tool call. `cell` remains as the escape hatch for human-authored
  markup; nothing requires it.

- **One state object, always complete.** `onStateChange` receives the full next
  state rather than a slice, so a controlled host never merges to learn what the
  grid is showing — and neither does an agent reading it back.

- **Stable handles on everything addressable** — `data-fancy-grid`,
  `-header`, `-row`, `-cell`, `-selected`, `-sort`, `-empty`, all rooted on
  `gridId` so one page can hold several grids. This is what a bridge addresses
  instead of scraping the DOM.

- **Server-side mode** (`serverSide` + `rowCount`) — sorting/filtering/pagination
  become intent the grid reports rather than work it performs. Without it a grid
  sorts the single page it holds and presents that as the sorted whole, which is
  a wrong answer that looks entirely correct.

- **Opt-in windowing** via `useGridVirtualizer` on the `./virtual` entry, using
  spacer rows rather than transforms so table semantics survive for screen
  readers. Nothing in the suite windowed anything before this, so the hook is
  shaped as a general row-windowing seam other surfaces can adopt.

- **A development warning for unstable `columns`/`rows` references** — TanStack
  Table's most-reported failure, whose symptom is a frozen tab with no error.

### Changed

- **Sorting is ascending on the first click for every column.** TanStack defaults
  to descending-first on numeric columns and ascending-first on text, so the same
  gesture means different things depending on the data type — and the JSON state
  an agent reads back flips with it.

### Notes

- **The engines are peers and nothing is bundled.** No runtime dependencies at
  all; `@tanstack/react-table` is a required peer, `@tanstack/react-virtual` an
  optional one. Tests assert this, including that the root entry never
  references the virtualizer — an optional peer imported from the root entry is
  not optional. `fancy-flow` bundling `@xyflow/react` once shipped zustand@4 into
  every consumer and made `fancy-screens` impossible to co-install; that is the
  failure these assertions exist to prevent.
- No dependency on `react-fancy`. The grid is structural, and the Tailwind
  vocabulary matches the suite without an import.

[0.1.0]: https://github.com/Particle-Academy/fancy-grid/releases/tag/v0.1.0
