# bakeoff-eleventy — candidate 1 (Eleventy v3 + LiquidJS + template-kit)

The A1 slice built on Eleventy 3 against the shared corpus
([spikes/bakeoff-shared](../bakeoff-shared)). Numbers + checklist live in
[RESULTS.md](../bakeoff-shared/RESULTS.md); this README is the architecture and
the migration findings.

```bash
npm run build   # corpus (if absent) → esbuild+sass → Eleventy → PurgeCSS
npm run dev     # eleventy --serve (farm layouts, watchable)
npm run bench   # cold ×3 (+warmup) + watch-mode incremental touches
npm test        # 17 tests against the shared mini-site fixture
```

## Architecture (`src/omega-web.js` = the engine core)

- **Layered themes, zero copying** — layer chain `active theme → classy → core`;
  the winning `_layouts/**` file per relative path is registered as an Eleventy
  **virtual template** under `_includes/…` (build) or composed as a **symlink
  farm** used as the includes dir (dev — virtual template content is captured at
  config time and is not watchable). Farm lives OUTSIDE the input dir (inside
  it, Eleventy processes the symlinked layouts as content).
- **Includes layering** — LiquidJS `root:` array over the layers' `_includes`
  dirs + `jekyllInclude: true`; template-kit registers via `amendLibrary`.
- **`page.resolved`** — Eleventy's data cascade already deep-merges layout
  frontmatter under page frontmatter; `eleventyComputed.resolved` exposes the
  merged data minus engine machinery. Migration: `page.resolved.` → `resolved.`
  (mechanical; 967 refs in UJM; `layout.*` refs: zero).
- **Frontmatter Liquid** — preprocessor renders `{{ site.* }}` (and legacy
  `[ site.* ]` brackets) in frontmatter VALUES, cached per raw string; skips
  `permalink`/`pagination` (Eleventy renders dynamic permalinks itself) and
  machinery keys (globals/collections hold other templates' raw content).
- **Jekyll conventions** — dated `_posts` filenames → `/blog/<slug>/` via
  computed permalink (`fileSlug` strips the date natively); `/about` →
  `/about/`; collections tagged by input path; blog taxonomy aggregated from
  `post.categories`/`post.tags` into paginated default pages.
- **Default pages** — `defaults/pages/**` registered as virtual templates
  UNLESS the consumer owns the same URL (cheap frontmatter permalink scan).
- **Assets** — 3-layer page modules (site → theme → core) union-resolved,
  esbuild-bundled (`web-manager` aliased to the real `@omegajs/client` —
  bundles clean), content-hashed, manifest-mapped; layouts declare
  `pageModule:` in frontmatter (cascades). Sass layering via the `omega:`
  scheme importer. PurgeCSS post-pass over rendered HTML.

## Migration findings (feed the A2 scorecard + B4 codemod)

1. `page.resolved.` → `resolved.` — one mechanical rewrite.
2. Bracket-layout hack (`themes/[ site.theme.id ]/frontend/core/base`) →
   `addLayoutAlias` table; layout values resolve BEFORE preprocessors, so no
   data transform can handle them. Codemod rewrites them away.
3. `timezoneOffset: 0` in Liquid options — filename dates are UTC midnights;
   local rendering shifts them a day (CI Jekyll renders UTC).
4. Layout frontmatter cascades natively (no `layout.` namespace — zero usage
   anyway); page keys override layout keys deep-merged = frontmatter-only
   override for free.
5. Bare sass `@use 'x'` resolves file-relative BEFORE loadPaths — theme
   layering needs the explicit `omega:` importer scheme.
6. Same-process multi-builds need `setUseTemplateCache(false)` (module-level
   layout cache keyed by inputDir+layout) — tests only; CLI is per-process.
7. `--incremental` doesn't narrow under collection-paginated templates (all
   1,279 files re-render, ~2 s). B-phase optimization, not a blocker.
8. HTTPS dev: native `https: { key, cert }` (mkcert) in the dev server.

## Not in the slice (deliberate)

imagemin, translation, minifyHtml (scored under asset-pipeline integration in
A2 — Eleventy has transform hooks for minify; imagemin is SSG-agnostic),
sitemap/feeds, uj_member with a real team collection (corpus `_team` is empty,
somiibo parity; the tag is template-kit-tested).
