# PLAN: prevent transient blank reference after programmatic editor restore

> Branch: `fix/blank-ref-after-external-change` (from `main` at `65de4d4`, tag `1.0.2`) · Date: 2026-11-20 · Status: Fix 1 implemented; fix 2 not started (waits on the open question).
>
> The initial build plan for Equation Refs 1.0.0 is finished and shipped; see git history at `65de4d4` for its text.

## Context

In the 2026-11-20 hands-on test report on macOS 14 (Obsidian 1.13.7), `obsidian-equation-refs` 1.0.2 passed Live Preview and Reading view numbering, `\tag{N2}`, `\notag`, same-note `(n)` and cross-note `Equations (1)` reference formatting, aliased links, and live renumbering when removing a link.

One minor issue was reported:
- Right after an Uncommitted plugin **"restore"**, the highlighted line showed `[[#^pyth]]` as **empty text** (`"Pythagoras: ."`) until the cursor moved.

## 1. Transient blank `[[#^id]]` reference in Live Preview after programmatic edit

### Symptom
When another plugin (such as `obsidian-uncommited`'s per-change **Restore**) restores a line containing a same-note equation link `[[#^pyth]]` via `editor.transaction(...)` and scrolls/highlights the line (`leaf.setEphemeralState({ line })`), the line briefly renders as `"Pythagoras: ."` (with `[[#^pyth]]` invisible) until the cursor is moved.

### Cause (verified in `src/render/live-preview/reference-links.ts`, `src/index/equation-numbers.ts`, and `obsidian-uncommited/src/main.ts`)
1. **What Uncommitted's Restore does (`obsidian-uncommited/src/main.ts:340-347`):**
   - Calls `editor.transaction({ changes: [...], selection: { from: editor.offsetToPos(edits[0]!.from) } }, 'better-md-diff.revert')`, followed by `leaf.setEphemeralState({ line })`.
   - The cursor is placed at the start of the restored block (column 0 of `"Pythagoras: [[#^pyth]]."`), **not** inside `[[#^pyth]]`.
2. **What Obsidian's built-in Live Preview link decoration does for `[[#^pyth]]`:**
   - For a same-note block link `[[#^pyth]]` (empty note path before `#^pyth` and no `|alias`), when the cursor is not inside the link token, Obsidian's own Live Preview internal-link widget hides the raw `[[#^pyth]]` syntax and displays the target note path—which is **`""` (empty string)**!
   - Thus, whenever `ReferenceLinksView` (`src/render/live-preview/reference-links.ts:58-85`) does **not** emit a replacement `ReferenceWidget` for `[[#^pyth]]` (while the cursor is outside `[[#^pyth]]`), Obsidian's built-in Live Preview widget collapses `[[#^pyth]]` to empty text (`"Pythagoras: ."`).
3. **Why `ReferenceLinksView.build()` fails to emit a widget right after the restore transaction:**
   - Look at `src/render/live-preview/reference-links.ts:72-77`:
     ```ts
     if (/code|math|comment/.test(tree.resolveInner(start, 1).name)) continue;

     const target = link.path ? metadataCache.getFirstLinkpathDest(link.path, source.path) : source;
     const label = target ? this.plugin.numbers.get(target.path, link.id) : undefined;
     if (!target || !label) continue;
     ```
   - There are two ways `ReferenceLinksView.build()` skips the link right after `editor.transaction(...)`:
     - **Stale `EquationNumbers` cache (`!label`):** While `[[#^pyth]]` (or the `$$ … $$ ^pyth` block) was deleted or modified prior to the restore, `metadataCache.on('changed')` had updated `ReferenceIndex` and `EquationNumbers` and removed `pyth` from `this.labels` (since unreferenced equations are not numbered). When `editor.transaction` restores `[[#^pyth]]` into the CodeMirror buffer, `ReferenceLinksView.update` runs **synchronously** on `update.docChanged`, whereas Obsidian's `metadataCache.on('changed')` does not fire until the editor buffer is flushed and re-indexed (~1–2 seconds later), or not until focus/cursor changes if `setEphemeralState` interfered. During that window, `this.plugin.numbers.get(source.path, "pyth")` returns `undefined`!
     - **Even when `metadataCache.on('changed')` fires:** if the equation and its link were both in the same note or if `sameLabels(prev, next)` in `EquationNumbers.recompute()` (`src/index/equation-numbers.ts:137`) returned `true` (because the equation's number didn't change—for instance, another link to `^pyth` existed, or `recompute` ran before), `this.events.trigger('changed', path)` is **not** called!

### Fix

1. **[x] Done. Synchronous same-note fallback in Live Preview (`src/render/live-preview/reference-links.ts`):**
   - When `link.path === ""` (or `target.path === source.path`) and `this.plugin.numbers.get(source.path, link.id)` returns `undefined`, compute the current note's labels on the fly from `state.doc` using the existing pure helpers (`scanMathBlocks` from `src/core/math-source.ts` + `findBlockLinks` from `src/core/links.ts` + `numberEquations` from `src/core/numbering.ts`), cached per `state.doc` (just like `EquationNumbersView` in `src/render/live-preview/equation-numbers.ts:62-65` already caches `scanMathBlocks` per `state.doc`!).
   - Also do the same live-doc fallback in `EquationNumbersView.read()` (`src/render/live-preview/equation-numbers.ts:75`) when `this.plugin.numbers.get(path, id)` is not yet populated by `metadataCache`.
   - Result: in Live Preview, adding or restoring a same-note `[[#^id]]` link or `$$ … $$ ^id` equation numbers both the equation and the reference **immediately on the same frame**, without waiting for `metadataCache`!

2. **[ ] Not started. Never let an unnumbered same-note `[[#^id]]` collapse to empty text in Live Preview (`src/render/live-preview/reference-links.ts`):**
   - If `link.path === ""` and `label` is still `undefined` (for example, `^id` points to a non-existent equation or an equation with `\notag`), Obsidian's built-in Live Preview widget would render `[[#^id]]` as `""` (invisible!).
   - Emit a fallback `ReferenceWidget` showing `(#^${link.id})` or `[[#^${link.id}]]` (or keep it visible) so a broken/unnumbered same-note block link never disappears into empty text when the cursor leaves the link.

## Tests

- Unit tests in `test/core.test.ts`:
  - [x] Live-document numbering helper given raw note text with `$$ … $$ ^pyth` and `[[#^pyth]]` (`src/core/live-numbering.ts`).
- Known gap: `findBlockLinks` also matches `[[#^x]]` inside code, which the metadata cache ignores. An equation linked only from code is numbered in Live Preview but not in Reading view.
- Manual repro in `test-vault/`:
  1. Open a note in `test-vault/` containing a single equation `^pyth` and a line `Pythagoras: [[#^pyth]].` in Live Preview.
  2. Delete `[[#^pyth]]`, wait 2 seconds for `metadataCache` to unnumber `^pyth`, then restore the change via Uncommitted's **Restore** button (or `Cmd+Z`).
  3. Confirm `Pythagoras: (1).` renders immediately on restore without moving the cursor.

## Order of work

1. [x] `Compute same-note equation labels from the live editor buffer when the metadata cache is behind` (`src/render/live-preview/reference-links.ts`, `src/render/live-preview/equation-numbers.ts`, `test/core.test.ts`).

## Verification

- `npm test`, `npm run lint`, `npm run build`.

## Open questions for the owner

1. When a same-note block link `[[#^foo]]` does **not** point to any numbered equation (e.g. a link to a regular paragraph block `^foo`, or to an equation with `\notag`), Obsidian's own Live Preview renders `[[#^foo]]` as empty text unless aliased. Should Equation Refs leave non-equation `[[#^foo]]` links to Obsidian as it does today (`if (!label) continue`), and only use the live-document `scanMathBlocks` fallback for equations? (Recommended: yes, only touch links whose target is a math block in `scanMathBlocks` or `EquationNumbers`, so non-equation block links are never altered.)
