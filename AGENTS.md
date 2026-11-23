# Agent & Testing Workflow Guide

This repository uses a layered testing setup designed for fast AI-agent iteration locally and cross-platform verification in GitHub Actions.

## Fast Local Loop (run after every edit)

```bash
npm run build         # TypeScript check + esbuild production bundle (main.js)
npm run check:mobile  # Fails if isDesktopOnly: false and main.js requires Node/Electron built-ins
npm run lint          # eslint-plugin-obsidianmd + manifest.json validation
npm run test:unit     # Vitest unit tests (test/**/*.test.ts)
```

## Real-Obsidian E2E Tests (`wdio-obsidian-service`)

E2E tests live in `test/e2e/**/*.e2e.ts` and launch real, sandboxed Obsidian instances against `test-vault`.

```bash
npm run test:e2e:fast    # Desktop latest Obsidian only (fastest E2E check)
npm run test:e2e:mobile  # Desktop emulated mobile (390x844) latest Obsidian only
npm run test:e2e         # Full matrix: earliest/earliest + latest/latest (+ mobile emulation if isDesktopOnly: false)
npm run test:e2e:android # Real Android APK via Appium + AVD named "obsidian_test"
```

### How `manifest.json` Controls Mobile Testing Automatically

Both `wdio.conf.mts`, `scripts/check-mobile-compat.mjs`, and `.github/workflows/e2e.yml` read `manifest.json`:
- **`isDesktopOnly: false`**:
  - `check:mobile` enforces zero Node/Electron imports in `main.js`.
  - `wdio.conf.mts` runs both Desktop and `emulateMobile: true` capabilities.
  - CI runs `ubuntu-latest`, `windows-latest`, `macos-latest`, and `test-android` (Android API 36 emulator).
- **`isDesktopOnly: true`**:
  - `check:mobile` exits cleanly with a skip message.
  - `wdio.conf.mts` runs Desktop capabilities only.
  - CI automatically skips `test-android` while keeping the `check` gate green.

## Rules for Writing E2E Tests

1. **Wait for async rendering**: Obsidian renders Markdown/MathJax asynchronously. Use `browser.waitUntil(...)` instead of fixed sleeps.
2. **Pass arguments into `browser.executeObsidian`**: Functions passed to `browser.executeObsidian(({ app, obsidian }, ...args) => ...)` are serialized across processes. Never capture outer variables in closures; pass them as trailing arguments.
3. **Reset state between mutating tests**: Use `await obsidianPage.resetVault('test-vault')` in `beforeEach` (or before vault-mutating tests).
4. **Keep specs platform-neutral**: Prefer `browser.executeObsidian(...)` + standard DOM assertions so the same spec runs on Linux, macOS, Windows, Mobile Emulation, and Android.

## Reusing This Setup in Another Plugin Repo

Copy these files into another Obsidian plugin repo:
- `scripts/check-mobile-compat.mjs`
- `wdio.conf.mts` & `wdio.mobile.conf.mts` (update `vault:` if your sample vault has a different folder name)
- `vitest.config.ts` (if using Vitest)
- `.github/workflows/e2e.yml` & `.github/workflows/check-new-obsidian.yml`
- `AGENTS.md`

Then install the WDIO devDependencies, add the npm scripts (`check:mobile`, `test:unit`, `test:e2e*`), ignore `.obsidian-cache/` and `obsidian-versions-lock.txt` in `.gitignore` and `eslint.config.mts`, and write plugin-specific specs in `test/e2e/*.e2e.ts`.

## iOS Testing Note

Automated iOS testing is not supported in CI because Obsidian iOS is a closed-source App Store binary. For mobile plugins, combine `check:mobile` + `emulateMobile` + Android CI with manual smoke testing on a physical iOS device via **BRAT** before tagging a final release.
