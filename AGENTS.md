# Agent & Testing Workflow Guide

## Cross-Platform E2E Testing

### Installation

No global `wdio` installation is required; WebdriverIO and `wdio-obsidian-service` live in `devDependencies`.

```bash
npm ci
```

- The first E2E run automatically downloads and caches Obsidian binaries into `.obsidian-cache/`.
- Optional: set `OBSIDIAN_CACHE_DIR=/path/to/shared-cache` to reuse a single Obsidian binary cache across repositories.
- On headless Linux, run E2E commands under `xvfb-run` (macOS and Windows run directly).
- Mobile layout emulation runs via `npm run test:e2e:mobile` (no Android SDK needed).
- Real Android E2E (`npm run test:e2e:android`) requires Android Studio with an AVD named `obsidian_test`.

### Testing SOP

1. **On every change** (in `test/e2e/` and `src/`):
```bash
npm run build
npm run check:mobile
npm run lint
npm run test:unit
npm run test:e2e:fast    # Desktop latest Obsidian against test-vault/
npm run test:e2e:mobile  # Emulated mobile UI (390x844, latest Obsidian)
```
2. **Before PR or release**:
   - Run `npm run test:e2e` (tests `earliest/earliest` + `latest/latest` Obsidian versions) or push to run `.github/workflows/e2e.yml` (Linux/Windows/macOS desktop, mobile emulation, and Android API 36).
- Before tagging a release, smoke-test iOS manually via BRAT (CI does not emulate iOS).

## E2E Spec Rules

- Wait for async Markdown/MathJax rendering with `browser.waitUntil(...)` rather than fixed sleeps.
- Pass arguments into `browser.executeObsidian(({ app, obsidian }, ...args) => ...)` as trailing parameters; functions are serialized across processes.
- Reset vault state between mutating tests via `await obsidianPage.resetVault('test-vault')`.
