# @omegajs/web

The OMEGA web framework — the UJM (Jekyll) successor, built on **Eleventy 3 +
LiquidJS + [@omegajs/template-kit](../template-kit)** per the Phase 2 bake-off
decision ([spikes/bakeoff-shared/DECISION.md](../../spikes/bakeoff-shared/DECISION.md):
Eleventy 4.70 vs Astro 3.55 weighted). B1 promoted the engine core from the
winning spike; **B2 ported the REAL UJM content** — the full blueprint layout
set, 3 Liquid themes + the bootstrap asset layer, ~60 default pages, and the
real core chrome (head/body/foot) — through the B4 codemod rules. **B3 added
the `omega` CLI, consumer scaffolding, the ESM boot runtime, and the Ruby-free
CI template.**

```bash
# In a consumer project (scaffolded scripts call these):
npx omega setup     # scaffold/refresh defaults + sync package.json scripts
npx omega dev       # dev server: Eleventy watch/serve + in-place asset rebuilds (--port=N)
npx omega build     # production: assets (hashed) → Eleventy → PurgeCSS → dist/
npx omega test      # production build + smoke checks + consumer test/ (node --test)
npx omega deploy    # refuse file: deps → npm run build → `npu sync --message='Deploy'`
npx omega clean     # remove dist/ + .omega/
npx omega version   # framework version
# translate / audit: explicit not-ported-yet stubs (subsystems ride later checkpoints)

npm test    # 38 tests: engine slice (13) + assets/ESM (6) + CLI/scaffold (7) + ports (5) + theme contract (7)
```

A bare consumer (`omega setup` in an empty dir, edit brand in
config/omega.json5) builds the full ~56-page default set in under 2 s.

Corpus-scale benching lives in [spikes/bakeoff-eleventy](../../spikes/bakeoff-eleventy)
(the promoted spike, now a thin harness). With the REAL content the corpus
(1,135 docs → 1,397 pages incl. the full default set) builds in ~20 s total —
see the harness README for the honest before/after numbers.

## Module map (`src/`)

| Module | Owns |
|--------|------|
| [engine.js](src/engine.js) | `configureOmega()` — turns an Eleventy instance into the OMEGA engine: Liquid options + template-kit registration, layered layouts, generalized legacy layout aliases, frontmatter preprocessor, `resolved`/`paginator`/`pageAssets` computed data, site collections, default pages, globals |
| [collections.js](src/collections.js) | posts / alternatives / team / updates collections + blog taxonomy aggregation (deterministic date-desc, slug tie-break order) |
| [layouts.js](src/layouts.js) | Layered layout delivery, zero copying: virtual templates (build) / symlink farm (dev, watchable) |
| [layers.js](src/layers.js) | `collectLayered()` — first-layer-wins file resolution (themes, page modules, default pages) |
| [frontmatter-liquid.js](src/frontmatter-liquid.js) | Frontmatter-value Liquid (cached site-scope renders; page-scoped values defer to a per-page copy-on-write pass) |
| [consumer-scan.js](src/consumer-scan.js) | Consumer permalink scan → default-page suppression |
| [assets.js](src/assets.js) | esbuild page modules + main bundle over LAYER ROOTS (boot stubs, `web-manager` → @omegajs/client dir alias, `__main_assets__`/`__theme__` resolution), layered sass (`omega:theme`), page css namespaces, PurgeCSS post-pass |
| [build.js](src/build.js) | `buildSite()` — assets → Eleventy → PurgeCSS orchestration with per-phase timings (what `omega build` runs) |
| [paths.js](src/paths.js) | Packaged content locations (themes/core/defaults/scaffold/runtime) + `resolveClientEntry()` |
| [cli.js](src/cli.js) + [commands/](src/commands) | The `omega` CLI — devkit's shared router (bin/omega → cli.js → commands/<name>.js); dotenv from the consumer root |
| [consumer.js](src/consumer.js) | Consumer layout (`src/`, `dist/`, `.omega/`) + omega.json5 → site data (loadConfig + toSiteGlobal) |
| [scaffold.js](src/scaffold.js) | `scaffoldDefaults()` — devkit defaults engine + the web FILE_MAP over `scaffold/` (marker merges, JSON5 config merge, CI/nvmrc templating) |
| [runtime/](runtime) | The BROWSER boot runtime (ESM, bundled into every build): `boot.js` bootMain/bootPage handshake, `manager.js` frontend Manager (webManager + mode helpers) |

## Packaged content (the real UJM port, B2)

- `themes/classy/` — the full flagship theme (frontend + backend + admin
  layouts, includes, css, js); `themes/neobrutalism/` and `themes/newsflash/`
  — partial themes that fall back to classy per file; `themes/bootstrap/` —
  the vendored Bootstrap 5 scss/js the themes build on (sibling imports);
  `themes/_template/` — the theme-starter skeleton.
- `core/` — the theme-agnostic layer: `_layouts/blueprint/**` (45 page-type
  contracts), `_layouts/core/root.html` (the document shell),
  `_layouts/modules/` (redirect utility), `_includes/` (head/body/foot chrome,
  adsense/promo adunits, resolve-plan pricing math, default nav/footer/account
  data JSONs), `css/` (main.scss + core styles + per-page css), `js/` (the UJM
  runtime: main module, core modules, libs, per-page modules), `icons/`.
- `defaults/pages/**` — ~60 default pages at their real URLs (about, pricing,
  contact, auth, legal, payment, portal, team, updates, alternatives, admin,
  test pages) + the blog set: paginated index (`/blog/page/N.html`, size 6),
  category/tag index pages, and per-category/per-tag generator pages
  (pagination over the aggregated taxonomy — replaces dynamic-pages.rb).

## Architecture

- **Layered layouts** — layer chain `consumer _layouts → active theme →
  classy → core`; the winning `_layouts/**` file per relative path is
  registered as an Eleventy v3 **virtual template** (build) or composed as a
  **symlink farm** (dev). Consumer-local layouts (sweet-saucy's recipe) are
  first-class; consumer `_layouts` is ignored as content (cwd-relative glob —
  `../`-relative input dirs miss bare `**/` globs).
- **Blueprint dispatch, plain names** — `layout: blueprint/pricing` →
  (core) blueprint carries the page-type defaults → `layout:
  frontend/pages/pricing` resolves through the theme layers (active wins,
  classy fills). The legacy bracket idiom (`themes/[ site.theme.id ]/…`) and
  hardcoded `themes/<id>/…` prefixes are ALIASED for every layout in the map
  — migrated content uses plain names, the B4 codemod rewrites the rest.
- **Includes layering** — LiquidJS `root:` array over consumer `_includes`
  first, then theme layers, then core — EXISTING dirs only — with
  `jekyllInclude: true` and `cache: true` (without the parsed-template cache,
  re-parsing the 885-line core chrome per render was the corpus bottleneck).
- **`resolved`** — inject-properties.rb parity: `site config ← layout chain ←
  page data` (the site seed carries brand/theme/analytics/web_manager/…;
  site collections and bulk keys excluded). Frontmatter values that reference
  `page.*` / `resolved.*` render per page, copy-on-write (layout defaults
  template on merged data — classy alternative's hero does this).
- **Jekyll site emulation** — `site.posts/team/updates/alternatives` are real
  arrays synced in place when collections compute (Eleventy captures the site
  object at data-init, so replacement or lazy getters would be invisible);
  `site.data._includes.*` is built from `.json` files in the layered include
  roots (UJM's json-data system: nav/footer/account/sidebar/topbar data);
  `paginator` compat maps Eleventy pagination to Jekyll's shape; `jekyll.
  environment` global.
- **Default pages, no copying** — `defaults/pages/**` registered as virtual
  templates UNLESS the consumer owns the same URL. The 404 lands at literal
  `/404.html` (static hosts need the file).
- **Assets** — every layer root follows one convention (`js/main.js`,
  `js/pages/**`, `css/main.scss`, `css/pages/**`, theme roots add
  `_theme.scss`/`_theme.js`). `__main_assets__/*` resolves to the core layer /
  themes dir, `__theme__/*` to the active theme (classy fallback),
  `web-manager` (subpaths included) to @omegajs/client. Manifest:
  `{ js: { main, pages }, css: { main, pages, themePages } }` — base page css
  and the active theme's page css BOTH load. The engine's `pageAssets`
  computed resolves each page's entries (`asset_path` override honored).
  Dev mode (`omega dev`): stable un-hashed names + no minify, so in-place
  asset rebuilds keep their URLs without an HTML re-render.
- **Boot runtime (ESM + code splitting)** — all bundles come out of ONE
  esbuild call with `splitting: true`, so web-manager and `runtime/boot.js`
  land in a shared chunk the browser evaluates ONCE per page: every
  `import webManager from 'web-manager'` — in the main bundle, a page module,
  anywhere — is the SAME initialized singleton (webpack's single module
  graph, reproduced with `<script type="module">` semantics; both scripts are
  deferred and execute in document order). The handshake: main stub →
  `bootMain(mod)` (webManager.initialize(window.Configuration) → dev lib in
  development → global module), page stub → `bootPage(mod)` (awaits the main
  boot, then `mod({ manager, options })` — the UJM page-module contract,
  with `manager` the frontend Manager wrapper carrying mode helpers).
- **Scaffolding (`omega setup`)** — devkit's defaults engine over
  `scaffold/`: marker-section merges live-sync .gitignore/.env/CLAUDE.md
  (Custom sections preserved verbatim), config/omega.json5 seeds then
  JSON5-defaults-merges (consumer values win), the Ruby-free CI workflow +
  .nvmrc re-template every run, `src/**` is consumer-owned after seeding.
  NO pages are copied — the default set stays virtual. package.json scripts
  sync to the omega commands.

## Engine facts worth knowing (test-pinned)

1. LiquidJS has NO `forloop.parentloop` (renders empty) — hoist outer-loop
   values into `{% assign %}` vars (B4 codemod rule).
2. `{{ }}` inside QUOTED tag args is a silent no-op (upstream Jekyll too) —
   `{% capture %}` hoist.
3. Include paths must not lead with `/` (resolves outside LiquidJS roots).
4. Layout values resolve BEFORE preprocessors — legacy bracket layouts are an
   `addLayoutAlias` table (generalized over the layout map), not a data
   transform. `layout: none` must be dropped entirely (`null` breaks layout
   chains, `none` is a missing-layout error).
5. Same-process multi-builds need `setUseTemplateCache(false)` (tests only;
   the CLI is per-process).
6. `--incremental` doesn't narrow under collection-paginated templates —
   acceptable dev loop; B-phase optimization if it hurts.
7. Foreign cascade objects can carry throwing getters (Eleventy collection
   items' `templateContent` pre-render) — the copy-on-write renderer checks
   `'templateContent' in node` WITHOUT touching the getter (constructing
   those errors per item per page was ~19% of corpus CPU).
8. Eleventy's computed-data dependency pass probes with EMPTY-STRING proxies
   that persist into data — `permalink: ''` must count as absent, or every
   collection doc collides at `/index.html`.
9. Block-tag bodies must render LAZILY: a falsy `{% iftruthy %}` around a
   re-`{% assign %}` would otherwise clobber the outer value (side effects
   run even when output is discarded) — template-kit's adapter probes first,
   renders the body only when the tag asks for it.
10. Eleventy keeps global-data OBJECT REFERENCES but captures the key set at
    data-init: mutate arrays in place (site collections), never reassign.

The full findings log + scorecard: [RESULTS.md](../../spikes/bakeoff-shared/RESULTS.md),
[DECISION.md](../../spikes/bakeoff-shared/DECISION.md). The B4 `omega migrate`
codemod rules table lives in DECISION.md (B2 added: `layout: none` → drop,
`page.<key>` → `resolved.<key>` in template bodies only, `page.canonical.*` →
`site.url`/`page.url` forms).

## Not here yet (B4–B5 + follow-ups)

`omega migrate` codemod + liquid-lint (B4) · `omega verify` parity harness
(B5) · translate/audit subsystem ports (commands exist as explicit
not-ported-yet stubs) · UJM-setup extras (CNAME, firebase auth handler fetch,
GitHub secret publishing, post dedupe) · imagemin w/ content-hash cache,
minifyHtml-as-transform, sitemap/feeds, named css bundles, full icon set,
theme-variable customization via a consumer main.scss (B-phase pipeline) ·
dev-loop re-render narrowing + browser live-reload on asset rebuilds.
