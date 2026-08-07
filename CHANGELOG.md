# Changelog

All notable changes to `@particle-academy/fancy-grid` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0: breaking changes land in MINOR releases.** The version number
> cannot promise otherwise until 1.0, so read the `Changed` section before
> taking a new minor — each breaking entry says what you have to do, and most
> of the time the answer is nothing.

## [Unreleased]

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
