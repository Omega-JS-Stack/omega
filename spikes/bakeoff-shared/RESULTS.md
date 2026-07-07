# Bake-off scorecard — Eleventy vs Astro (Phase 2 A2)

Weights per the master plan. Each dimension scored 1–5 per candidate; weighted
total decides. **Decision rule: margin < 0.5/5 → Eleventy wins by default**
(migration-cost bias across 49 sites / ~200 custom files).

Baseline to beat: **332 s cold build** (see [BASELINE.md](BASELINE.md)).

## Scorecard

| Dimension | Weight | Eleventy | Astro | Notes |
|-----------|-------:|:--------:|:-----:|-------|
| Cold build @ 1030 posts | 25% | **5.0** | 4.5 | 3.52 s vs 5.31 s (~94× vs ~63× Jekyll) — both crush the 332 s baseline; Eleventy 1.5× faster |
| Incremental rebuild + dev reload | 20% | **4.0** | 3.5 | fast boot + ~2 s full re-render vs 16.5 s boot + instant warm renders; Astro has NO incremental static build and repays the boot on every restart |
| Migration cost per layout | 20% | **5.0** | 2.0 | real-layout ports: 43 mechanical single-line edits (100% codemod-able) vs ~700 lines hand-rewritten; projected: 247 files / ~38.6k lines (see A2 measurement below) |
| uj_* adapter ergonomics | 10% | **5.0** | 3.0 | registerLiquid = zero template changes; direct imports are clean for filters but tags need ctx builders, stringly markup args, and set:html wrappers (JSON-LD-in-JS was nicer, noted) |
| Asset-pipeline integration | 10% | **5.0** | 4.0 | shared pipeline fits both; Astro needs stage+copy (build clears outDir), `ssr.external` for linked CJS, and the SSR-chunk `import.meta.url` trap |
| Long-term risk | 10% | 4.0 | 4.0 | Eleventy: small core team, boring/stable; Astro: big ecosystem + funding, fast-moving majors, features (islands) OMEGA doesn't need |
| Output parity | 5% | **5.0** | 4.5 | 1,279/1,279 corpus pages normalized-identical ACROSS candidates after fixes; Astro's default auto-escaping bit twice (Liquid `{{ }}` never escapes) |
| **Weighted total** | 100% | **4.70** | **3.55** | **margin 1.15 → Eleventy wins outright** (decision rule needed only < 0.5) |

## Raw measurements

### Cold build (corpus, seed 42)

| Candidate | mean | stddev | min | max | runs |
|-----------|-----:|-------:|----:|----:|-----:|
| Jekyll (real somiibo, reference) | 332 s | — | — | — | 1 |
| Eleventy (full: assets+eleventy+purge) | **3.60 s** | 0.025 | 3.58 | 3.64 | 3 (+1 warmup) |
| Astro (full: assets+astro+purge) | **5.56 s** | 0.403 | 5.18 | 6.11 | 3 (+1 warmup) |
| Eleventy — A2 final (post real-layout ports) | **3.52 s** | 0.035 | 3.50 | 3.57 | 3 (+1 warmup) |
| Astro — A2 final (post real-layout ports) | **5.31 s** | 0.176 | 5.17 | 5.56 | 3 (+1 warmup) |

A2 re-validation caught a real hazard: adding the consumer `_includes` dir to
the LiquidJS include roots UNCONDITIONALLY cost **+1.05 s** over the corpus
(3.60 → 4.65 s) because LiquidJS stat-probes every root per include lookup and
the corpus has no consumer `_includes`. Fixed in both engines: roots are
filtered to EXISTING dirs. The per-page `resolved` Liquid pass (layout
frontmatter rendering, copy-on-write) measures ≈ free when no refs remain.

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

### A2 migration-cost measurement (real-layout ports)

Three REAL files from the read-only repos, ported into BOTH candidates against
`fixtures/ports-site/` (each spike's `test/ports.test.js`, mirrored
assertions incl. the full JSON-LD Recipe schema, uj_member vs the real UJM
team doc, and adsense include params):

| Real file | Lines | Eleventy port | Astro port |
|-----------|------:|---------------|------------|
| UJM classy contact layout | 337 | **27 single-line mechanical edits** (26× `page.resolved.`→`resolved.`, 1× interpolated-tag-arg hoist) | **full hand-rewrite** → 300-line .astro (YAML defaults → `export const defaults`, loops → `.map()`, tags → `ujTag` + `set:html`) |
| sweet-saucy recipe layout | 412 | **11 single-line mechanical edits** (canonical ×2, slug, content, assign, include-path ×3, parentloop hoists ×4) | **full hand-rewrite** → 370-line .astro (JSON-LD built as a JS object — genuinely nicer) |
| UJM adsense include (used by recipe) | 65 | **5 edits** (`page.resolved.`→`resolved.`) | **full hand-rewrite** → AdUnit component (42 lines; needed raw-emit `set:html` for attribute parity) |
| somiibo index page (content) | 456 | **0 edits** — verbatim | **0 edits** — verbatim (content stays Liquid) |
| somiibo hero-demo include (content-side) | 77 | **0 edits** — verbatim | **0 edits** — verbatim |
| **Total** | 1,347 | **43 mechanical edits, 0 hand-rewrites** — every edit is a regex-able codemod rule | **~700 lines hand-rewritten** (layout-side files only) |

**Projection census** (all 46 website repos with `src/`, excluding
`_legacy`/`_site`): consumer side = **73 custom layouts (12,233 lines) + 59
custom includes (6,700 lines)**; framework side (UJM default themes, ported
once in Phase B) = **100 layouts (17,506 lines) + 15 includes (2,203 lines)**.
Content that stays Liquid/Markdown in BOTH candidates: **1,016 pages + 11,579
collection docs**. So the Astro bill is a by-hand rewrite of **~247 files /
~38.6k lines**; the Eleventy bill is the same files through a **mechanical
codemod + review** (rule classes below, all proven on the ports).

Codemod rules extracted (the B4 `omega migrate` conversion plan seed — applies
to any consumer):

1. `page.resolved.` → `resolved.` (967 refs across UJM alone).
2. Bracket layout values `themes/[ site.theme.id ]/frontend/<name>` → plain
   layout names (interim alias table already handles `core/base`).
3. `{{ … }}` inside QUOTED tag args → hoist to a `{% capture %}` var. Upstream
   this is a SILENT NO-OP — live somiibo emits `class="fa text- display-4"`
   (production bug found by the port; both candidates fix forward).
4. `forloop.parentloop.*` → hoisted outer-loop `{% assign %}` vars (LiquidJS
   has no `parentloop` — renders empty).
5. Include paths lose the leading slash (`include /modules/…` →
   `include modules/…`) — LiquidJS resolves absolute paths outside roots.
6. `page.<frontmatterKey>` → top-level key; `page.content` → `content`;
   `page.slug` → `page.fileSlug`.
7. `page.canonical.url` → `{{ site.url }}{{ page.url }}` (until the engine
   provides `canonical`).
8. Jekyll `defaults:` per-collection config (layout/permalink assignment)
   needs an engine-level home — B3 design item, doc-level frontmatter interim.

Engine features BOTH candidates needed for the real layouts (— these are
@omegajs/web requirements regardless of winner): team collection for
`uj_member`, consumer `_includes` in the Liquid roots (existing dirs only),
page-scoped frontmatter Liquid (`{{ page.recipe.title }}` in layout meta
defers to a per-page copy-on-write render — the site-scope cache would poison
shared layout data), UTC date filters, deterministic post sort
(date desc, slug tie-break).

### A2 output-parity sweep (candidate vs candidate, full corpus)

After normalization (whitespace collapse, doctype case, hashed asset names,
cachebreak queries): **1,279 / 1,279 pages byte-identical between the two
candidates** (`onlyEleventy: 0, onlyAstro: 0`). Diff classes found and fixed
on the way: Astro post dates dropped Jekyll's `%d` zero-padding; Astro's
default HTML-escaping mangled frontmatter values carrying inline HTML (Liquid
`{{ }}` never escapes — every such render site needs `set:html`, an XSS-policy
decision the migration must audit); same-date posts tie-broke differently
(both engines now sort date desc + slug); taxonomy meta titles + tag `#name`
headings aligned. Lighthouse: not run — both outputs are equivalent static
HTML referencing the same shared asset bundles, so a delta vs Jekyll would
measure content, not the SSG; deferred to B5 `omega verify` per-site gates.

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

**Eleventy wins — 4.70 vs 3.55 (margin 1.15, decision rule needed only
< 0.5).** Full rationale, consequences, and the consumer conversion plan:
[DECISION.md](DECISION.md). Phase B builds `@omegajs/web` on Eleventy 3;
the Astro spike stays in-tree as reference. Everything engine-agnostic
carries forward regardless: template-kit, @omegajs/config, the shared asset
pipeline, the layered-theme model, default-pages-with-suppression, and the
codemod rule list above.
