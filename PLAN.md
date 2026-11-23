# PLAN: fix cold-boot MathJax startup race in Reading view

> Branch: `fix/cold-boot-mathjax-race` (from `main`) · Date: 2026-11-23 · Status: Implemented and verified.
>
> The previous `fix/blank-ref-after-external-change` plan is completed and shipped on `main` (available in git history).

## Context & Symptom

Discovered during real-Obsidian WebdriverIO E2E testing on Obsidian `v1.15.1` (both desktop `darwin` and `emulate-mobile`).

When a note containing display equations (for example, `test-vault/Maxwell.md`) is opened in Reading view immediately after a cold Obsidian launch—before Obsidian finishes lazy-loading MathJax—all display equations remain **unnumbered**:

- `plugin.numbers` already has the computed labels (e.g. `gauss -> { text: "1", tagged: false }`).
- In-note reference links (`[[#^faraday]]`, `[[#^gauss]]`, `[[#^lorentz]]`) still format properly as `(2)`, `(1)`, `(3)` with `.eqref-link`.
- However, all `7` display equations in `Maxwell.md` render into `<mjx-container class="MathJax" display="true">`, yet **0** receive `.eqref-numbered` / `data-eq-number` (`plugin.rendered.size === 3`, containing only the 3 `ReferenceLinkChild` instances and zero `EquationNumberChild` instances).
- Opening a second math note or switching views afterward works because MathJax is already loaded by then.

## Verified Root Cause (`src/render/reading-view.ts` & `src/render/dom.ts`)

1. `createReadingViewProcessor` (`src/render/reading-view.ts:18-23`) runs `numberEquations(plugin, el, ctx)` synchronously inside Obsidian's `MarkdownPostProcessor`:
   ```ts
   function numberEquations(plugin: EquationRefsPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
   	const mathEls = Array.from(el.querySelectorAll<HTMLElement>(DISPLAY_MATH)).filter((m) => !isNested(m, el));
   	if (!mathEls.length) return;
   ```
   where `DISPLAY_MATH` (`src/render/dom.ts:3`) is `'mjx-container.MathJax[display="true"]'`.
2. On a cold Obsidian boot, MathJax is lazy-loaded asynchronously when the first math note opens. Obsidian runs `MarkdownPostProcessor` on `el` while the section only contains math placeholder elements (before `<mjx-container class="MathJax" display="true">` has been inserted into the DOM).
3. Because `mathEls.length === 0`, `numberEquations` returns early without registering any `EquationNumberChild` on `ctx`.
4. When Obsidian finishes loading MathJax and inserts `<mjx-container class="MathJax" display="true">` asynchronously afterward, nothing re-invokes `numberEquations` for that section, and subsequent `plugin.numbers.onChange` events have no `EquationNumberChild` registered to update.

## Proposed Fix Design

### 1. Deferred section attachment when display math is still loading (`src/render/reading-view.ts`)

- Keep the fast synchronous path whenever `mathEls.length > 0` (so already-loaded MathJax and `.print` PDF export continue to attach and apply synchronously).
- When `mathEls.length === 0`:
  - Check whether the section is expected to contain top-level display math before doing any extra work:
    - Either inspect `ctx.getSectionInfo(el)` with `scanMathBlocks(linesOf(info.text), info.lineStart, info.lineEnd)` (`blocks.length > 0`), and/or check for un-nested display-math placeholder elements in `el` (e.g. `.math.math-block` not matched by `isNested`).
  - If top-level display math is pending, register a lightweight `MarkdownRenderChild` (`PendingMathChild`) on `ctx.addChild(...)`:
    - Observe `el` (with a `MutationObserver` on `{ childList: true, subtree: true }`) and/or await `loadMathJax()` from `obsidian`.
    - Once `DISPLAY_MATH` elements appear (or on microtask/animation frame after `loadMathJax()` resolves), disconnect the observer, run the normal `numberEquations` attachment (`EquationNumberChild` + `apply()`), and register those children on `ctx` / `this` so `onunload()` cleans everything up.
    - Always disconnect the `MutationObserver` in `onunload()` so unmounting a section mid-load never leaks observers.

### 2. Avoid eager startup cost (`src/main.ts`)

- Do **not** call `loadMathJax()` in `Plugin.onload()`, so vaults without math notes pay zero startup overhead. Only trigger/await it inside a Reading view section that actually contains display math.

## Order of Work

1. `[x]` Update `src/render/reading-view.ts` to detect pending display-math sections when `DISPLAY_MATH` is not yet present and attach `EquationNumberChild` instances once MathJax finishes rendering into `el` (with clean observer teardown on `onunload()`).
2. `[x]` Add unit tests in `test/core.test.ts` for extracted pure helpers (`src/core/pending-math.ts`), and verify cold-boot Reading view numbering against `feat/e2e-testing`'s E2E suite in a temporary worktree **without** pre-calling `obsidian.loadMathJax()` (confirmed `['(1)', '(2)', '(3)']` appear automatically on both `darwin` desktop and `emulate-mobile`, plus clean teardown on plugin disable; `feat/e2e-testing` left untouched).

## Verification Plan

- `npm run build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`)
- `npm run lint` (`eslint-plugin-obsidianmd` + `manifest.json`)
- `npm test` (Vitest unit tests)
- Real-Obsidian E2E (`desktop` and `emulate-mobile`) verifying cold-boot Reading view numbering on `test-vault/Maxwell.md` without calling `obsidian.loadMathJax()` beforehand, plus plugin disable/unload check confirming no `.eqref-numbered` classes or observers remain.
