# Test Framework — Boot Layer

The `boot` test layer runs against the consumer's **actual built `main.bundle.js`** — the real production main entry, loaded exactly as `electron .` loads one. Replaces shell-level `npm start && sleep 12 && kill` smoke tests with deterministic, signal-driven pass/fail.

The build and the boot happen in a **staged app root of their own**, `<project>/.omega/test-app/` (gitignored) — never the project's `dist/`, which belongs to the `npm start` watcher. See [Isolated build output](#isolated-build-output).

## When to use it

| Layer | What it tests | Speed |
|---|---|---|
| `build` | Plain Node — config parsing, util fns, schema validation. | Fast (ms) |
| `main` | @omega.js/desktop lib code in isolation (storage, ipc, tray, etc.) inside Electron. | Fast (~50ms each) |
| `renderer` | Inside a hidden BrowserWindow. | Fast |
| `boot` | The **whole boot integration** — consumer's main.js → manager.initialize → live state | ~1s startup, then fast |

Use `boot` for tests that need to verify **integration** rather than unit behavior:
- "Does the consumer's `src/main.js` actually wire up correctly?"
- "Did all 13 boot steps complete without throwing?"
- "Did config flow from JSON5 → manager.config → tray titles?"
- "Did `src/integrations/{tray,menu,context-menu}/index.js` load?"
- "Is the menu rendered with the expected default ids?"

## Test shape

```js
// test/boot.test.js (consumer-side)
module.exports = {
  type:        'group',
  layer:       'boot',
  description: 'consumer boot smoke',
  timeout:     20000,
  tests: [
    {
      description: 'manager initialized end-to-end',
      inspect: async ({ manager, expect, projectRoot }) => {
        expect(manager._initialized).toBe(true);
        expect(manager.config).toBeTruthy();
      },
    },
    {
      description: 'tray + menu rendered',
      inspect: async ({ manager, expect }) => {
        expect(manager.tray.has('open')).toBe(true);
        expect(manager.menu.isRendered()).toBe(true);
      },
    },
  ],
};
```

The `inspect` function receives:
| Arg | Description |
|---|---|
| `manager` | The fully-initialized live Manager instance — same one your consumer code uses. |
| `expect` | @omega.js/desktop's [Jest-compatible assertion library](../src/test/assert.js). |
| `projectRoot` | Absolute path to the consumer project root (its `src/`, `config/` — and the `dist/` a boot run must never write). |
| `appRoot` | Absolute path to the staged app root Electron booted — `<projectRoot>/.omega/test-app`. Assert on built artifacts here (`<appRoot>/dist/main.bundle.js`), not under `projectRoot`. |
| `frameworkDistRoot` | Absolute path to `<@omega.js/desktop>/dist` — where framework test utilities live. |
| `distSnapshotBefore` | Fingerprint of `<projectRoot>/dist` taken before the test build, for the isolation assertion below. |

## How it works

1. Test runner discovers `test/**/*.js` files with `layer: 'boot'`.
2. Stages `<projectRoot>/.omega/test-app`, builds into its `dist/`, and aggregates each test's `inspect` source body into a JSON spec file.
3. Spawns a real Electron process: `electron <projectRoot>/.omega/test-app` — an app dir with a `package.json` whose `main` is the built bundle, same shape as `npm start`'s `electron .`.
4. Sets three env vars before spawn:
   - `OMEGA_TEST_BOOT=1` — gate
   - `OMEGA_TEST_BOOT_HARNESS=<absolute path to dist/test/harness/boot-entry.js>`
   - `OMEGA_TEST_BOOT_SPEC=<temp file with test definitions>`
5. @omega.js/desktop's `main.js` boots normally; after `manager.initialize()` resolves, detects `OMEGA_TEST_BOOT=1`, reconstitutes each `inspect` from its serialized body string, runs them sequentially, and emits `__EM_TEST__` JSON lines on stdout.
6. Test runner parses results, calls `app.exit()`. **No sleep, no kill.**

## Running

```bash
# All layers including boot
npx omega test

# Boot only
npx omega test --layer boot

# With debug output (shows electron's stderr + harness internals)
OMEGA_TEST_DEBUG=1 npx omega test --layer boot
```

## Isolated build output

`npm start`'s watcher owns `<project>/dist/`. When the boot runner built there too, a dev app and a boot-test run interleaved writes on one tree and either side could load a half-written bundle — a race that presents as a code bug. So the boot build gets its own output (#110).

**The seam** is [src/utils/dist-root.js](../src/utils/dist-root.js): every gulp task resolves its output through it instead of joining `dist/` by hand, and `OMEGA_BUILD_OUTPUT` (absolute, or relative to the project root) redirects the whole build. Nothing else in the build config is duplicated.

**The staged app root** is `<project>/.omega/test-app/`, built by `stageTestApp()` in [src/test/runners/boot.js](../src/test/runners/boot.js):

| Entry | What it is |
|---|---|
| `package.json` | The project's own, verbatim except `main`, pinned at the test build's bundle — so Electron derives the same app name, version and userData path a real boot does. |
| `dist/` | The isolated build output. `<appRoot>/dist/views/*`, `<appRoot>/dist/preload.bundle.js` and the tray icon lookup resolve against it with **no runtime change** — the app root moved, the layout under it did not. |
| `src`, `config` | Symlinks back to the project's. Runtime lookups against `app.getAppPath()` — `src/integrations/{tray,menu,context-menu}/index.js`, the unbundled config fallback — still find the consumer's real files. |

`package.json` and the symlinks are restaged on every run, and the runner clears the staged `dist/` before each build (kept only under `OMEGA_TEST_SKIP_BUILD`). `node_modules` resolution still walks up into the project's. The isolation promise is about `dist/`: a boot run still appends to the project's gitignored `logs/` (the gulp build log and the booted app's runtime log), same as any run.

The regression is covered end-to-end in the real run: the runner fingerprints `<project>/dist` before the build, and [src/test/suites/boot/build-isolation.test.js](../src/test/suites/boot/build-isolation.test.js) re-fingerprints it from inside the booted app and asserts nothing was touched.

## Prerequisites

**The runner always rebuilds the bundle first** (via the same gulp pipeline `npm run build` uses) so tests never see stale code. Adds ~10s to the boot-test run; correctness over speed.

Opt out for CI scenarios where build already ran in a separate step:

```bash
OMEGA_TEST_SKIP_BUILD=1 npx omega test --layer boot
```

Boot then runs against whatever is already in `<project>/.omega/test-app/dist/`. If there is no bundle there, the run **fails loudly** rather than skipping or falling back to the project's `dist/` — an absent test build means the build step that was promised never ran, and booting some other bundle would silently test the wrong code.

## Self-test from the framework repo (the bundled fixture)

Everything above describes a **consumer** running boot tests against their own built bundle. @omega.js/desktop also boot-tests *itself* — the same way BXM verifies "does the extension load?" and UJM verifies "does the site boot?".

When `npx omega test` runs from the @omega.js/desktop repo (the cwd's `package.json` name is `@omega.js/desktop`), two complementary mechanisms engage:

- **`isFrameworkSelfTest`** (in [src/test/runner.js](../src/test/runner.js)) — test discovery includes the framework's own `boot/**` suites. For a real consumer this flag is false and framework `boot/**` suites are **excluded** (they target @omega.js/desktop's fixture, not the consumer's app), so they never run in a consumer's `npx omega test`.
- **`OMEGA_TEST_BOOT_PROJECT`** — [src/commands/test.js](../src/commands/test.js) points the boot runner at the bundled fixture under `src/test/fixtures/consumer-app/` instead of the cwd.

The gate decides *whether* the framework boot suite runs; the env var decides *which project* gets booted. (@omega.js/backend's `OMEGA_TEST_BOOT_PROJECT`, BXM's `OMEGA_TEST_BOOT_PROJECT`, and UJM's `UJ_TEST_BOOT_PROJECT` are the exact analogs.)

### The bundled fixture

`src/test/fixtures/consumer-app/` — a minimal, committed @omega.js/desktop consumer (source only):

- `config/omega.json5` — fake brand (`desktop-fixture`), `releases.enabled: false` (no repo discovery during the build), empty `cloud.config` (no Firebase hang).
- `src/main.js` / `src/preload.js` — the one-line bootstraps a real consumer ships; `main.js` creates the `main` window (`show: false`).
- `src/views/main/index.html` + `src/assets/js/components/main/index.js` + `src/assets/scss/main.scss` — a real view/renderer/theme so webpack + sass run exactly as for a consumer.

**Runtime-only, gitignored** (never committed): before the boot build, the runner symlinks `@omega.js/desktop` (→ the @omega.js/desktop repo root) and `electron` (→ @omega.js/desktop's own copy) into the fixture's `node_modules` — the only two deps resolved by *explicit path* (the gulpfile location, webpack's `require('@omega.js/desktop/main')`, and the runner's electron-binary lookup). Everything else (gulp, webpack, …) resolves via the upward `node_modules` walk because the fixture lives inside the @omega.js/desktop repo. The links are **removed again when the run finishes** — the `@omega.js/desktop` link points back at the repo root, which *contains* the fixture, so a leftover link forms an infinite directory cycle inside `dist/` that crashes the next prepare-package tree walk (`npm run prepare` / `npm publish` → `ENAMETOOLONG`). The fixture `.gitignore` is belt-and-suspenders for crashed runs. See `ensureFixtureDeps()` / `removeFixtureDeps()` in [src/test/runners/boot.js](../src/test/runners/boot.js).

The fixture is then **webpack-built into a real `main.bundle.js`** (under its own `.omega/test-app/dist/`, like any other boot run) and booted — the same production path a consumer's boot test exercises (bundled, not the unbundled lib code the `main` layer covers). The boot smoke lives at [src/test/suites/boot/consumer-app-boots.test.js](../src/test/suites/boot/consumer-app-boots.test.js).

### `OMEGA_TEST_BOOT_PROJECT`

| Env | Purpose |
|---|---|
| `OMEGA_TEST_BOOT_PROJECT` | Root of a project to boot instead of the cwd. Auto-set to `src/test/fixtures/consumer-app` when @omega.js/desktop tests itself; set it explicitly to boot a **real consumer** (e.g. `deployment-playground-desktop`) without `cd`-ing into it. |

### Why this exists

The `build`/`main`/`renderer` layers cover @omega.js/desktop's lib code fast and in isolation. None of them prove the framework still assembles a consumer's `src/main.js` into a webpacked bundle that boots end-to-end. The fixture self-test fills that gap — @omega.js/desktop's analog of "does the extension load?" (BXM) / "does the site boot?" (UJM).

## Limitations

- Tests run sequentially in a single Electron process to amortize startup cost (~1s). State doesn't carry across tests — they all share one `manager` instance.
- `inspect` function bodies are serialized via `Function.prototype.toString` and reconstituted with `new Function(...)`. Closures over the test file's outer scope **don't survive** — only the `inspect` argument bag is available inside.
- We can't simulate user input (clicking the tray, right-clicking, typing). For that, you'd need `nut-js` or similar — out of scope.
