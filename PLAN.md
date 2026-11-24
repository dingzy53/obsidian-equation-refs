# PLAN: QA audit fixes (equation-refs)

> Branch: `fix/qa-audit-fixes` (from `fix/cold-boot-mathjax-race`) · Date: 2026-11-24 · Status: Implemented and verified.
>
> The previous `fix/cold-boot-mathjax-race` plan is preserved in git history.

## Context & Findings

From `/Users/ding/GitHub/OBSIDIAN_PLUGINS_QA_REPORT.md`:

1. **BUG-01 (P1)**: Live Preview equation links go blank after renumbering or a format change (`Same-note reference format` -> `Eq. {n}`). Links whose text did not change remain visible; links whose text changed render as empty text until the note is closed and reopened.
2. **BUG-09 (P3)**: Ctrl/Cmd-hover popover over `Maxwell (1)` shows the equation without its `(1)` number, although inline embeds (`![[Maxwell#^gauss]]`) show it.

## Verified Root Causes & Fix Design

### 1. Live Preview blank links after renumber / format change (`src/render/live-preview/reference-links.ts`)
- Obsidian's built-in Live Preview formatting plugin (`Yoe`) runs at default precedence before `editorExtensions` and emits `Decoration.replace` (`Qoe`, empty `<span>`) over the `[[#` opener (`[start, start+3]`).
- When `ReferenceLinksView` rebuilds decorations via `refresh` without `docChanged`, `RangeSet.compare` treats `[start, start+3]` as unchanged and emits only `[start+3, end]`. CodeMirror's `RangeSet.spans` sees `pointFrom < from` (`openStart > active.length`), calls `TileUpdate.continueWidget()`, extends `Qoe`'s empty `<span>`, and drops `ReferenceWidget`.
- **Fix**: Wrap `ViewPlugin.define(...)` in `Prec.high(...)` in `referenceLinksInEditor()` so `ReferenceWidget` takes precedence over `Yoe` and owns the full `[start, end]` range directly.

### 2. Hover popover equation numbering & same-note embeds (`src/core/math-source.ts`, `src/index/equation-numbers.ts`, `src/main.ts`, `src/render/reading-view.ts`)
- For multi-line `$$\n...\n$$\n^gauss`, Obsidian slices `block.position` (omitting `^gauss`) inside both inline embeds and block hover popovers.
- Inline embeds recover via `.internal-embed[src]`, but `EquationNumberChild.target()` passed `this.fromSection?.path ?? ''`, breaking same-note multi-line embeds (`![[#^gauss]]`).
- Hover popovers wrap the block in `.hover-popover .markdown-embed[data-type="block"]` with no `.internal-embed[src]`.
- **Fix**:
  - Pass `ctx.sourcePath` into `EquationNumberChild` (including via `PendingMathChild`) and use it in `embedTarget(...)`.
  - Listen for `hover-link` on `app.workspace` in `EquationRefsPlugin` to track the hovered block ID per note path, and record normalized TeX per `(path, id)` in `EquationNumbers` for verification and unique-TeX fallback strictly inside `.hover-popover .markdown-embed[data-type="block"]`.

## Order of Work

1. `[x]` Wrap `ReferenceLinksView` in `Prec.high` (`src/render/live-preview/reference-links.ts`) and add a CodeMirror 6 regression test.
2. `[x]` Add `normalizeEquationTex` / `resolveHoverEquationId` (`src/core/math-source.ts`), TeX index lookup (`src/index/equation-numbers.ts`), `hover-link` tracking (`src/main.ts`), and `EquationNumberChild` hover/same-note embed resolution (`src/render/reading-view.ts`), plus unit tests.
3. `[x]` Run `npm run lint`, `npm test`, and `npm run build`, update status to verified, and push `fix/qa-audit-fixes`.

## Verification Plan

- `npm run lint` (0 errors, 0 warnings)
- `npm test` (Vitest unit tests including CM6 `Prec.high` and hover/TeX helpers)
- `npm run build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`)
