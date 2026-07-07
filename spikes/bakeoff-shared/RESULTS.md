# Bake-off scorecard — Eleventy vs Astro (Phase 2 A2)

Weights per the master plan. Each dimension scored 1–5 per candidate; weighted
total decides. **Decision rule: margin < 0.5/5 → Eleventy wins by default**
(migration-cost bias across 49 sites / ~200 custom files).

Baseline to beat: **332 s cold build** (see [BASELINE.md](BASELINE.md)).

## Scorecard

| Dimension | Weight | Eleventy | Astro | Notes |
|-----------|-------:|:--------:|:-----:|-------|
| Cold build @ 1030 posts | 25% | — | — | corpus cold build, `bench.js --runs=3 --warmup=1` |
| Incremental rebuild + dev reload | 20% | — | — | touch 1 post / 1 layout / 1 data file |
| Migration cost per layout | 20% | — | — | port 3 real layouts: classy contact, sweet-saucy recipe, somiibo index (stopwatch, projected across ~200 custom files) |
| uj_* adapter ergonomics | 10% | — | — | registerLiquid() vs direct helper imports |
| Asset-pipeline integration | 10% | — | — | esbuild + sass + PurgeCSS + imagemin fit |
| Long-term risk | 10% | — | — | maintenance, ecosystem, bus factor |
| Output parity | 5% | — | — | DOM diff + Lighthouse vs Jekyll output |
| **Weighted total** | 100% | — | — | |

## Raw measurements

### Cold build (corpus, seed 42)

| Candidate | mean | stddev | min | max | runs |
|-----------|-----:|-------:|----:|----:|-----:|
| Jekyll (real somiibo, reference) | 332 s | — | — | — | 1 |
| Eleventy (full: assets+eleventy+purge) | **3.60 s** | 0.025 | 3.58 | 3.64 | 3 (+1 warmup) |
| Astro (full: assets+astro+purge) | **5.56 s** | 0.403 | 5.18 | 6.11 | 3 (+1 warmup) |

Eleventy phase split (single run): assets (esbuild+sass) 0.60 s, Eleventy 2.64 s,
PurgeCSS 0.42 s → 1,279 HTML files (1030 posts + 105 pages + 20 alternatives +
103 blog-index pages + 18 taxonomy pages + 3 defaults). ~92× the Jekyll baseline.
2026-07-06, same M1 Max as BASELINE.md, Node v24.15.0, Eleventy 3.1.6.

Astro phase split (single run): assets 0.15 s, Astro 4.60 s, PurgeCSS 0.36 s →
**1,279 HTML files, URL set IDENTICAL to the Eleventy build** (verified by
find-diff). ~60× the Jekyll baseline, ~1.5× the Eleventy time. Wiping Astro's
persistent content store (`.astro/`) makes no material difference (5.11 s);
the very first build after `npm install` ran ~17 s (cold fs caches — one-time,
not an Astro property). Same machine/date, Astro 5.18.2.

### Incremental rebuild (watch mode, `--incremental`, farm layouts)

| Candidate | initial | 1 post touched | 1 layout touched | 1 include touched |
|-----------|--------:|---------------:|-----------------:|------------------:|
| Eleventy | 2.51 s | 1.95 s | 2.04 s | 1.89 s |
| Astro (dev, on-demand) | 16.49 s | 1.02 s | 1.29 s | 0.68 s |

Eleventy caveat: `--incremental` does NOT narrow here — every touch re-renders
all 1,279 files (the collection-paginated templates make everything depend on
the posts collection). Full re-render at ~2 s makes dev reload fine anyway;
narrowing is a B-phase optimization (dependency hints). Data-file note: the
site global is read at config time (like `_config.yml`) — changing it means a
dev-server restart; there is no corpus `_data/` to hot-touch.

Astro semantics differ: there is NO incremental static rebuild — a "rebuild"
is the full ~5.6 s build. The dev server renders ON DEMAND: boot is slow
(~16.5 s over this corpus — content sync + warmup), then pages render
near-instantly (<50 ms warm) and a touch re-renders just the requested page
(numbers above = timed request of one post after each touch). Slow boot /
instant navigation vs Eleventy's fast boot / ~2 s-per-change full re-render.

### A1 slice checklist (both candidates must build the identical slice)

| Item | Eleventy | Astro |
|------|:--------:|:-----:|
| Base layout chain | ✅ | ✅ .astro slot chain (3-deep: package → solution → base) |
| blueprint/index + pricing (incl. resolve-plan math) | ✅ | ✅ math as plain JS in plan-card component |
| Auth signin/signup (FormManager + web-manager boot) | ✅ real @omegajs/client bundled via `web-manager` esbuild alias | ✅ same (shared asset pipeline) |
| Blog with pagination + taxonomy | ✅ | ✅ injected routes (integration) over content collections |
| 404 | ✅ | ✅ reserved `src/pages/404.astro` |
| One frontmatter-only override page (consumer data over layout defaults) | ✅ native data cascade | ✅ `computeResolved()` deep-merge over exported layout defaults |
| TWO themes, layered resolution, zero file copying | ✅ virtual templates (build) + symlink farm (dev, watchable) | ✅ `omega:` Vite resolver (cross-layer imports) + `import.meta.glob` dispatch |
| 3-layer page-module JS/CSS via esbuild manifest | ✅ | ✅ same (shared asset pipeline) |
| `page.resolved` equivalent | ✅ cascade + `eleventyComputed.resolved`; migration = `page.resolved.` → `resolved.` (967 refs in UJM, one mechanical rewrite; `layout.*` refs: zero) | ✅ but layout frontmatter defaults must be REWRITTEN as `export const defaults` + manual chain merge — part of the full Liquid→.astro layout port |
| Frontmatter-value Liquid rendering (cached) | ✅ preprocessor + per-string cache | ✅ same shared resolver, applied per entry at render |
| sass loadPaths + PurgeCSS | ✅ `omega:` scheme importer (bare `@use` resolves file-relative before loadPaths — layering needs the scheme) | ✅ same (shared asset pipeline) |
| HTTPS dev-server story decided | ✅ native: `@11ty/eleventy-dev-server` `https: { key, cert }` (+ http/2) with mkcert — no BrowserSync proxy | ✅ native: Vite `server.https` (mkcert) — no proxy |

Eleventy spike: `spikes/bakeoff-eleventy` (17/17 tests). Migration findings
logged in its README: bracket-layout hack → `addLayoutAlias` table (layout
values resolve before preprocessors); `timezoneOffset: 0` for CI-parity dates;
Eleventy layout data cascades natively (no `layout.` namespace).

Astro spike: `spikes/bakeoff-astro` (13/13 tests; the 4 asset-pipeline tests
live in the eleventy spike against the SHARED pipeline). Migration findings in
its README — the headline one: every layout/include ports from Liquid to
.astro by hand (~200 custom files across 49 sites), while CONTENT stays
Liquid and still requires the full liquidjs + template-kit pipeline at build.
Test-harness note: each Astro test build is a real `astro build` (suite ~25 s)
vs Eleventy's in-process toJSON (suite ~1 s).

## Decision

_Pending A1 + A2._
