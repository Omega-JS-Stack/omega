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
| [assets.js](src/assets.js) | esbuild page modules + main bundle over LAYER ROOTS (boot stubs, `@omega.js/client` → @omega.js/client dir alias, `__main_assets__`/`__theme__` resolution), layered sass (`omega:theme`), page css namespaces, layered `fonts/` → `/assets/fonts` copy, PurgeCSS post-pass |
| [service-worker.js](src/service-worker.js) | `buildServiceWorker()` — esbuild iife bundle of the consumer's `src/service-worker.js` (or the packaged `sw/entry.js`) to dist root `/service-worker.js`; `writeBuildMeta()` — `/build.js` (JSONP config transport for the worker) + `/build.json` (page-side; the client version check reads `timestamp`) |
| [build.js](src/build.js) | `buildSite()` — assets → service worker/meta → static → imagemin → Eleventy → PurgeCSS orchestration with per-phase timings (what `omega build` runs) |
| [imagemin.js](src/imagemin.js) | Responsive image matrix (the UJM imagemin successor): 320/640/1024 + original × source-format + webp @ q80 over `dist/assets/images` (favicon dir exempt), content-addressed cache at the brand `.omega`, `devImageFallback()` dev-server middleware |
| [minify-html.js](src/minify-html.js) | Production HTML minification (UJM minifyHtml successor) — Rust minifier with the legacy extraction dance (JSON-LD minified as JSON, inline scripts esbuild-minified, IE conditionals preserved); engine mounts it as a transform for `environment: 'production'`, .html outputs only |
| [purge.js](src/purge.js) | Cloudflare cache purge (UJM cloudflare-purge successor, de-ITW'd — direct API, brand's own `CLOUDFLARE_TOKEN`): zone from config `cloudflare.zone` or brand-url apex lookup; `omega purge` command, auto after `omega deploy --direct`, CI workflow step when the secret exists |
| [paths.js](src/paths.js) | Packaged content locations (themes/core/defaults/scaffold/runtime) + `resolveClientEntry()` |
| [cli.js](src/cli.js) + [commands/](src/commands) | The `omega` CLI — devkit's shared router (bin/omega → cli.js → commands/<name>.js); dotenv from the consumer root |
| [consumer.js](src/consumer.js) | Consumer layout (`src/`, `dist/`, `.omega/`) + omega.json5 → site data (loadConfig + toSiteGlobal) |
| [scaffold.js](src/scaffold.js) | `scaffoldDefaults()` — devkit defaults engine + the web FILE_MAP over `scaffold/` (marker merges, JSON5 config merge, CI/nvmrc templating) |
| [migrate/](src/migrate) | `runMigration()` — [config-convert.js](src/migrate/config-convert.js) (_config.yml + ultimate-jekyll-manager.json → omega.json5, mapping in [docs/config.md](../../docs/config.md)), [rules.js](src/migrate/rules.js) (the DECISION.md codemod table as pure text transforms), [codemod.js](src/migrate/codemod.js) (src/** walker), [lint.js](src/migrate/lint.js) (liquid-lint — known names derived from the REAL registerLiquid path), [consumer-assets.js](src/migrate/consumer-assets.js) (seed main.js removal, `omega:main` scss rewrite, page-css self-@use drop) |
| [runtime/](runtime) | The BROWSER boot runtime (ESM, bundled into every build): `boot.js` bootMain/bootPage handshake, `manager.js` frontend Manager (omega + mode helpers) |

## Packaged content (the real UJM port, B2)

- `themes/classy/` — the full flagship theme, classy v2 (frontend + backend +
  admin layouts, includes, css, js, vendored webfonts): warm-paper/charcoal
  token-driven skin, zero gradients, ink primaries, serif marketing display
  (Newsreader) over an Inter UI, `.omega-shell` app chrome — see
  [docs/theming.md](../../docs/theming.md);
  `themes/neobrutalism/` and `themes/newsflash/` — partial themes that fall
  back to classy per file; `themes/bootstrap/` — the vendored Bootstrap 5
  scss/js the themes build on (sibling imports); `themes/_template/` — the
  theme-starter skeleton.
- `core/` — the theme-agnostic layer: `_layouts/blueprint/**` (45 page-type
  contracts), `_layouts/core/root.html` (the document shell),
  `_layouts/modules/` (redirect utility), `_includes/` (head/body/foot chrome,
  adsense/promo adunits, price-per-unit pricing math, default
  nav/footer/account + app sidebar/topbar data JSONs), `css/` (main.scss +
  the `--omega-*` token sheet, `.omega-shell` mechanics, the motion library,
  core styles, per-page css), `js/` (the UJM runtime: main module, core
  modules incl. the motion boot, libs, per-page modules), `icons/`.
- `defaults/pages/**` — ~60 default pages at their real URLs (about, pricing,
  contact, auth, legal, payment, portal, team, updates, alternatives, admin,
  test pages) + the blog set: paginated index (`/blog/page/N.html`, size 6),
  category/tag index pages, and per-category/per-tag generator pages
  (pagination over the aggregated taxonomy — replaces dynamic-pages.rb) + the
  site meta-files (sitemap.xml, `/feeds/posts.{xml,json}` RSS + JSON feeds,
  robots.txt, ads.txt, humans.txt, opensearch.xml, the pages.json search
  index, `/.well-known/security.txt`) — default pages like any other, so a
  consumer file at the same URL overrides. JSON outputs are valid by
  construction (`uj_json_escape` + first-emitted-comma pattern); ads.txt
  renders the configured `advertising.providers.google-adsense.client` or an
  honest comment.
- `sw/` — the service worker: `manager.js` (the master-service-worker
  successor — FCM background messaging, notification clicks, the
  `update-cache` command, brand+build-named caches with foreign-cache
  eviction) + `entry.js` (the consumer-less default entry; the scaffold seeds
  `src/service-worker.js` with the same import for custom worker code).

## URL shape — flat `.html`, no trailing slashes (legacy parity)

Pages write **flat files** (`/signin` → `signin.html`, never
`signin/index.html`) and `page.url` is **extensionless with no trailing
slash** (`/signin`) — exactly legacy UJM/Jekyll. Mechanics: the computed
`permalink` appends `.html` to extensionless permalinks (a REAL-extension
whitelist, not `path.extname` — dotted slugs like `/updates/v1.0.0` are page
URLs), an Eleventy `addUrlTransform` strips `.html` back off `page.url`, and
Liquid-carrying permalinks (blog pagination, taxonomy generators) spell their
full shape explicitly. Serving: the dev server's `devCleanUrls` middleware
resolves `/signin` (and a stray `/signin/`) to `signin.html` — the legacy
serve.js contract — and GitHub Pages resolves extensionless paths against
`.html` files natively, so production behaves identically.

## Service worker (dev AND production)

Every build emits `/service-worker.js` + `/build.js` + `/build.json`;
@omega.js/client registers the worker at scope `/` on every page load
(`updateViaCache: 'none'`). Push (FCM background messages) rides it —
`notifications.getToken({ serviceWorkerRegistration })` uses THIS
registration. **Cross-project safety on one localhost port**: registering
replaces whatever worker last claimed the origin (one registration per
scope), the fresh `/build.js` bytes force the update, `skipWaiting` +
`clients.claim` take over immediately, and the worker's boot evicts every
cache not named `<brand>-<cacheBreaker>`. A project that explicitly disables
the SW (`serviceWorker.enabled: false`) gets the origin swept clean instead
(`unregisterAll()`).

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

## Design tokens (C3)

[core/css/tokens/_index.scss](core/css/tokens/_index.scss) is the runtime
contract every theme consumes: `--omega-*` CSS custom properties (color,
radius, motion) defined light-first, redefined at the token level for
`prefers-color-scheme: dark`, and overridden in BOTH directions by the
`data-bs-theme` stamp appearance.js manages. Themes restyle by redefining
tokens — components read `var(--omega-*)`, never hardcoded values. The
sheet emits before the theme in main.scss (themes win at equal
specificity) and is pinned to ZERO sass deprecations — the bar for all
new core css. `brand.color` drives the accent family: the engine derives
a ramp ([src/brand-tokens.js](src/brand-tokens.js) — hover/active shifts,
WCAG-picked on-accent ink, subtle/ring alphas) and head.html emits it
inline AFTER the bundles so the brand wins the cascade. No/invalid color
→ the sheet's neutral placeholder stands. Token VALUES are C3 scaffolding
until Ian's direction notes land; the names + plumbing are the contract.

## Theming — two consumer tiers (C3)

**Tier 1 — restyle the stock theme.** Ship `src/assets/css/main.scss` in the
brand website app: the consumer layer leads the chain, so your entry wins
the layered `main.scss` lookup. Open with `@use 'omega:main' with (…)` — the
self-skipping `omega:` importer resolves to the next layer's entry, core
`@forward`s the active theme's variables (so `with (…)` configures them),
and your own rules land last to win the cascade. This is the migrated form
of UJM's `@use 'ultimate-jekyll-manager' with (…)` customization.

**Tier 2 — ship a full theme.** Put `themes/<id>/` in the brand website app
(own `_theme.scss`, `_layouts/`, `css/`, `js/`) and set `theme.id: "<id>"` —
consumer-local themes beat packaged ones ([resolveThemeLayers](src/layers.js)),
`omega dev` watches them, and anything the theme doesn't cover falls through
to the classy base (until the C3 reskin folds the base layer into core).
Legacy `themes/<id>/…` layout spellings alias for consumer ids too.

## App shell (C3)

[core/css/shell/_index.scss](core/css/shell/_index.scss) is the
skin-independent structure for backend/admin surfaces: regions
(`.omega-shell__sidebar/topbar/main/scrim`, with `__topbar-start/-end`
slots) and states — desktop rail collapse (`data-shell-collapsed`,
persisted under `shell.collapsed`; `.omega-shell__label` text hides in the
rail), mobile drawer below 1200px (`data-shell-open` + scrim, matching
classy's xl cutover), and a `.omega-shell--locked` variant whose main never
scrolls (calendar/studio-style pages). Geometry only — every painted value
is a `var(--omega-*)` token, dimensions are `--omega-shell-*` custom
properties, and motion respects `prefers-reduced-motion`.
[core/js/core/app-shell.js](core/js/core/app-shell.js) drives it
declaratively (`[data-shell-toggle="collapse|drawer"]`,
`[data-shell-dismiss]`, Escape closes the drawer, `aria-expanded` synced)
and exposes `omega.uj().appShell`. The full contract markup is documented
at the top of the sheet; theme layouts emit it (one tree — no duplicated
mobile nav like classy's offcanvas). Because the state attributes are
stamped at runtime, `purgeCss` safelists `/omega-shell/`. Classy keeps its
Bootstrap shell untouched; the D10 skin's layouts adopt this contract.

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

## Responsive images (the imagemin successor)

`omega build` re-encodes every jpg/jpeg/png under `dist/assets/images` into
the legacy UJM matrix — widths 320/640/1024 + the original size, each in the
source format AND webp, quality 80, metadata stripped, upscaling allowed so
every variant name always exists (`hero.jpg` → `hero-320px.jpg`,
`hero-320px.webp`, … `hero.webp` — `@srcset` markup never 404s). The original
NAME survives (re-encoded, so URL contracts hold), svg/gif/webp pass through
verbatim, the minted `favicon/` dir is exempt (exact-name mint contract), and
an undecodable file warns and ships verbatim — never a failed build.
`targets.web.imagemin.enabled: false` opts a brand out.

Outputs are reproducible binaries and NEVER commit: the content-addressed
cache lives at the brand's `.omega/cache/imagemin` (source or settings
changes re-process exactly what changed; stale entries prune every run), and
CI restores it via `actions/cache` in the scaffolded build workflow — the
`cache-uj-imagemin` branch successor. Dev never processes: `omega dev`
middleware rewrites missing `-NNNpx`/`.webp` variant URLs to the verbatim
original, so build-time markup resolves in dev too.

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
handler fetch, GitHub secret publishing, post dedupe) · named css
bundles, full icon set (B-phase pipeline) · engine consumption of
`targets.web.collections`/`defaults`/`generators` (migrate carries the config;
custom collections land with the sweet-saucy wave) · dev-loop re-render
narrowing + browser live-reload on asset rebuilds.
