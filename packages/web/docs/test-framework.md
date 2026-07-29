# Test Framework

`npx omega test` in an @omega.js/web app is a **production build + smoke verification, then your own `node --test` suite**. There is no custom runner, no layer harness, and no assertion library of its own — web's tests are plain `node --test` files over REAL builds. The deeper 3-layer framework the sibling frameworks carry (build / page / boot against a real browser) is a later devkit adoption step ([src/commands/test.js](../src/commands/test.js) header).

## 🚫 NEVER mock — test against a real build

Web's test surface is a real Eleventy build over real fixture content. **Do not hand-roll fake engines, fake config objects, or a stubbed `site` global** — build a fixture site and assert on the emitted HTML/CSS/JS, the way the framework's own suite does (`test/lib/build.js` is the shared build harness; fixtures live in `test/fixtures/`).

**Pure functions are the ONLY exception.** A function with zero I/O (a merge helper, a path resolver, a frontmatter validator) can be `require`d and called directly with plain inputs — that is not mocking, there is nothing to mock. The moment the code under test touches the engine, the asset pipeline, or the filesystem, it runs for real.

The ONLY narrow stub allowed is a side effect that would destroy the test run itself (a process-exit, a destructive clean, a CLI command re-entering the runner) — stub that one seam, restore it immediately, comment why.

## Test coverage — every surface gets a test (HARD RULE)

A feature is not done when it works — it's done when every surface it exposes is proven at the LOWEST layer that can prove it ([docs/shared/testing.md](../../../docs/shared/testing.md) — the ratified mantra):

| Coverage | Where | Proves |
|---|---|---|
| **Unit** | a `node --test` file calling the module directly | The function does the right thing with known inputs |
| **Integration** | a `node --test` file that runs a REAL build over a fixture site | The pieces wire together — the page renders, the asset lands, the manifest names it |
| **End-to-end** | the monorepo's corpus / cross-stack lanes | The contract survives across framework boundaries (brand ↔ backend, real browser) |

**Skipping a layer is the exception, not the default.** A layer may be skipped ONLY when the feature genuinely has no surface there — a pure build-time utility has no rendered output; a CSS-token change has no logic to call. Convenience is never a reason: "the unit test already covers it" does NOT excuse the build test — unit tests prove the logic, build tests prove the wiring (a section can come unhooked while every unit test stays green). When in doubt, write the test.

## Running tests

```bash
npx omega test                 # PROJECT scope — production build + smoke checks, then your test/ suite
npx omega test project:        # same, spelled explicitly (`brand:` is an alias)
npx omega test framework:      # ONLY @omega.js/web's own suite (`omega:` / `mgr:` / `web:` are equivalent)
npx omega test full:           # both sources
npx omega test pages           # project scope, filtered to test/pages*
```

**A bare run is PROJECT-only.** The framework corpus is always an explicit choice — a bare `npx omega test` from a brand never drags it in (Ian 2026-07-11, the C5 grammar).

### What project scope actually runs

1. **A production build** — the same code path as `npx omega build` (assets → Eleventy → PurgeCSS → `dist/`, plus translation when configured).
2. **Smoke checks over the output**, all three of which must pass or the command throws `Smoke checks failed`:
   - the build produced at least one HTML page,
   - `dist/404.html` exists (the guaranteed default page — consumers own their home page) **and** contains `data-theme-id`, proving it rendered through the theme root layout,
   - the asset manifest's `js.main` bundle exists on disk in `dist/`.
3. **Your suite** — `node --test` over `test/` at the app root, run only when that directory exists. No `test/` directory means the command ends after the smoke checks.

### What framework scope runs

`node --test test/*.test.js` with cwd set to the resolved `@omega.js/web` package root — the monorepo checkout while the brand is locally linked ([docs/shared/local-dev.md](../../../docs/shared/local-dev.md)). Only top-level `test/*.test.js` files match; `test/fixtures/` and `test/lib/` are support, not suites.

### Flags

The test command takes **no flags of its own** — no `--layer`, no `--filter`, no `--extended`, no `TEST_EXTENDED_MODE`; web has no layer runners and no external-API gate. Flags are forwarded to the build step, so `--cached-only` (skip cold-cache translation pages instead of translating them live) is the one flag that changes a test run.

Scoping is positional only. `--filter` in the desktop/extension guides is a *runner* feature web does not have; filter by path instead (below), or use node's own `--test-name-pattern` by calling `node --test` directly.

### Scope grammar

One grammar across every framework (parser: [`@omega.js/devkit/test/scope`](../../devkit/src/test/scope.js)):

| Target | Runs |
|---|---|
| *(bare)* | project scope only |
| `project:` / `brand:` | project scope only, explicit |
| `framework:` / `omega:` / `mgr:` / `web:` | @omega.js/web's own suite |
| `full:` | both sources |
| `<path>` (bare, no prefix) | project scope, filtered to that path |
| `framework:<path>` / `full:<path>` | the same filter, applied within that source |

- Filters are **path prefixes expanded by the shell**: a project filter becomes `test/<filter>*`, a framework filter becomes `test/<filter>*.test.js`. A filter matching nothing is a hard error, not a silent no-op (the shell hands node the unexpanded literal).
- Unknown prefixes (`framwork:x`) warn — `Unknown test scope prefix ignored` — and are dropped; if every target was invalid, the run falls back to project scope.
- Multiple targets union their sources; each path binds to its own source.
- At a **brand root** (not an app dir) `omega` hands over to `@omega.js/manager`, which fans the same targets out over every app — `web:` routes to the web app only. Table: [docs/shared/testing.md](../../../docs/shared/testing.md#brand-root-cp94b).

## Writing consumer tests

Put plain `node --test` files at your app root under `test/`, one file per concern:

```js
// test/sitemap.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the build emits a sitemap', () => {
  const sitemap = path.join(__dirname, '..', 'dist', 'sitemap.xml');
  assert.ok(fs.existsSync(sitemap), 'dist/sitemap.xml is missing');
});
```

- `npx omega test` runs the production build **before** your suite, so `dist/` is fresh — assert against it directly.
- **Name files `*.test.js`** — the suffix is the discovery signal across every OMEGA package ([docs/shared/testing.md](../../../docs/shared/testing.md)).
- **There is no `_`-prefix exclusion here** — the suffix does that job: the runner executes exactly `test/**/*.test.js`, so helpers and fixtures under `test/` are safe as long as they do not end in `.test.js` (`test/_helper.js`, `test/fixtures/data.js`).
- There is no `test/_init.js` lifecycle hook, no `ctx`/`expect` object, no `OMEGA_TEST_MODE` signal, and no boot harness — those belong to the desktop/extension/backend runners, not web.

## See also

- [docs/shared/testing.md](../../../docs/shared/testing.md) — the layered mantra, the verification tiers, the full C5 grammar, brand-root fan-out
- [docs/web/index.md](../../../docs/web/index.md) — the web framework guide
- [src/commands/test.js](../src/commands/test.js) — the command itself
