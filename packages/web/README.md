# @omega.js/web

The OMEGA web framework — the UJM (Jekyll) successor, built on **Eleventy 3 +
LiquidJS + [@omega.js/template-kit](../template-kit)** per the Phase 2 bake-off
decision ([spikes/bakeoff-shared/DECISION.md](../../spikes/bakeoff-shared/DECISION.md):
Eleventy 4.70 vs Astro 3.55 weighted). B1 promoted the engine core from the
winning spike; **B2 ported the REAL UJM content** — the full blueprint layout
set, 3 Liquid themes + the bootstrap asset layer, ~60 default pages, and the
real core chrome (head/body/foot) — through the B4 codemod rules. **B3 added
the `omega` CLI, consumer scaffolding, the ESM boot runtime, and the Ruby-free
CI template. B4 made the conversion plan executable: `omega migrate` (legacy
configs → omega.json5, the codemod rule table over `src/**`, the liquid-lint
scanner, legacy-file removal) — live-proven on real consumers (somiibo:
migrate → 2,556 pages, ~3.2× the whole Jekyll pipeline).**

```bash
# In a consumer project (scaffolded scripts call these):
npx omega setup     # scaffold/refresh defaults + sync package.json scripts
npx omega dev       # dev server: Eleventy watch/serve + in-place asset rebuilds
                    #   port: website convention 4000, auto-bumps +1 when taken (N7);
                    #   --port=N or config ports.website PINS it (busy = hard error)
                    #   dev pages auto-connect the REAL Auth+Firestore SDKs to the local
                    #   emulators (zero flags; never live Firebase) — start them from the
                    #   brand's backend app: `npx omega emulator`. A live backend's
                    #   resolved (possibly bumped) ports reach the page via the injected
                    #   dev.ports chrome, so the browser always targets THIS brand's stack
                    #   --local: first link every @omega.js dep brand-wide from the local
                    #   Omega monorepo + start its src→dist watch (docs/local-dev.md there)
npx omega build     # production: assets (hashed) → Eleventy → PurgeCSS → dist/
npx omega test      # PROJECT scope: production build + smoke checks + consumer test/
                    #   framework:/omega:/web: = @omega.js/web's own suite; full: = both
                    #   (C5 scoping — docs/testing.md in the Omega repo)
npx omega deploy    # THE publish verb (D13): sync (push triggers nothing) → dispatch
                    #   build.yml so CI builds + publishes; --dry-run prints the exact
                    #   POST, --local builds only (docs/deploys.md in the Omega repo)
npx omega clean     # remove dist/ + .omega/
npx omega version   # framework version
npx omega migrate           # UJM (Jekyll) consumer → @omega.js/web, in place
npx omega migrate --check   # full report (config + codemod preview + lint), zero writes
npx omega translate         # translate dist/ into translation.languages (committed cache;
                            #   `omega build` runs it automatically when enabled — see
                            #   docs/translation.md in the Omega repo)
# audit: explicit not-ported-yet stub (subsystem rides a later checkpoint)

npm test    # engine slice + assets/ESM + CLI/scaffold + migrate + ports + theme contract + translate
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
| [assets.js](src/assets.js) | esbuild page modules + main bundle over LAYER ROOTS (boot stubs, `@omega.js/client` → @omega.js/client dir alias, `__main_assets__`/`__theme__` resolution), layered sass (`omega:theme`), page css namespaces, PurgeCSS post-pass |
| [build.js](src/build.js) | `buildSite()` — assets → Eleventy → PurgeCSS orchestration with per-phase timings (what `omega build` runs) |
| [paths.js](src/paths.js) | Packaged content locations (themes/core/defaults/scaffold/runtime) + `resolveClientEntry()` |
| [cli.js](src/cli.js) + [commands/](src/commands) | The `omega` CLI — devkit's shared router (bin/omega → cli.js → commands/<name>.js); dotenv from the consumer root |
| [consumer.js](src/consumer.js) | Consumer layout (`src/`, `dist/`, `.omega/`) + omega.json5 → site data (loadConfig + toSiteGlobal) |
| [scaffold.js](src/scaffold.js) | `scaffoldDefaults()` — devkit defaults engine + the web FILE_MAP over `scaffold/` (marker merges, JSON5 config merge, CI/nvmrc templating) |
| [migrate/](src/migrate) | `runMigration()` — [config-convert.js](src/migrate/config-convert.js) (_config.yml + ultimate-jekyll-manager.json → omega.json5, mapping in [docs/config.md](../../docs/config.md)), [rules.js](src/migrate/rules.js) (the DECISION.md codemod table as pure text transforms), [codemod.js](src/migrate/codemod.js) (src/** walker), [lint.js](src/migrate/lint.js) (liquid-lint — known names derived from the REAL registerLiquid path), [consumer-assets.js](src/migrate/consumer-assets.js) (seed main.js removal, `omega:main` scss rewrite, page-css self-@use drop) |
| [runtime/](runtime) | The BROWSER boot runtime (ESM, bundled into every build): `boot.js` bootMain/bootPage handshake, `manager.js` frontend Manager (omega + mode helpers) |

## Packaged content (the real UJM port, B2)

- `themes/classy/` — the full flagship theme (frontend + backend + admin
  layouts, includes, css, js); `themes/neobrutalism/` and `themes/newsflash/`
  — partial themes that fall back to classy per file; `themes/bootstrap/` —
  the vendored Bootstrap 5 scss/js the themes build on (sibling imports);
  `themes/_template/` — the theme-starter skeleton.
- `core/` — the theme-agnostic layer: `_layouts/blueprint/**` (45 page-type
  contracts), `_layouts/core/root.html` (the document shell),
  `_layouts/modules/` (redirect utility), `_includes/` (head/body/foot chrome,
  adsense/promo adunits, price-per-unit pricing math, default nav/footer/account
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
  `@omega.js/client` (subpaths included) to @omega.js/client. Manifest:
  `{ js: { main, pages }, css: { main, pages, themePages } }` — base page css
  and the active theme's page css BOTH load. The engine's `pageAssets`
  computed resolves each page's entries (`asset_path` override honored).
  Dev mode (`omega dev`): stable un-hashed names + no minify, so in-place
  asset rebuilds keep their URLs without an HTML re-render.
- **Boot runtime (ESM + code splitting)** — all bundles come out of ONE
  esbuild call with `splitting: true`, so @omega.js/client and `runtime/boot.js`
  land in a shared chunk the browser evaluates ONCE per page: every
  `import omega from '@omega.js/client'` — in the main bundle, a page module,
  anywhere — is the SAME initialized singleton (webpack's single module
  graph, reproduced with `<script type="module">` semantics; both scripts are
  deferred and execute in document order). The handshake: main stub →
  `bootMain(mod)` (omega.initialize(window.Configuration) → dev lib in
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
- **Migration (`omega migrate`)** — one command converts a UJM consumer in
  place: legacy configs → validated omega.json5 (shared sections extracted
  with unified spellings — `analytics.providers.<p>.id`, `cloud.{provider,config}`,
  `payment` at the top level; the `web_manager` client blob + presentation
  sections + build settings under `targets.web`), the codemod rule table over
  `src/**` templates, seed `main.js` removal (the core main + boot runtime
  replace it), the `@use 'omega:main' with (…)` rewrite for theme-variable
  customization (the layered sass importer skips the requesting file, so a
  consumer main.scss configures the layers below it), page-css self-@use
  drops, liquid-lint, and legacy-file removal (Gemfile & co). `--check` runs
  everything in memory. The ENGINE composes the runtime shape back
  (cloud.config → `web_manager.firebase.app.config`, payment →
  `web_manager.payment`, providers → the client's flat analytics) so the
  chrome/client contract is unchanged — one home per value in the config,
  same bridge pattern as the extension framework.

## Pricing from config (C2)

`payment.products` in omega.json5 is the ONLY pricing source. The engine
composes `site.pricing` ([src/pricing.js](src/pricing.js)) — subscription
plans (config order), one-time products (own section, no billing cadence),
billing-toggle availability (both cadences must exist), an HONEST savings
badge (computed from real prices), and the feature-comparison matrix (tiers
inherit earlier plans' features) — and it surfaces as `resolved.pricing` in
every theme's pricing layout. Optional presentation fields per product:
`tagline`, `popular`, `url`, `features [{ id, name, icon, definition,
value }]` (value falls back to `limits[id]`; `-1` renders Unlimited). Free
plan = no prices → anchors to `/signup`. Empty catalog → an explicit
`#pricing-empty` state + an `omega build` warning — never fictional plans.
Consumer page frontmatter still overrides presentation per-page (hero copy,
`faqs`, `social_proof`, `pricing.enterprise`, `pricing.promo`,
`pricing.guarantee`, `pricing.price_per_unit`); the framework ships NO
fictional defaults (the dispersal-era `### ALL PAGES ###` marker convention
is dead — pinned by a contract test).

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
11. Site-wide front-matter defaults: a root directory data file
    (`<srcDir>/<srcDirName>.11tydata.json`) sits ABOVE layout front matter and
    BELOW each page's own front matter — the one-place override for
    layout/blueprint sample content (jekyll-uj-powertools 1.8.1's `defaults:`
    layer; pinned in slice.test.js).

The full findings log + scorecard: [RESULTS.md](../../spikes/bakeoff-shared/RESULTS.md),
[DECISION.md](../../spikes/bakeoff-shared/DECISION.md). The codemod rule
table (DECISION.md) is EXECUTABLE as of B4 — [src/migrate/rules.js](src/migrate/rules.js),
semantically proven in the suite (the capture hoist renders byte-identical to
a literal arg; the parentloop hoist renders the right outer indexes). B4 also
killed two real-data bugs: taxonomy terms now dedupe by slug (somiibo mixes
"Marketing" ×673 / "marketing" ×11 — Jekyll silently last-write-won, Eleventy
hard-errors), and the live somiibo interpolated-icon bug
(`class="fa text- display-4"`) is fixed in the packaged classy layouts (12
latent copies) AND forward in consumer files by the codemod.

## Not here yet (B5 + follow-ups)

`omega verify --against <jekyll-dist>` parity harness (B5 — the per-site
migration gate; the real somiibo URL-set diff, 2,556 vs Jekyll's 2,608 files,
is its first job) · audit subsystem port (command exists as an explicit
not-ported-yet stub — translate shipped in cp96) · UJM-setup extras (CNAME, firebase auth
handler fetch, GitHub secret publishing, post dedupe) · imagemin w/
content-hash cache, minifyHtml-as-transform, sitemap/feeds, named css
bundles, full icon set (B-phase pipeline) · engine consumption of
`targets.web.collections`/`defaults`/`generators` (migrate carries the config;
custom collections land with the sweet-saucy wave) · dev-loop re-render
narrowing + browser live-reload on asset rebuilds.
