# @omegajs/web

The OMEGA web framework — the UJM (Jekyll) successor, built on **Eleventy 3 +
LiquidJS + [@omegajs/template-kit](../template-kit)** per the Phase 2 bake-off
decision ([spikes/bakeoff-shared/DECISION.md](../../spikes/bakeoff-shared/DECISION.md):
Eleventy 4.70 vs Astro 3.55 weighted). This is the **B1 engine core** promoted
from the winning spike; the CLI (`omega dev/build/...`), the full blueprint
page set, and the remaining themes land in B2–B5.

```bash
npm test    # 22 tests: engine slice (13) + asset pipeline (4) + real-layout ports (5)
```

Corpus-scale benching lives in [spikes/bakeoff-eleventy](../../spikes/bakeoff-eleventy)
(the promoted spike, now a thin harness): full 1,135-document build in ~3.5 s
vs the 332 s somiibo Jekyll baseline.

## Module map (`src/`)

| Module | Owns |
|--------|------|
| [engine.js](src/engine.js) | `configureOmega()` — turns an Eleventy instance into the OMEGA engine: Liquid options + template-kit registration, layered layouts, legacy layout aliases, frontmatter preprocessor, `resolved` computed data, default pages, globals |
| [collections.js](src/collections.js) | posts / alternatives / team collections + blog taxonomy aggregation (deterministic date-desc, slug tie-break order) |
| [layouts.js](src/layouts.js) | Layered layout delivery, zero copying: virtual templates (build) / symlink farm (dev, watchable) |
| [layers.js](src/layers.js) | `collectLayered()` — first-layer-wins file resolution (themes, page modules, default pages) |
| [frontmatter-liquid.js](src/frontmatter-liquid.js) | Frontmatter-value Liquid (cached site-scope renders; page-scoped values defer to a per-page copy-on-write pass) |
| [consumer-scan.js](src/consumer-scan.js) | Consumer permalink scan → default-page suppression |
| [assets.js](src/assets.js) | esbuild page modules (3-layer union, content-hashed manifest, `web-manager` → @omegajs/client alias), layered sass via the `omega:` importer, PurgeCSS post-pass |
| [build.js](src/build.js) | `buildSite()` — assets → Eleventy → PurgeCSS orchestration with per-phase timings (the `omega build` seed) |
| [paths.js](src/paths.js) | Packaged content locations (themes/core/defaults) — engine defaults |

Packaged content: `themes/` (classy + dusk — the A-slice port set, grows to 4
themes in B2), `defaults/` (default pages as virtual templates), `core/`
(icons, base css/js layer).

## Architecture

- **Layered themes, zero copying** — layer chain `active theme → classy →
  core`; the winning `_layouts/**` file per relative path is registered as an
  Eleventy v3 **virtual template** (build) or composed as a **symlink farm**
  used as the includes dir (dev — virtual template content is captured at
  config time and is not watchable).
- **Includes layering** — LiquidJS `root:` array over consumer `_includes`
  first, then the layers' — EXISTING dirs only (a nonexistent root costs
  ~1 s/corpus in per-include stat probes) — with `jekyllInclude: true`.
- **`resolved`** — Eleventy's data cascade already deep-merges layout
  frontmatter under page frontmatter; `eleventyComputed.resolved` exposes the
  merged data minus engine machinery (the `page.resolved` equivalent of
  jekyll-uj-powertools' inject-properties generator). Migration:
  `page.resolved.` → `resolved.`.
- **Frontmatter Liquid** — a preprocessor renders `{{ site.* }}` (and legacy
  `[ site.* ]` brackets) in frontmatter VALUES, cached per raw string.
  Page-referencing values (`{{ page.recipe.title }}`) DEFER there — the
  preprocessor sees the full cascade and layout data objects are SHARED
  across pages — and render per page, copy-on-write, inside `resolved`.
- **Jekyll conventions** — dated `_posts` filenames → `/blog/<slug>/`;
  `/about` → `/about/`; UTC dates (`timezoneOffset: 0`, matches CI-built
  Jekyll); collections tagged by input path; taxonomy aggregated from
  `post.categories`/`post.tags` into paginated default pages.
- **Default pages, no copying** — `defaults/pages/**` registered as virtual
  templates UNLESS the consumer owns the same URL.
- **Assets** — 3-layer page modules (site → theme → core) union-resolved,
  esbuild-bundled, content-hashed, manifest-mapped; sass layering via the
  `omega:` scheme importer; PurgeCSS over rendered HTML.

## Engine facts worth knowing (from the bake-off, test-pinned)

1. LiquidJS has NO `forloop.parentloop` (renders empty) — hoist outer-loop
   values into `{% assign %}` vars (B4 codemod rule).
2. `{{ }}` inside QUOTED tag args is a silent no-op (upstream Jekyll too) —
   `{% capture %}` hoist.
3. Include paths must not lead with `/` (resolves outside LiquidJS roots).
4. Layout values resolve BEFORE preprocessors — legacy bracket layouts are a
   fixed `addLayoutAlias` table, not a data transform.
5. Same-process multi-builds need `setUseTemplateCache(false)` (tests only;
   the CLI is per-process).
6. `--incremental` doesn't narrow under collection-paginated templates (~2 s
   full re-render) — acceptable dev loop; B-phase optimization if it hurts.
7. Foreign cascade objects can carry throwing getters (Eleventy collection
   items' `templateContent` pre-render) — the copy-on-write renderer leaves
   non-plain objects opaque.

The full findings log + scorecard: [RESULTS.md](../../spikes/bakeoff-shared/RESULTS.md),
[DECISION.md](../../spikes/bakeoff-shared/DECISION.md). The B4 `omega migrate`
codemod rules table lives in DECISION.md.

## Not here yet (B2–B5)

Full blueprint page set (~30) + 4 themes (B2) · CLI + FILE_MAP scaffolding +
Ruby-free CI template (B3) · `omega migrate` codemod + liquid-lint (B4) ·
`omega verify` parity harness (B5) · imagemin w/ content-hash cache,
translation, minifyHtml-as-transform, sitemap/feeds (B-phase pipeline).
