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
2. **Smoke checks over the output**, all five of which must pass or the command throws `Smoke checks failed`:
   - the build produced at least one HTML page,
   - `dist/404.html` exists (the guaranteed default page — consumers own their home page) **and** contains `data-theme-id`, proving it rendered through the theme root layout,
   - the asset manifest's `js.main` bundle exists on disk in `dist/`,
   - **every internal link resolves** ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)) — see below,
   - **the four built-output audit checks pass** ([#468](https://github.com/Omega-JS-Stack/omega/issues/468)) — page meta, anchor fragments, image `alt`, sitemap orphans — see below.
3. **Your suite** — `node --test` over `test/` at the target root, run only when that directory exists. No `test/` directory means the command ends after the smoke checks.

### The internal link check

Every `href`/`src` in `dist/**/*.html` must land on something the same build wrote ([src/link-resolver.js](../src/link-resolver.js)). Nothing else in a build reads a link and asks whether the far end exists, so a nav pointing at pages that stopped being generated used to ship green.

Resolution is omega's flat, extensionless URL contract: `/foo` is served by `dist/foo.html` or `dist/foo/index.html`, an asset path is the file itself, a relative value resolves against its emitting page's directory, and a trailing slash is the same page. A mounted project site (a build stamped with a path prefix) is read at its own base path, and a dead link is reported by its SITE url, the form the exception file is written in ([#755](https://github.com/Omega-JS-Stack/omega/issues/755)). A directory is **not** a page — `/blog` needs `blog.html` or `blog/index.html`, never just `dist/blog/`. Anything with a scheme (`https:`, `mailto:`, `tel:`, `data:`, a brand's own app protocol), a protocol-relative host, or a bare `#fragment` leaves the site and is skipped. Code DISPLAY is skipped too ([#521](https://github.com/Omega-JS-Stack/omega/issues/521)): a `<pre>` block prints escaped source, so an `href=` inside it is characters on the page — a docs snippet, or the section gallery's copyable args block — never a link the page emits.

**Exceptions are a last resort, declared per SOURCE PAGE** in `config/link-exceptions.json5` at the target root — no file at all is the state a brand should be in:

```json5
{
  // #488: the tag cloud links a slug the taxonomy page is not emitted at.
  'blog/tags.html': ['/blog/tags/a-and-r'],
}
```

- The key is the dist-relative page emitting the link; the values are the site-absolute URLs it may leave unresolved. **Any other page linking at the same URL still fails**, so a brand page never rides on a declared gap.
- **A declared exception that has started resolving is itself a failure** — an exception standing over a fixed link is a mask over the next regression at that URL, so the list has to shrink when the break is fixed.
- The file is json5 ([#490](https://github.com/Omega-JS-Stack/omega/issues/490)) because an exception has to carry the reason it exists **beside it**, in a comment — a rationale kept in a worksheet somewhere never travels with the list.
- A malformed file is a hard error, never a silently empty map — and a file left at the retired `config/link-exceptions.json` name fails loudly with the rename instead of quietly excusing nothing.

### The built-output audit checks

Four more static scans of the same `dist/`, siblings of the link check in every way — same walk, same exception file, same "a declaration that has started passing is itself a failure" rule ([src/dist-audit.js](../src/dist-audit.js)). They are cheap and programmatic on purpose: the heavy audits (Lighthouse, HTML validation, spelling, page speed) cost minutes per run and stay out of this tier.

| Check | What must hold | Read off the build |
|---|---|---|
| `meta` | every page ships a non-empty `<title>` **and** `<meta name="description">` | `core/head.html` emits both tags on every page, so a `meta.title` that resolved to nothing ships empty and reads as present to any scan that counts tags — this one reads the value |
| `fragments` | every in-site `href="/page#id"` and `href="#id"` lands on an element the target page has | a fragment on a page the build never wrote is skipped: that is a dead LINK, and one break must not read as two |
| `alt` | every `<img>` carries an `alt` attribute | an EMPTY `alt` is the decorative declaration and passes, including the valueless `alt` the minifier collapses it to |
| `sitemap` | every indexable built page is listed in the emitted `sitemap.xml` | there is exactly ONE opt-out, and the check reads it off dist: a `noindex` page (#564 made noindex and sitemap membership one decision, and the engine stamps the flag on drafts, the `/test` dev surface, `/admin/` and redirect stubs too). A page that must stay out of the sitemap while telling crawlers to index it has no such state any more: make it noindex, or declare `sitemap: true` for it in the exception file. No `sitemap.xml` at all turns the check off |

Pages the build **copies** rather than renders are not audited — Firebase's self-hosted OAuth helpers under `/__/` are vendor markup no brand authored or may edit. A mounted project site is read at its own base path, off the `data-omega-path-prefix` stamp its pages carry.

**Exceptions live in the same `config/link-exceptions.json5`**, one list per check, on the page that OWNS the finding:

```json5
{
  // #430: an array is, and stays, the link check's list for that source page.
  'blog/tags.html': ['/blog/tags/a-and-r'],

  'legal/eula.html': {
    meta: ['description'],   // the tokens: 'title', 'description'
    alt: ['/assets/images/seal.png'],   // by src
    sitemap: true,           // `true` = the whole check on this page
  },

  // A fragment hangs off the page carrying the ANCHOR, not the pages linking
  // it: a hash that page routes in JS is right everywhere it is linked, and
  // 190 nav pages must not each declare the same thing.
  'careers.html': { fragments: ['#openings'] },
}
```

- The checks are `links`, `meta`, `fragments`, `alt`, `sitemap`. A name outside that set is a hard error — a typo that read as "no exception" would turn a declaration off silently.
- A list excuses those findings; `true` excuses the whole check on that page, and is stale the moment the page has nothing left to excuse.
- The hashes @omega.js/web's OWN pages route in JavaScript (the account page's `#billing` → `billing-section`, the contact page's `#chat`) cost a brand nothing: the framework declares them, in every language a translated copy is written to.

`@omega.js/web`'s own default pages resolve with **zero exceptions** ([#427](https://github.com/Omega-JS-Stack/omega/issues/427), guarded by the framework suite's `default-page-links` test through the same resolver), so anything the check reports in a brand is the brand's.

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

- Filters are **path prefixes expanded by the shell**: a project filter becomes `test/<filter>*`, a framework filter becomes `test/<filter>*.test.js`.
- A target that names a path and matches NO file is a hard error: the command resolves the selection itself, ahead of the production build, then prints `No test file matches "<target>"` and exits 1 ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)). `node --test` treats a glob that matches nothing as a no-op run, so a typo'd path, or a suite renamed out from under a target, used to run silently green. A run that named no file (bare, or a bare source prefix) still exits 0 when there is nothing to run. Inside a brand-root fan-out the manager sets `OMEGA_TEST_FANOUT=1` on every forwarded run, and the same miss answers with exit 3 instead: a path another target carries is a no-op here, and the brand run fails only when EVERY target missed ([docs/shared/testing.md](../../../docs/shared/testing.md#brand-root-cp94b)).
- Unknown prefixes (`framwork:x`) warn — `Unknown test scope prefix ignored` — and are dropped; if every target was invalid, the run falls back to project scope.
- Multiple targets union their sources; each path binds to its own source.
- At a **brand root** (not a target dir) `omega` hands over to `@omega.js/manager`, which fans the same targets out over every target — `web:` routes to the web target only. Table: [docs/shared/testing.md](../../../docs/shared/testing.md#brand-root-cp94b).

## Writing consumer tests

Put plain `node --test` files at your target root under `test/`, one file per concern:

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
- There is no `test/_init.js` lifecycle hook, no `ctx`/`expect` object, and no boot harness — those belong to the desktop/extension/backend runners, not web.
- **`OMEGA_TEST_MODE` is read, but never set here.** Web's build/CLI surface honors it FIRST — `OMEGA_TEST_MODE=true` resolves `getEnvironment()` to `testing` ahead of every other signal, the context's own `environment` included ([src/mode-helpers.js](../src/mode-helpers.js), #717). The web test lane itself sets nothing, so a bare `npx omega test` leaves the environment to the build's own signals; export the variable yourself when a case needs the testing environment.

## See also

- [docs/shared/testing.md](../../../docs/shared/testing.md) — the layered mantra, the verification tiers, the full C5 grammar, brand-root fan-out
- [docs/web/index.md](../../../docs/web/index.md) — the web framework guide
- [src/commands/test.js](../src/commands/test.js) — the command itself
