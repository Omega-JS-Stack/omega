# OMEGA Web (@omega.js/web)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/web` — identity, the module map, the command surface, and pointers to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** lives in the shared docs ([../shared/](../shared/)), the web deep references ([sections.md](sections.md), [omega-sections-spec.md](omega-sections-spec.md), [template-kit.md](template-kit.md), [ads-system.md](ads-system.md)), and [README.md](../../packages/web/README.md), which carries the long-form module/feature detail. Write new detail there and cross-link from here — do NOT inline it.

> **Mirrored structure:** the four framework guides — `docs/web/index.md`, `docs/backend/index.md`, `docs/extension/index.md`, and `docs/desktop/index.md` — mirror each other (the legacy UJM/BEM/BXM/EM lineage): shared sections (Supply-Chain Security, Development Workflow, File Conventions, Doc-update parity, etc.) appear in the **same order at the same position** across all four. When adding a section that applies to multiple frameworks, insert it in the same spot in all of them. Each consumer template (`src/defaults/AGENTS.md`; web's lives at `scaffold/AGENTS.md`, beside its one-line `@AGENTS.md` `CLAUDE.md` pointer) mirrors its guide the same way.

## Identity

OMEGA Web (`@omega.js/web`) is the framework for building a brand's marketing site + authenticated frontend. It is the **UJM (Jekyll) successor, rebuilt — not ported**: Eleventy 3 + LiquidJS + [`@omega.js/template-kit`](../../packages/template-kit), with layered themes (zero copying), the section/component library, virtual default pages, the esbuild/sass/PurgeCSS asset pipeline, and an ESM boot runtime that hands every page the `@omega.js/client` singleton. It ships the `omega` CLI for the whole consumer lifecycle (setup → dev → build → test → deploy) plus `omega migrate`, the one-command in-place conversion of a legacy UJM consumer.

**This repository** is the framework itself. **Consumer projects** are a brand's website app: `config/omega.json5` + a consumer-owned `src/`, everything else delivered from the package as layers. Config comes from `@omega.js/config` (shared sections top-level, web settings under `targets.web`).

## Recommended skills

- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.
- **`omega:web`** — the router skill from the omega Claude plugin. The inject hook loads it automatically in any project with `@omega.js/web` (and inside `packages/web` here); it points back to this guide + `docs/` (the SSOT).
- **`omega:seo`** — the search-surface checklist for a page (meta values, the per-type structured-data gates in foot.html, one h1, sitemap/robots, link shape): [agent-plugins/claude/skills/seo/SKILL.md](../../agent-plugins/claude/skills/seo/SKILL.md). The plugin's quality hook fires it on any page, layout, or head/foot-chrome edit.
- **`omega:accessibility`** — the front-end checklist (landmarks and heading order, alt text, control names, token color, focus visibility, reduced motion): [agent-plugins/claude/skills/accessibility/SKILL.md](../../agent-plugins/claude/skills/accessibility/SKILL.md). Same hook fires it on markup, section, and stylesheet edits.

## 🚨 READ @omega.js/client TOO

**`@omega.js/web` ships `@omega.js/client` into every page** (a real runtime dependency, bundled through the boot runtime as a shared chunk so every `import omega from '@omega.js/client'` is the SAME initialized singleton). It powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, the service-worker registration, and utilities. Any task touching auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with `@omega.js/client` as much as with `@omega.js/web`.

**Required reading:** [docs/client/index.md](../client/index.md) and `packages/client/docs/` (Auth, Bindings, Firestore, Notifications, …).

## Quick Start

### For Consuming Projects

1. `npm install @omega.js/web` (in the brand's website app)
2. `npx omega setup` — scaffold/refresh defaults + sync `package.json` scripts (bare `omega` runs `setup`). It announces the seed mode it detected on a `[setup]` line: **standalone app** (the full `config/omega.json5` template + the per-app agent docs land here) or **brand monorepo** (a targets-only config seed; the agent docs live at the brand root). The scaffolded `src/pages/` carries one file — `example.md.txt`, a commented walkthrough of meta-only frontmatter and `{% section %}` composition. The `.txt` suffix keeps it out of the build; copy it to `<name>.md` to start from it
3. `npx omega dev` — Eleventy watch/serve + in-place asset rebuilds. Port 4000 by convention, auto-bumps +1 when taken; `--port=N` or config `ports.website` PINS it. HTTPS by default via mkcert (`--no-https` falls back). Dev pages auto-connect the real Auth/Firestore SDKs to the LOCAL emulators — start them from the brand's backend app (`npx omega emulator`) **before** `omega dev`, because there is no live-Firebase opt-out in dev ([docs/backend/index.md](../backend/index.md)). Without them the site still builds and renders perfectly, and only the data surfaces misbehave — quietly: sign-in and sign-up hang then fail on a connection refused, every Firestore read stays pending so account/subscription state reads as signed-out, and every API request fails the same way (dev resolves the API base to the backend app's local `mgr serve` proxy — `https://localhost:5002` unless a dev port map says otherwise; `?_dev_apiEnvironment=production` is the per-request escape to the live API, and it does nothing for Auth/Firestore, which have no opt-out). A page that "loads fine but nobody can log in" is almost always this. `--local` links every `@omega.js/*` dep from this monorepo first ([docs/shared/local-dev.md](../shared/local-dev.md)).
4. `npx omega build` — production: assets (hashed, `@dev`-only blocks stripped) → Eleventy → PurgeCSS → Firebase auth helpers (`/__/auth/*`) → `dist/`
5. `npx omega test` — PROJECT scope by default (production build + smoke checks + the consumer's `test/`); `framework:`/`omega:`/`web:` run the framework's own suite, `full:` runs both ([docs/shared/testing.md](../shared/testing.md))
6. `npx omega deploy` — THE publish verb: sync, then dispatch the CI build workflow ([docs/shared/deploys.md](../shared/deploys.md))
7. `npx omega migrate` — convert a UJM consumer in place; `--check` reports everything with zero writes

`npx omega-web <cmd>` runs this CLI directly (no dispatch); `omg` and `mgr` are aliases for `omega`.

> **Important:** all `npx omega ...` commands run from the consumer's **app root** (the directory with `package.json` + `config/omega.json5`). `dist/` and `.omega/` are generated — never edit them.

### For Framework Development (This Repository)

> **🚫 NEVER use `npx omega ...` from the framework repo.** `npx omega` is for CONSUMER projects. Here, use the `package.json` scripts.

1. `npm install`
2. `npm run prepare` — build once: `src/` → `dist/` via prepare-package (copy, no transforms), then the devkit `vendor` hook
3. `npm run prepare:watch` (also `npm start`) — watch mode; the root `npm start` runs this for every package at once
4. `npm test` — `node --test test/*.test.js` (engine slice, assets/ESM, CLI/scaffold, migrate, ports, sections, themes, translate, …). Fixtures live in `test/fixtures/`, the shared build harness in `test/lib/build.js`.
5. Exercise real consumers: `apps/omega-playground` (classy) and `apps/newsflash-brand` (newsflash) are the standing in-repo brands; `apps/sandbox-brand` is the synthetic fixture the automated corpus mangles and resets ([docs/shared/brands.md](../shared/brands.md)).

## Architecture

Long-form detail (packaged content, URL shape, service worker, design tokens, theming tiers, app shell, pricing, responsive images, engine facts) lives in [README.md](../../packages/web/README.md). This is the map.

### Module map (`src/`)

| Module | Owns |
|---|---|
| [engine.js](../../packages/web/src/engine.js) | `configureOmega()` — turns an Eleventy instance into the OMEGA engine: Liquid options + template-kit registration, layered layouts, legacy layout aliases, the frontmatter preprocessor, `resolved`/`paginator`/`pageAssets` computed data, site collections, default pages, globals |
| [layers.js](../../packages/web/src/layers.js) / [layouts.js](../../packages/web/src/layouts.js) | First-layer-wins file resolution across the layer chain; layered layout delivery with zero copying (virtual templates in build, a symlink farm in dev) |
| [sections.js](../../packages/web/src/sections.js) | The section/component library: the `{% section %}` / `{% component %}` tags, json5 schemas + defaults, the `{% composition %}` page-body guard, `buildSectionLibrary()`, `collectSectionAssets()` |
| [assets.js](../../packages/web/src/assets.js) | esbuild page modules + main bundle over the layer roots, layered sass (`omega:` importer), page css namespaces, font copy, PurgeCSS post-pass |
| [build.js](../../packages/web/src/build.js) | `buildSite()` — assets → service worker/meta → static → imagemin → Eleventy → PurgeCSS, with per-phase timings (what `omega build` runs) |
| [collections.js](../../packages/web/src/collections.js) | posts / alternatives / team / updates collections + blog taxonomy aggregation |
| [frontmatter-liquid.js](../../packages/web/src/frontmatter-liquid.js) | Liquid inside frontmatter VALUES (cached site-scope renders; page-scoped values defer to a copy-on-write pass) |
| [consumer.js](../../packages/web/src/consumer.js) / [consumer-scan.js](../../packages/web/src/consumer-scan.js) | Consumer layout (`src/`, `dist/`, `.omega/`) + omega.json5 → site data; permalink scan → default-page suppression |
| [pricing.js](../../packages/web/src/pricing.js) / [brand-tokens.js](../../packages/web/src/brand-tokens.js) | `site.pricing` composed from `payment.products`; the accent ramp derived from `brand.color` |
| [imagemin.js](../../packages/web/src/imagemin.js) / [minify-html.js](../../packages/web/src/minify-html.js) / [static-assets.js](../../packages/web/src/static-assets.js) / [strip-dev-blocks.js](../../packages/web/src/strip-dev-blocks.js) / [cachebreak-html.js](../../packages/web/src/cachebreak-html.js) | Production output passes |
| [service-worker.js](../../packages/web/src/service-worker.js) | `buildServiceWorker()` + `writeBuildMeta()` — the build manifest at `/build.js` + `/build.json` (brand, environment, version, theme, package versions, repo, commit, assets, cacheBreaker), which `@omega.js/client`'s version check polls and the `/status` page displays ([#13](https://github.com/Omega-JS-Stack/omega/issues/13)) |
| [firebase-auth-helpers.js](../../packages/web/src/firebase-auth-helpers.js) | Self-hosted `/__/auth/*` helper files (authDomain = the brand host) |
| [translate/](../../packages/web/src/translate) | The AI translation pass over `dist/` with the committed cache ([docs/shared/translation.md](../shared/translation.md)) |
| [purge.js](../../packages/web/src/purge.js) | Cloudflare cache purge (`omega purge`, auto after a direct deploy) |
| [customize.js](../../packages/web/src/customize.js) / [overrides.js](../../packages/web/src/overrides.js) | `omega customize <url>` — materialize a default page into `src/pages/`; the layered override map + single-file materialize (`--list`, `omega customize <path>`), built from the same layer chains the build resolves through |
| [scaffold.js](../../packages/web/src/scaffold.js) | `scaffoldDefaults()` — the devkit defaults engine over `scaffold/` + the web FILE_MAP |
| [migrate/](../../packages/web/src/migrate) | `runMigration()` — config conversion, the codemod rule table over `src/**`, liquid-lint, consumer-asset fixes, legacy-file removal |
| [cli.js](../../packages/web/src/cli.js) + [commands/](../../packages/web/src/commands) | The CLI: `bin/omega` → the devkit `omega-bin` dispatcher → `cli-run.js` → `cli.js` → `commands/<name>.js` (`bin/omega-web` skips the dispatch and runs `cli-run.js` directly) |
| [paths.js](../../packages/web/src/paths.js) | Packaged content locations + `resolveClientEntry()` |

### Packaged content (shipped, not in `src/`)

`themes/` (`classy` — the flagship v2 skin; `newsflash` + `neobrutalism` — partial themes falling back to classy per file; `bootstrap` — the vendored base; `_template` — the theme starter) · `core/` (the theme-agnostic layer: blueprint layouts, the document shell, head/body/foot chrome, the `--omega-*` token sheet, `.omega-shell`, core js) · `defaults/` (~60 default pages at their real URLs, the meta-files, and the dev-only sample content corpus) · `runtime/` (the browser ESM boot: `boot.js` bootMain/bootPage handshake, `manager.js` frontend Manager) · `sw/` (the service worker) · `scaffold/` (what `omega setup` writes).

### Key contracts

- **Layered resolution, everywhere.** Consumer files → active theme → classy → core, first-layer-wins per relative path — for layouts, includes, sections, css, and js. A consumer overrides by owning the same path; everything it does not own keeps flowing from the framework.
- **Sections are the content model.** Pages are compositions of `{% section %}` / `{% component %}` calls; each entry is a folder owning markup + scss + js + json5 schema. Full contract: [docs/web/sections.md](sections.md); design + sequencing: [docs/web/omega-sections-spec.md](omega-sections-spec.md).
- **Consumer page frontmatter is META-ONLY.** The allow-list is `meta`, `schema`, `theme`, `client`, `append`, `sitemap`, `templateEngineOverride`, `eleventyExcludeFromCollections` ([engine.js](../../packages/web/src/engine.js) `PAGE_FRONTMATTER_ALLOW`); plumbing keys (`layout`, `permalink`, `tags`, `pagination`, …) are filtered before the check. Content keys in a page's own frontmatter are STRIPPED from the cascade with a build warning, so sections can never consume them. Collection entries (`_posts`, `_team`, …) and layouts are exempt — their frontmatter IS the document. Pinned by `test/frontmatter-guard.test.js`.
- **Client-runtime configuration is the `client` key** ([#1](https://github.com/Omega-JS-Stack/omega/issues/1) — it configures `@omega.js/client`; it was `web_manager` through the UJM era and there is no dual-read). It reaches the page through the engine's site composition (`cloud.config` and `payment` compose back into `client.*` at build), the core chrome emits it as the Configuration payload from `resolved.client`, and a page or layout may set it in frontmatter with the layout chain merging underneath. Legacy conversion row: [docs/shared/config.md](../shared/config.md).
- **Machine files ship by default.** Every build emits `robots.txt` (with the sitemap pointer), `sitemap.xml`, `feeds/posts.xml` (RSS) + `feeds/posts.json` (JSON Feed), `pages.json` (the search index), `ads.txt` (the configured AdSense publisher, an honest comment when no provider is configured), `llms.txt` ([llmstxt.org](https://llmstxt.org) — brand heading, summary, then pages and posts as markdown links, [#4](https://github.com/Omega-JS-Stack/omega/issues/4)), `humans.txt`, `opensearch.xml`, and `.well-known/security.txt`. All are default pages generated from site metadata and the URL-sorted page collection, honoring the same exclusion convention (test, admin, redirect, draft and sitemap-excluded pages, and the machine files themselves — each meta template carries the walk, kept in step by the tests) — so a consumer file at the same URL suppresses the framework's like any other default page. Titles and descriptions read another page's data through the `omega_rendered` filter ([#141](https://github.com/Omega-JS-Stack/omega/issues/141)): layout-contributed meta (the `/updates/*` pages' `Version {{ page.update.version }}`) holds raw Liquid until the owning page renders it, so a meta file renders it against THAT page's scope instead of emitting the source. Pinned by `test/meta-files.test.js`.
- **Blog search is client-side and self-contained** ([#44](https://github.com/Omega-JS-Stack/omega/issues/44) item 22): the build emits `/blog/index.json` (title, url, capped description, tags, categories, date; no bodies; sitemap-excluded), and the blog index page lazily fetches it on first focus, ranks title hits first, deep-links `?q=`, and binds Cmd/Ctrl+K. The schema `SearchAction` and `opensearch.xml` target `/blog?q={search_term_string}`; no Google CSE anywhere. Pinned by `test/blog-search.test.js`.
- **Theming** is the `--omega-*` token contract: themes redefine tokens, components read `var(--omega-*)`. Two consumer tiers — restyle the stock theme from `src/assets/css/main.scss` (`@use 'omega:main' with (…)`), or ship a full `themes/<id>/`. Full contract: [docs/shared/theming.md](../shared/theming.md); visual spec: [docs/web/classy-v2/DIRECTION.md](classy-v2/DIRECTION.md).
- **The purge pass scans HTML _and_ the built JS.** `purgeCss` ([assets.js](../../packages/web/src/assets.js)) globs `dist/**/*.html` plus `dist/**/*.js`, so classes that exist only inside a client-rendered app's markup strings survive `omega build` with zero config — a consumer never needs a safelist for its own classes (#66). The built-in safelist stays for what no content scan can see: the runtime-stamped `omega-` namespace and Bootstrap's JS-toggled transition classes. A consumer-supplied safelist has no config key yet (it would need a new `targets.web.purgecss` entry in the `@omega.js/config` schema).
- **Charts are the framework's.** `core/js/libs/charts.js` owns Chart.js — a real dependency of this package, never a runtime CDN load (Ian 2026-07-27). Page code imports the helpers (`loadCharts`, `chartSlot`, `chartColors`, `barChart`/`stackedBarChart`/`doughnutChart`/`lineChart`) and never names the library, so its version and delivery stay ours to change. The import inside `loadCharts` is dynamic, so ESM splitting puts Chart.js in its own chunk — a page with no chart pays nothing (`test/dataviz.test.js` builds a charting page and pins it). Colors come off the `--omega-chart-*` ramp; `chartSlot` stamps the series onto the box so `@omega.js/client`'s write-on-change `swap` redraws on data-only changes. **Every page goes through the helper — the admin dashboard included** ([#74](https://github.com/Omega-JS-Stack/omega/issues/74)): it passes `colors: ['var(--omega-ok)', …]` to keep STATUS meaning where the categorical ramp would only say "different". The helper draws with `maintainAspectRatio` off, so a hand-authored canvas needs a height-bearing box (`.admin-chart-box`) exactly like `chartSlot`'s markup. The four builders need a real 2d context, so they are pinned in the browser by the sandbox e2e lane's chart step (`apps/sandbox-brand/e2e/run.js` → `window.__omega.drawCharts()`), which fails on a canvas with no painted pixels.
- **Browser log lines carry the ONE identity tag.** `core/js/libs/logger.js` owns it: `createLogger('<module>')` returns `{ tag, log, info, warn, error, debug }` printing `[@omega.js/web:<module>] message` with NO timestamp (devtools stamps runtime lines; only the build-time devkit logger in `src/` prefixes `[HH:MM:SS]`) — [#12](https://github.com/Omega-JS-Stack/omega/issues/12). No core/js file hand-writes a tag: the module segment comes from the file's identity (`core/auth.js` → `auth`, `pages/dashboard/account/sections/security.js` → `account:security`), and `console.group`/`%c` lines embed `logger.tag` rather than a literal. Web's own file on purpose — `@omega.js/client`'s twin would stamp the wrong package segment. `modules/` imports it RELATIVELY (that lane builds as standalone IIFEs with no layer-alias plugin); everything else goes through `__main_assets__/js/libs/logger.js`. Pinned by `test/logger.test.js` and repo-wide by `scripts/log-tags.test.js`.
- **Icons** are plain `fa-*` markup everywhere, plus `uj_icon` for build-time inlining: [docs/shared/icons.md](../shared/icons.md).
- **Shortlink/redirect pages ride one module.** A page sets `redirect.url` (plus optional `redirect.querystring` forwarding) in frontmatter on the `modules/utilities/redirect` layout; the layout emits `#redirect-config` and the fixed-URL bundle `/assets/js/modules/redirect.bundle.js` performs the hop, forwarding query and fragment. The framework ships shortlink defaults (`/account`, the auth aliases, `/billing`, `/admin/dashboard`) a consumer overrides like any default page. Pinned across `test/assets.test.js`, `test/contract.test.js`, and `test/slice.test.js`.
- **URLs are flat `.html` with no trailing slash** (`/signin` → `signin.html`, `page.url` extensionless) — legacy UJM/Jekyll parity, in dev and on static hosts alike.
- **Nothing generated is committed.** `dist/`, `.omega/` (including the imagemin cache and materialized sample content) are build artifacts; the translation cache is the deliberate exception — it IS committed.

## CLI

`npx omega <command>` (alias `omega-web`; bare `omega` runs `setup`, `help` prints the listing):

| Command | Description |
|---|---|
| `setup` | Scaffold/refresh consumer defaults, merge `config/omega.json5`, sync `package.json` scripts (aliases `-s`, `--setup`) |
| `install` | `i local` links every `@omega.js/*` dep from this monorepo; `i live`/`prod` restores registry specs tree-wide (aliases `-i`, `i`) |
| `dev` | Dev server: Eleventy watch/serve + in-place asset rebuilds, mkcert HTTPS, emulator wiring (aliases `serve`, `start`) |
| `build` | Production build → `dist/` (alias `-b`) |
| `test` | Project scope by default; `framework:`/`omega:`/`web:`/`full:` select the framework suite (alias `-t`) |
| `deploy` | Sync + dispatch the CI build workflow; `--dry-run` prints the POST, `--local` builds only (alias `-d`) |
| `update` | Dependency freshness report; `--apply` installs the safe set, `--major` explicit (aliases `outdated`, `out`) |
| `migrate` | UJM consumer → `@omega.js/web`, in place; `--check` for a zero-write report (alias `migration`) |
| `customize` | Materialize a default page into `src/pages/`; `<path>` materializes ONE shadowable file (section/include/css) at its shadowing path with a provenance header; `--list` prints the layered override map (every shadowable file, its owning layer, your shadows); no argument lists every customizable URL + lane |
| `translate` | Translate `dist/` into `translation.languages` (`omega build` runs it automatically when enabled) |
| `purge` | Cloudflare cache purge (alias `cloudflare-purge`) |
| `clean` | Remove `dist/` + `.omega/` (alias `-c`) |
| `version` | Print the framework version (alias `-v`) |
| `audit` | Explicit not-ported-yet stub — the subsystem rides a later checkpoint |

Alias table: [src/cli.js](../../packages/web/src/cli.js).

## Dependency Resolution

- **`@omega.js/client` owns Firebase on the client side.** Page and module code never imports Firebase directly — `omega.firestore()`, `omega.auth()`. It is a real runtime dependency here, never vendored.
- **`@omega.js/config`, `@omega.js/devkit`, `@omega.js/template-kit` are devDependencies** — private packages vendored into the published tarball by the `vendor` prepare hook. Consumers never install them.
- **Bundler aliases**: `__main_assets__/*` → the core layer / themes dir, `__theme__/*` → the active theme (classy fallback), `@omega.js/client` (subpaths included) → the client package.
- **Anything the framework depends on, a consumer imports bare; anything else it declares itself** ([#2](https://github.com/Omega-JS-Stack/omega/issues/2)). A consumer page module's `import { Chart } from 'chart.js'` resolves from **`@omega.js/web`'s own installation** — the resolve hook in [assets.js](../../packages/web/src/assets.js) reads the framework package.json's `dependencies` at build time (no curated list — the declared set IS the list) and re-resolves matching bare specifiers and their subpaths from the package root. Consequences: the framework's copy wins even when the consumer declares its own (one copy, one shared chunk with core's own users of the library — the charts helper's chart.js, DOMPurify, Popper), and a name the framework does not declare resolves normally from the consumer, failing with esbuild's usual `Could not resolve` when it is missing. Build-time-only dependencies (esbuild, sass, sharp) need no exclusion: resolution happens on demand, so nothing enters a bundle unless browser code imports it by name. No CDN `loadScript()` workaround, and offline apps keep working.

## Development Workflow

- **🚫 NEVER use `npx omega ...` from the framework repo** — it is for CONSUMER projects only. Use `npm test`, `npm run prepare`, etc.
- **🚫 NEVER run a consumer's `omega dev`** — it is the user's long-running dev process. Assume it is running; if it is not, ask the user to start it rather than starting it yourself.
- **Prove changes against a real brand.** `apps/omega-playground` and `apps/newsflash-brand` keep both first-party skins alive; the corpus and cross-stack e2e lanes gate behavior changes ([docs/shared/testing.md](../shared/testing.md)).
- **Live-verify UI changes via CDP.** Use the `chrome-devtools` MCP tools (screenshot, click, evaluate, console) against the running dev server instead of guessing at rendered output.
- **Signing in during dev is URL-only.** `npx omega auth:token <uid-or-email>` (the backend CLI — [docs/backend/index.md](../backend/index.md); emulator by default, `--production` explicit) mints a custom token and prints the sign-in URL; open `/signin?authCustomToken=<token>` (with an optional `&authReturnUrl=…`) and the page signs that user in, then goes to the return URL. `?authSignout=true` is the same lane in reverse. Both params are read ONLY by the auth pages — `/signin`, `/signup`, `/reset` via [session-params.js](../../packages/web/core/js/libs/auth/session-params.js) — so appending them to any other page does nothing.
- **Provider signin in dev runs through the POPUP, never a redirect.** Dev points auth at the emulator, whose OAuth handler hands the credential back through `sessionStorage` on its OWN origin (`http://localhost:9099`); Chrome partitions third-party storage by top-level site, so the SDK's iframe on the site's origin reads an empty partition and `getRedirectResult()` resolves null forever — the return leg dead-ends on `/signin` with nothing to show. [oauth.js](../../packages/web/core/js/libs/auth/oauth.js) picks the popup whenever the client reports development (`?authPopup=true` and iframed pages force it too); production keeps the redirect flow. A redirect that comes home empty is loud, not silent: the page reports it and says so inline.

## Supply-Chain Security

All `npm install` calls in CLI commands (`npx omega i`, `npx omega setup`, the local-linking flows) route through devkit's `safeInstall()` helper (`@omega.js/devkit/safe-install`, invoked by `@omega.js/devkit/local`). It prefixes `sfw` (Socket Firewall) when installed — blocking confirmed malware at the network level before packages reach disk — and falls back to plain npm when sfw is absent. Installs **fail if sfw detects confirmed malware** anywhere in the dependency tree; non-critical CVEs and quality warnings pass through.

## File Conventions

- **CommonJS** in `src/` (prepare-package copies `src/` → `dist/` 1:1, no transforms). **ESM** in `runtime/` and `sw/` — those are browser bundles.
- **`fs-jetpack`** over `fs` / `fs-extra` for file operations.
- One `module.exports = ...` per file; **short-circuit early returns** rather than nested ifs; **logical operators at the start of continuation lines**.
- **No backwards compatibility** unless explicitly requested.
- Every module carries a top-of-file JSDoc block naming what it owns — match it when adding one.
- **Tests are `node --test`**, one file per concern under `test/`, real builds over fixtures — never mock the engine.

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new contract, removed feature), update:

1. **[README.md](../../packages/web/README.md)** — the long-form package reference
2. **`docs/web/index.md`** (this file) — the map, one line or a cross-link
3. **`../shared/<topic>.md`** and the web deep references here in `docs/web/` — the deep reference (sections, theming, testing, deploys, updates, translation, icons, config)
4. **`../../CHANGELOG.md`** — `[Unreleased]`, on ship

Validate first, then document — write docs that describe shipped reality, not intentions.

## Documentation

- [README.md](../../packages/web/README.md) — the package's own long-form reference (module map, packaged content, URL shape, service worker, tokens, theming tiers, app shell, pricing, responsive images, the test-pinned engine facts, and what is not built yet)
- [docs/web/sections.md](sections.md) — the section/component contract · [docs/web/omega-sections-spec.md](omega-sections-spec.md) — the ratified architecture spec
- [docs/shared/theming.md](../shared/theming.md) — the `--omega-*` design-system contract · [docs/web/classy-v2/DIRECTION.md](classy-v2/DIRECTION.md) — the visual spec
- [docs/shared/config.md](../shared/config.md) — omega.json5 shape, merge chain, and the legacy mapping tables `omega migrate` implements
- [docs/test-framework.md](../../packages/web/docs/test-framework.md) — the consumer test guide: the layered doctrine, what `omega test` builds and smoke-checks, the scope grammar, authoring `node --test` suites
- [docs/shared/testing.md](../shared/testing.md) — the verification tiers and which lane gates what
- [docs/shared/deploys.md](../shared/deploys.md) · [docs/shared/updates.md](../shared/updates.md) · [docs/shared/translation.md](../shared/translation.md) · [docs/shared/icons.md](../shared/icons.md) · [docs/web/ads-system.md](ads-system.md)
- [docs/shared/local-dev.md](../shared/local-dev.md) — linking this monorepo into a brand · [docs/shared/brands.md](../shared/brands.md) — which brand is which
- [docs/shared/publishing.md](../shared/publishing.md) — the private-latch policy and the proving checkpoint
