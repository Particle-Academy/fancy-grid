# AGENTS.md — fancy-grid

A data grid on TanStack Table + Virtual. `CLAUDE.md` points here. Read the
envelope's `AGENTS.md` too.

## The rule that shapes this repo

**TanStack is supported, never depended on.** The engines are peers, nothing is
bundled, and installing `fancy-grid` is the ONLY way anyone in this suite ends
up with a TanStack table engine in their tree. No other Fancy package may gain a
TanStack dependency because this one exists.

Concretely, and asserted in `tests/packaging.test.ts`:

- `dependencies` is empty and stays empty.
- `@tanstack/react-table` is a required peer; `@tanstack/react-virtual` an
  optional one.
- Neither is ever added to `noExternal` in `tsup.config.ts`. Bundling one puts a
  second copy in a consumer's tree — `fancy-flow` bundling `@xyflow/react`
  shipped zustand@4 to everyone and made `fancy-screens` impossible to
  co-install, and nothing reported it, because a resolver quietly choosing an
  older version looks exactly like success.
- **The root entry never imports `@tanstack/react-virtual`.** An optional peer
  imported from the root entry is not optional — the import runs whether or not
  the consumer virtualizes anything. Windowing lives on the `./virtual` entry
  for that reason alone, and a dist-level test pins it.

## What this component owes

It is an interactive surface, so it owes the full component contract — both the
authoring half and the inhabited half.

1. **Controlled, and serializable.** `state` + `onStateChange`, one object,
   always the FULL next state. Never emit a slice: a host that has to merge
   slices to know what the grid shows is a host an agent cannot read back from.
   Every field must survive `JSON.parse(JSON.stringify(state))`.

2. **Stable handles, rooted on `gridId`.** `data-fancy-grid-row` is keyed by ROW
   ID, never by index — an index-keyed handle points at a different row after a
   sort, and selection silently follows the wrong rows. Adding a new interactive
   element means adding its handle in the same commit.

3. **JSON-friendly columns.** A column an agent can emit has no functions in it.
   `accessor` is a dot-path rather than a getter for exactly this reason. `cell`
   exists for humans; nothing may require it to work.

4. **Predictable over faithful.** Where the engine's default is inconsistent,
   this package picks one rule and documents it — `sortDescFirst: false` so a
   first click ascends on every column, rather than descending on numbers and
   ascending on text. An agent reading the state back should not have to know
   the column's data type to predict it.

5. **Never present a page as the whole.** In `serverSide` mode the grid reports
   intent and performs nothing. The failure being avoided is a grid that sorts
   the one page it holds and shows it as the sorted result — wrong, and it looks
   completely correct.

## Commands

```bash
npm install
npm test      # vitest — behaviour + packaging contract
npm run lint  # tsc --noEmit && eslint .
npm run build # tsup
```

## Conventions

- **Tests render against a real document** (jsdom) and read the DOM back. A mock
  that agrees with whatever we rendered proves nothing.
- **Handles are asserted in tests.** They are the agent-facing API; if they move,
  every agent that learned this grid breaks silently — it finds nothing and
  reports nothing.
- **`react-fancy` is an OPTIONAL peer, on the `./controls` entry only.** The grid
  itself is structural and matches the suite's Tailwind vocabulary without an
  import, and a read-only grid must not have to install a component kit. Anything
  interactive (cell editors, paste review buttons) is a `FancyGridControls` entry
  the root takes as a prop, and `./controls` is where those are built from
  `react-fancy`. The same reason `./virtual` is separate, and a dist-level test
  pins it. There is no hand-rolled fallback: without `controls`, no editor opens.
- **Every write takes one path.** `checkEdit` then `deliverEdit` in
  `FancyDataGrid.tsx`, whether it came from a keystroke, the handle or a bridge.
  `coerceCellValue` in `src/editing.ts` is the only definition of a valid cell. A
  second path is how a value ends up accepted from an agent and refused from a human.
- **The grid never holds an edit of its own and never changes `rows`.** The active
  cell, the open editor and its draft are all in `state`, so an agent can read them
  and a virtual window can drop a row without losing a half-typed value.
- **A paste is staged, always, and what was approved is what gets applied.** Never add
  a path from clipboard text to `onCellEdit` that skips `state.pendingPaste`. A second
  stage must not replace one under review, and a confirm re-checks every cell against
  the current rows.
- **Pasted text is hostile.** It is `text/plain` only, it renders as a text node, and
  it never reaches a custom `cell` before it is confirmed. Refuse rather than trim.
- **Neutralizing is by value type**, matching holy-sheet's `Exchange/Csv.php`. Change
  one and check the other.
- **A cell under a sticky column looks in view to the browser.** `focus()` will not
  scroll it out, and `scroll-margin` does not fix that. `revealPastPins` does, and
  only a real browser can tell the difference.
- `process.env.NODE_ENV` is declared in `src/env.d.ts` rather than by installing
  `@types/node` — this is a browser package, and Node's globals must not
  typecheck clean here.
