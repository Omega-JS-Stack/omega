# OMEGA Ecosystem Redesign & Optimization Plan

> **Canonical home of the master plan** (vendored 2026-07-09 from the plan-mode original at `~/.claude/plans/i-need-you-to-jiggly-salamander.md`, which now just points here).
> **Live execution state:** [PROGRESS.md](../PROGRESS.md) — status board, queue, standing rules. Shipped detail: [CHANGELOG.md](../CHANGELOG.md). Companion exploration data: [omega-redesign-config-dedup-audit.md](omega-redesign-config-dedup-audit.md).
> **Amendments since approval:** (1) dual-read/dual-write backwards compat CANCELLED (Ian, 2026-07-06) — frameworks flip to omega.json5 outright, implement + document the new way only; (2) the `@omega.js/manager` engine port (Phase-5 slot below) was pulled forward — checkpoints 33–60 drained omega-manager's full service order into `packages/manager` plus onboarding/prompting/config-writeback/flows; see PROGRESS.md Done list; (3) **core-changes window (Ian, 2026-07-10 — binding spec: [omega-core-changes-inbox.md](omega-core-changes-inbox.md), DECIDED 10/10)**: scope is `@omega.js` (`@omegajs` was unavailable; npm org `omega.js` + GH org `Omega-JS-Stack` claimed by Ian, names final), `omega`/`omg` bins everywhere with `mgr` kept as alias, `window.webManager` → `window.omega`, wire names `/omega` + `omega_*` + config key `omega` + env `OMEGA_*`, zod route schemas (shapes preserved), pricing read from omega.json5 (frontmatter dispersal dies), virtual default pages (no eject command — same-URL file takes over), config stays git-SSOT but designed for hosted-company + layperson-CMS clients with CLI/CMS/HTTP build triggers and GH-releases artifacts, theme system redesigned CROSS-TARGET (universal `theme.id`), brand-root `assets/` scaffolded + continuously manager-derived, `apps/` folder name confirmed; pre-dogfood N1–N7 queue in PROGRESS.md; continuous-iteration mode on; breaking changes to existing DATA (users/{uid}, orders) or route semantics require Ian's explicit OK.

## Context

The OMEGA ecosystem — UJM (Jekyll frontend), BEM (Firebase backend), BXM (extensions), EM (desktop), MAM (mobile), web-manager (shared frontend singleton), omega-manager (orchestrator, this repo) — has grown organically. Ian's goals:

1. **Kill Jekyll** — even simple sites build slowly; somiibo-website (105 pages + 1031 posts) is painful. Replace with a speed-optimized Node toolchain.
2. **Unify config** — same file, same fields, same format in every project type (today: YAML `_config.yml` + 4 differently-shaped JSON files with `google_analytics` vs `analytics.providers.google` style drift).
3. **Deduplicate cross-cutting concerns** — ads, FormManager, themes, the user/account schema (defined separately in BEM and web-manager), gulp tasks (50–70% copy-pasted across 4 frameworks), CLI routers (5×), defaults scaffolding (4×).
4. **Rebrand to scoped npm packages** under a monorepo.
5. **Preserve the crown jewels**: the instant default-pages system (~30 working pages per new site, overridable via frontmatter-only files), the frontend↔backend auth/subscription contract, omega-manager's disperse/update orchestration.

## Decisions made (confirmed with Ian)

| Decision | Choice |
|---|---|
| SSG engine | **Eleventy vs Astro bake-off** before committing (leaning Eleventy) |
| Config | Single **`config/omega.json5`**, identical shape everywhere; omega-manager disperses shared sections |
| npm scope | **`@omega.js`** (`@omega` is confirmed taken on npm — owned by `piglovesyou` since 2022) |
| Repo layout | **Monorepo** at `/Users/ian/Developer/Repositories/Omega` (npm workspaces) for framework + shared packages; existing repos READ-ONLY, code **plain-copied in** (no subtree/history import — originals are the history) |
| Brand repos | **Brand monorepos from day one** for the new system: the GitHub template creates one brand monorepo (apps/website + apps/backend + …, multiples per type supported). Existing brands consolidate per-brand at their Phase-4 migration moment, gated individually |
| Shared packages | **Internal by default**: private workspace packages, bundled into the published frameworks at prepare time (esbuild via prepare-package). Published packages = the 5 frameworks + @omega.js/manager only; flip a shared package public only when an external consumer appears |
| Manager | **@omega.js/manager becomes a real published product**: the onboarding + orchestration engine (today's omega-manager brains) with a **COMPANY → BRAND → APPS hierarchy**. Ian's omega-manager repo stays private as his company instance (holds `.brands/` data), eventually consuming @omega.js/manager |
| `targets` key | **Unified**: in omega.json5, `targets` is an object whose KEYS are the brand's enabled targets (absorbing the brand-config array's role — presence = enabled) and whose VALUES are type-wide config. Legacy array stays in omega-manager brand configs until Phase-5 cleanup (bridged by TARGET_SECTION_MAP) |
| MAM | **Parked — out of scope.** Needs a complete overhaul separately; NOT copied into the monorepo, no @omega.js/mobile build, no MAM work in any phase. Design reserves its slot (`targets.mobile` schema section + future `packages/mobile`) so the overhaul drops in later |

## Key exploration findings (full details: [omega-redesign-config-dedup-audit.md](omega-redesign-config-dedup-audit.md))

- **49 consumer websites** (not ~30), from 1 page to 1031 posts; custom-layout hotspots: soundgrail (29 custom files), sweet-saucy (22 + local `recipe` theme + custom collections), somiibo (9). Most sites: 0–4 custom files → frontmatter-only pages migrate near-zero-change.
- **Jekyll slowness causes**: Ruby/bundler cold start, single-threaded Liquid over 1000+ posts, jekyll-uj-powertools per-page gem cost, PurgeCSS over every output page, full-tree copies (defaults/distribute) before Jekyll re-renders everything, sequential gulp chain.
- **jekyll-uj-powertools is more than filters/tags**: generators (`inject-properties.rb` = the `page.resolved` deep-merge, `blog-taxonomy.rb`, `dynamic-pages.rb`, `limit-collections.rb`), hooks, and `variable_resolver.rb` (renders `{{ site.* }}` inside frontmatter values). All need mapped homes.
- **User schema duplicated + drifted**: BEM `src/manager/helpers/user.js:18-179` (declarative schema engine: `$passthrough`/`$template`/`$timestamp`/`$uuid` tokens) vs WM hard-coded `DEFAULT_ACCOUNT` in `web-manager/src/modules/auth.js`. `resolveSubscription()` duplicated (verified: BEM's returns `everPaid`, WM's doesn't — live drift). Third orphan schema in `resolve-account` repo, used by nobody.
- **Config fragmentation**: ~60% conceptual overlap across the 5 config files; spelling drift (`google_analytics.id` vs `analytics.providers.google.id`; `app.bundleIdentifier` vs `app.appId`); secrets placement inconsistent (some configs hold secrets, some use `.env`).
- **Build/tooling duplication**: gulp tasks near-copied across UJM(26)/BXM(18)/EM(12)/MAM(8 task files); FILE_MAP defaults-scaffolding ×4; yargs CLI router ×5; bootstrap/classy themes copy-pasted in BXM + EM.
- **omega-manager already has the SSOT plumbing**: `UNIFIED_KEYS` (config.js), disperse service (`src/services/disperse/disperse-config.js`) mapping brand|config|state|env|secrets|ai → per-target files, update service with per-repo `.nvmrc` Node resolution. The dispersal *targets* are fragmented, not the source. Verified: `mgr setup` syncs `projectScripts` into consumers (BXM `src/commands/setup.js:177`), so npm renames auto-heal consumer scripts.
- All repos use plain npm (no pnpm), CommonJS frameworks, ESM omega-manager. Node: BEM/BXM/UJM 22, EM 24.

---

# Target architecture

## 0. The product vision (Ian's north star — design for it from day one)

**"Use this template" → working brand.** A public GitHub template repo, powered by `@omega.js/manager`, onboards the user exactly like today's omega onboarding (pick targets: website / backend / extension / desktop / mobile) and scaffolds a **brand monorepo**:

```
{brand}/                          # created from the GitHub template
├── package.json                  # workspaces: ["apps/*"] — `npm start` boots the whole brand,
│                                 # `npm test` runs brand-wide cross-stack e2e
├── config/omega.json5            # BRAND-level shared config (brand, firebaseConfig, payment, …)
└── apps/
    ├── website/                  # @omega.js/web consumer   (multiple allowed: website-docs, …)
    │   └── config/omega.json5    # target section + any-key overrides of brand config
    ├── backend/                  # @omega.js/backend consumer
    └── extension/ desktop/ mobile/ …
```

- **Config hierarchy extends naturally**: `framework defaults ← company ← brand ← app overrides` — the same agnostic any-key deep-merge at every level.
- **Nestable — COMPANY above BRAND**: the same library manages a company workspace that creates/updates/orchestrates MANY brand repos (Ian's ITW Creative Works case = today's omega-manager role). One engine, two modes: standalone brand, or company-of-brands.
- **Framework dev from a brand is one command**: working in a brand and needing a framework change auto-links the local Omega monorepo (file: installs of every framework present + watch mode) — no per-framework VSCode windows or manual `mgr i local` choreography.
- **Fresh consumers only for testing**: the sandbox brand in the Omega repo is created from scratch through the template/onboarding path itself (nothing copied from existing brands) — so onboarding is continuously dogfooded.

The full template + onboarding product ships late in the program (after frameworks stabilize), but the **brand-monorepo format, config hierarchy, and auto-linking are designed in from Phase 1** — the sandbox consumer uses them from the start.

## 1. Monorepo: `/Users/ian/Developer/Repositories/Omega` (GitHub: `ITW-Creative-Works/omega`)

**HARD CONSTRAINT (Ian):** the existing repos — omega-manager, backend-manager, ultimate-jekyll-manager, browser-extension-manager, electron-manager, mobile-app-manager, web-manager, jekyll-uj-powertools, and ALL consumer repos — are **READ-ONLY** during Phases 0–2. All redesign work happens in the new `Omega` monorepo. Code is **plain-copied** into `packages/*` (no git subtree, no history import — the untouched originals ARE the history and stay put). No archiving, freezing, or pointer-READMEs on old repos until Ian explicitly approves at cutover time. Old-name npm releases publish FROM the monorepo copies (npm doesn't care where you publish from), so consumers receive updates while the old repos sit untouched. Every omega-manager change (disperse dual-write, TARGET_CONFIG swaps) is a **gated cutover step requiring Ian's go-ahead** — never a side effect of foundation work.

**Publish policy — internal by default:** shared packages (`account`, `config`, `devkit`, `template-kit`, `themes`, and initially `client`) are `private: true` workspace packages **bundled into the published frameworks at prepare time** (esbuild via the already-universal `prepare-package`). Only the 5 frameworks + `@omega.js/manager` are published. A shared package goes public only when something outside the monorepo genuinely needs to install it. This kills the version-matrix problem across shared libs; consumers install exactly one framework package per app.

```
Omega/
├── package.json              # private, workspaces: ["packages/*", "spikes/*", "apps/*"]
├── .nvmrc                    # v22/*
├── CLAUDE.md                 # shared sections written ONCE (kills the 5-way mirror rule)
├── docs/                     # shared-concept docs (formerly mirrored per-repo)
├── .changeset/               # changesets — independent versioning
├── .github/workflows/ci.yml  # all package test suites + npm-pack→scratch-install smoke
├── packages/
│   ├── backend/       # @omega.js/backend@6    ← backend-manager (git subtree, history kept)
│   ├── web/           # @omega.js/web@1        ← NEW UJM successor (ships its own bin like the others)
│   ├── extension/     # @omega.js/extension@2  ← browser-extension-manager
│   ├── desktop/       # @omega.js/desktop@2    ← electron-manager
│   │                  # (packages/mobile RESERVED — MAM parked, complete overhaul later, out of scope)
│   ├── client/        # @omega.js/client@5     ← web-manager (renamed; frontend singleton)
│   ├── account/       # @omega.js/account@1    ← NEW: user schema engine + resolveSubscription
│   ├── config/        # @omega.js/config@1     ← NEW: omega.json5 loader/validator/schema
│   ├── devkit/        # @omega.js/devkit@1     ← NEW: cli router, safe-install, defaults engine, build-task factories, logger, TEST RUNNER
│   └── template-kit/  # @omega.js/template-kit@1 ← NEW: uj_* filters/tags as plain JS + engine adapters
├── spikes/
│   ├── bakeoff-shared/     # synthetic 1031-post corpus generator + hyperfine harness + scorecard
│   ├── bakeoff-eleventy/   # bake-off candidate 1
│   └── bakeoff-astro/      # bake-off candidate 2
└── apps/
    └── sandbox-brand/      # permanent dogfood consumer: a FRESH brand monorepo (apps/website + apps/backend)
                            # created via the scaffolding path, nothing copied — cross-stack e2e runs against it
```

**Add `packages/manager/`** (`@omega.js/manager`, published): the onboarding + orchestration engine extracted from omega-manager's brains (onboard wizard, service runners, disperse, update, brand/company schema) — built late in the program but a first-class package. Ian's omega-manager repo remains his private COMPANY instance (the `.brands/` configs, `.output/` state, secrets) and eventually consumes `@omega.js/manager` instead of owning the logic.

**Stays OUT of the monorepo**: omega-manager's private DATA (his company instance repo — the engine code migrates to `packages/manager` over time, gated), UJM + jekyll-uj-powertools (maintenance mode until last site migrates, then archived), wonderful-* / node-powertools / itwcw-package-analytics (generic, stable, zero dedup gain), all 49 consumer repos, `resolve-account` (deprecate + archive).

**Mechanics**: `git subtree add --prefix=packages/X <repo> main` preserves history. **Load-bearing insight: monorepo move, shared-package extraction, and npm rename are three independent, individually-gated steps** — old-name releases (`backend-manager@5.x` patches etc.) keep shipping from the monorepo until each package's cutover, so there is never a dual-repo maintenance window. Versioning: changesets, independent versions. `@omega.js/themes` (BXM+EM classy/bootstrap dedup) is deliberately deferred until @omega.js/web's theme port stabilizes — no premature package.

**Not packages** (senior-engineer test): FormManager and ads start as modules inside `@omega.js/web`; split only on a second consumer. CLI/defaults/gulp-factories/safe-install fold into devkit, not 4 micro-packages.

## 2. `config/omega.json5` — one config everywhere

Location: `config/omega.json5` at the npm project root (backends: `functions/config/omega.json5`). Shape:

```json5
{
  // SHARED — identical spelling in every project; machine-owned (omega-manager disperses)
  brand: { id, name, url, description, tagline, contact: { email }, address: {...}, images: {...} },
  firebaseConfig: { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId },
  analytics: { providers: { google: { id }, meta: { id }, tiktok: { id } } },   // secrets NEVER here → .env
  payment: { processors: { stripe: { publishableKey }, paypal: { clientId }, chargebee: { site }, coinbase: { enabled } }, products: [...] },
  sentry: { dsn },
  oauth2: { /* public client IDs */ },
  theme: { id: 'classy', appearance: 'system' },   // project-owned, seeded at onboarding

  // ALL target-scoped config lives under `targets` — same schema in EVERY omega.json5.
  // KEY PRESENCE = "this brand supports this target" (absorbs the old brand-config
  // targets ARRAY — one key, both meanings, can't drift). VALUE = type-wide config.
  // Brand-level file: settings for all apps of that type; app-level file: that app's settings.
  // A standalone repo simply fills its one entry. Any shared key may also appear inside a
  // targets entry as an override — same agnostic deep-merge. `extension: {}` = enabled, defaults.
  targets: {
    web:       { /* distribute, purgecss safelist, imagemin, workflows (from @omega.js/web design) */ },
    backend:   { parent, github, reviews, marketing, blog, dataRequest },
    desktop:   { app: {...}, platforms: { mac, win, linux },   // ← renamed from EM's inner `targets` to avoid targets.desktop.targets
                 autoUpdate, startup, releases, downloads, remoteConfig, restartManager },
    extension: { /* near-empty at launch */ },
    mobile:    { /* RESERVED — MAM parked, schema slot only; no build in this program */ },
  },
}
```

**Override hierarchy (agnostic — Ian's requirement):** a `targets.<type>` block may contain **any shared key** as an override, resolved by one deep-merge chain: `framework defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>`. So a per-framework Sentry DSN, GA stream ID, or `chatsy: { enabled: false }` lives in the target block with identical spelling — no special-case keys, and disabling any integration per-surface is uniform (`<key>: { enabled: false }`). omega-manager's disperse writes per-surface values (e.g. GA4 stream IDs from state.json) into `targets.<type>` overrides rather than into bespoke keys. **EM's per-OS `targets` key is renamed `platforms`** to avoid `targets.desktop.targets`.

Normalizations killed: MAM's `google_analytics` snake_case; secrets in configs (validator **hard-fails** on secret-shaped keys, `/(secret|privateKey|apiSecret)$/i`); `bundleIdentifier` → `appId` everywhere; UJM's `_config.yml`+JSON split-brain. `@omega.js/config` provides `loadConfig(projectDir, target)` (JSON5 → shared schema + per-target refinements → override merge → derived defaults, seeded from EM's proven `src/config/schema.js` format) and exports `SHARED_SECTIONS` so omega-manager's disperse enumerates instead of hardcoding. `toSiteGlobal()` shapes config as Jekyll-style `site.*` so template references port verbatim.

## 3. `@omega.js/account` — one user schema

Extract from BEM `src/manager/helpers/user.js`: the schema engine (token resolvers become injectable — Node-only `$apiKey`/`$randomId` generators passed in by BEM; frontend passes none → nulls), `USER_SCHEMA` (pure data), `resolveSubscription()` (unified superset incl. `everPaid`), plus `resolveAccount()` convenience.
- **BEM**: `user.js` becomes a thin wrapper — ships as a v5 **patch**, zero call-site changes.
- **WM**: `auth.js` deletes `DEFAULT_ACCOUNT` + local resolveAccount + resolveSubscription body; imports from `@omega.js/account` — ships as a 4.x patch. `everPaid` is additive.
- Drift resolved: `flags` and full `activity` branch enter the unified schema (resolve-on-read; no Firestore migration).
- **Gate**: golden-master test — `resolveAccount({})` byte-matches current BEM `new User(Manager, {}).properties`; both suites green; canary backend deploy with login/subscription/usage verified.

## 4. Frontend: bake-off then `@omega.js/web`

### Phase A — Eleventy vs Astro bake-off (hard-timeboxed, ~3 weeks max)

- **A0 groundwork (kept regardless of winner)**: `@omega.js/config` + `@omega.js/template-kit` (uj_* filters/tags as plain JS: `registerLiquid()` adapter for Eleventy, direct helper imports for Astro, + Jekyll-compat filter pack `relative_url`/`markdownify`/`where_exp`/…) + `spikes/bakeoff-shared` (synthetic 1031 posts + 105 pages shaped like somiibo's real content; hyperfine harness; **measure current somiibo Jekyll build FIRST as baseline**).
- **A1 identical slice in both candidates**: base layout chain; blueprint/index + pricing (incl. resolve-plan math); auth signin/signup (FormManager + web-manager boot); blog w/ pagination + taxonomy; 404; one frontmatter-only override page; TWO themes with **layered resolution, zero file copying**; 3-layer page-module JS/CSS via esbuild manifest; `page.resolved` equivalent (Eleventy: native data cascade + `eleventyComputed.resolved` compat alias; Astro: `deepResolve()` helper); frontmatter-value Liquid rendering (cached); sass loadPaths + PurgeCSS.
  - Eleventy bets to validate: LiquidJS `jekyllInclude: true`; layered includes via `root:` array; layered layouts via Eleventy v3 virtual templates, with symlink-farm compose step as guaranteed fallback.
  - Astro bets: theme layering via import aliases; content collections; keep Bootstrap classes (no scoped styles) so themes stay swappable.
- **A2 scoring** (weighted): cold build @1031 posts 25%; incremental rebuild + dev reload 20%; migration cost per layout (port 3 real layouts — classy contact, sweet-saucy recipe, somiibo index — stopwatch, projected across ~200 custom files in 49 sites) 20%; uj_* adapter ergonomics 10%; asset-pipeline integration 10%; long-term risk 10%; output parity (DOM diff + Lighthouse) 5%. **Margin < 0.5/5 → Eleventy wins by default** (migration-cost bias). Also decide the HTTPS dev-server story here (BrowserSync proxy vs alternative).

### Phase B — build `@omega.js/web` on the winner

- **Default pages: no copying.** Each default page registered as a virtual template unless the consumer has a same-URL file; `layout: blueprint/index` dispatch preserved verbatim. Real page defaults stay in theme-layout frontmatter (classy pricing carries ~200 lines).
- **Theme fallback**: layered resolver (project theme → package theme → classy) replaces `copyFallbackThemeFiles()` + bracket-templating hack.
- **gulp deleted**: `omega dev` (SSG serve ∥ esbuild watch ∥ sass watch), `omega build` (parallel ssg ∥ esbuild ∥ sass ∥ images → translation → purge/minify). webpack→esbuild (babel dropped); imagemin gains content-hash cache; minifyHtml becomes an SSG transform; jsonToHtml deleted (native JSON data); translation.js + audit.js port nearly untouched.
- Steps: B1 engine core (promote winning spike) → B2 all ~30 blueprint pages + 4 themes (mechanical Liquid conversion; theme-contract tests as you go) → B3 CLI (`setup/dev/build/deploy/translate/audit/test/clean`; FILE_MAP scaffolding semantics preserved minus page copying; Ruby-free CI workflow template) → B4 `omega migrate` codemod (`_config.yml`+`ultimate-jekyll-manager.json` → omega.json5; Gemfile removal; liquid-lint scanner with per-file fixes) → B5 `omega verify --against <jekyll-dist>` parity harness (URL-set diff, DOM diff on key pages, redirect map) = per-site migration gate.
- Keep Jekyll's `_posts/YYYY-MM-DD-slug.md` filename convention (small date-parse hook) — zero content churn.

## 5. omega-manager adaptation (this repo — ALL of it deferred to Phase 3 cutover gates; untouched before then)

- **Disperse** (`src/services/disperse/disperse-config.js`): five divergent mapping blocks collapse to one `SHARED_OMEGA_MAPPINGS` block + per-target deltas (per-surface GA4 stream ID from state.json; onboarding-only scaffolds). New file targets `config/omega.json5` / `functions/config/omega.json5`. **Dual-write** legacy files + omega.json5 until each target's cutover completes; validate every written file via `@omega.js/config`.
- **Update service** (`src/services/update/write/targets.js` TARGET_CONFIG): swap install commands per cutover (`npm i @omega.js/backend@latest` …). Everything else is name-agnostic.
- **config.js**: keep `UNIFIED_KEYS` as-is (baked into brand configs/stream names); add `TARGET_SECTION_MAP = { website: 'web', 'browser-extension': 'extension', backend: 'backend', desktop: 'desktop', mobile: 'mobile' }`. Renaming UNIFIED_KEYS = deferred cleanup.
- **Brand schema** (`src/lib/brand-schema.js`): near-zero change (omega.json5 shared sections mirror brandConfig by design); add `theme` defaults.

## 6. Framework structure harmonization — BEM joins the src→dist+defaults pattern

Verified: UJM/EM/BXM/MAM all follow `src/` → `dist/` (via the shared `prepare-package` watch) with `src/defaults/` scaffolded into consumers, and bins reading `dist/`. **BEM is the outlier**: its bin requires `src/cli/index.js` directly, `package.json` declares a `dist/` that doesn't exist, its `src/defaults/` has only 5 files (vs UJM's 310), and it writes **tracked framework boilerplate into consumers** — `public/404.html` + `public/index.html` generated by `src/cli/commands/setup-tests/public-html-files.js` from `templates/public/` (verified committed in ultimate-jekyll-backend).

Changes (shipped as old-name BEM v5 releases during Phase 1, before the v6 rename):
- Add the `dist/` layer via `prepare-package` (same config every other framework uses); bin → `dist/cli/index.js`.
- `public/*` becomes **generated at build/setup time + gitignored** in consumers — the consumer never sees or tracks framework boilerplate. Same rule audited across all frameworks: anything a consumer never edits moves behind generation.
- Expand BEM's `src/defaults/` to parity with the other frameworks (CLAUDE.md merge, .gitignore markers, workflows) via the devkit defaults engine.

## 7. Unified testing architecture (continuous verification is a gate, not a phase)

Current state (verified): every framework has a DIFFERENT custom runner — BEM (`src/test/runner.js`, integration-only against the Firebase emulator), UJM (3-layer build/page/boot with a Chromium runner), EM/BXM partial, **MAM none**. `TEST_EXTENDED_MODE` is already a canonical cross-framework signal. Loggers (`src/lib/logger.js`) are ~99% identical ×4; `attach-log-file.js` test-log tee duplicated similarly.

Target:
- **`devkit/test`**: one shared runner core (suites/groups/standalone, SkipError, extended-mode flag, log tee) + the Chromium runner, extracted from UJM's — adopted by all 5 frameworks. UJM's **3-layer model (build / page / boot) becomes the OMEGA standard**; each framework maps its own layers (BEM: unit / route-integration-vs-emulator / e2e; EM: unit / renderer / packaged-boot; MAM gets a suite for the first time).
- **Cross-stack e2e harness** (the missing MAJOR piece): `omega e2e` boots the BEM emulator (`firebase emulators:start` — functions, firestore, auth, database, hosting, pubsub + Stripe webhook forwarding, all existing plumbing) AND the built/served website, then drives real browser flows — **signup, signin, session persistence, subscription resolution** — against the pair. Runs at two levels with the same harness:
  - **Framework level**: against `apps/sandbox-website` + `apps/sandbox-backend` in monorepo CI — every devkit/account/config extraction is gated by it.
  - **Brand level**: pointed at any brand's website+backend repos (via omega-manager), giving per-brand full-stack verification.
- **Redesign discipline**: every extraction/refactor step in every phase ships with unit + integration coverage and must pass the cross-stack e2e before the next step begins. The golden-master account test (§3) is the template: prove byte-parity, then swap.

## 8. Dev-mode DX (multi-framework sessions)

Verified: all frameworks share the identical flow — `npm start` = `prepare-package` watch (src→dist), consumers run `npx mgr i local` = `npm install <abs repo path>`. The mechanics stay; the pain (N VSCode windows, N watch processes) goes:
- **One repo, one window, one command**: root `npm start` runs every package's `prepare:watch` concurrently. Building a full-stack feature (client + backend + web) = one session.
- `mgr i local` is unchanged for consumers, now pointing at `packages/*` paths inside the one monorepo.
- Cross-stack features are testable WITHOUT any consumer repo via the in-repo sandbox apps + `omega e2e`.
- **Brand-level orchestration (decided: brand monorepos from day one)**: in a brand monorepo, `npm start` boots every app (website dev server + backend emulator + …) and `npm test` runs the brand-wide cross-stack e2e. Existing separate-repo brands get the same experience via @omega.js/manager commands until they consolidate at their Phase-4 moment.
- **Auto local-linking (designed in from day one)**: one command in any brand repo (e.g. `omega dev --local`) detects every @omega.js framework the brand uses, file:-installs them from the local Omega monorepo, and starts the monorepo's watch — replacing today's N-windows + N×`mgr i local` choreography. Same mechanics as today's flow (file: installs + prepare-package watch), just orchestrated.

---

# Phased roadmap (with gates)

**Phase 0 — Bootstrap (first; touches ONLY the new `Omega` repo)**
1. **Claim the `@omega.js` npm org — gates ALL naming.** Fallback if taken: pick alternative scope before proceeding.
2. Create `/Users/ian/Developer/Repositories/Omega`; **plain-copy** the 4 repos' code into `packages/*` (backend-manager, web-manager, browser-extension-manager, electron-manager — **NOT mobile-app-manager, MAM is parked**) — sources untouched, no history import, no archiving until Ian approves at cutover.
3. Workspaces + changesets + CI (each package's test suite + `npm pack`→scratch-install smoke).
4. Consolidate CLAUDE.md/docs (root owns shared sections; packages keep Identity/Architecture/CLI/docs-index).
5. **Gate**: publish one old-name patch (e.g. `browser-extension-manager@1.7.2`) from the monorepo; canary consumer install behaves identically.

**Phase 1 — Foundation packages** (parallel with Phase 2)
1. `@omega.js/devkit` first slice: **test runner core + Chromium runner + logger + safe-install** (pure duplication, trivial risk) — because everything after is gated on tests. Stand up the sandbox as a **completely fresh brand monorepo** (`apps/sandbox-brand/` with `apps/{website,backend}` inside — created through the scaffolding path, NOTHING copied from existing brands) + the **`omega e2e` cross-stack harness** (BEM emulator + site + signin flow) in monorepo CI. This makes the brand-monorepo format + config hierarchy real from day one.
2. `@omega.js/account` (highest value, smallest surface) → BEM v5 patch + WM 4.x patch wrappers. Gates: golden-master, both suites, cross-stack e2e signin/subscription, canary backend deploy.
3. **BEM harmonization** (old-name v5 releases): dist/ layer via prepare-package + bin flip; `public/*` generated + gitignored; defaults expansion. Gate: BEM suite vs emulator + canary backend.
4. `@omega.js/config` → frameworks gain **dual-read** (omega.json5 if present, else legacy) as old-name minors published from the monorepo. omega-manager's disperse dual-write is DEFERRED to Phase 3 cutovers (omega-manager untouched until then, per hard constraint). Gate: EM audit+boot in both modes on a canary.
5. `@omega.js/devkit` remaining slices in risk order: cli router → defaults engine → build-task factories one at a time. Gate per step: framework suites + cross-stack e2e + canary build.

**Phase 2 — Frontend bake-off → @omega.js/web** (A0→A2, decision memo, then B1→B5 per above).

**Phase 3 — Framework cutovers** (rename + omega.json5 required; blast radius ascending; mobile removed — MAM parked): **extension** (smallest blast radius, fast release loop — the rename-recipe dry-run AND first real gate) → **desktop** (incl. package+sign+notarize canary) → **backend** (30 live backends — last, after recipe proven 2×). Recipe each time: flip name + major; `mgr setup` one-shot config migration (legacy → omega.json5, idempotent); omega-manager TARGET_CONFIG update + retire that target's legacy disperse mappings; canary full omega-manager run (update→bump→build→deploy→sync) + testing-service target-checks; bulk-migrate remaining consumers via one omega-manager run; `npm deprecate` old name.

**Phase 4 — Website migration + brand consolidation (49 sites)**: per site `omega migrate` → fix liquid-lint findings → `omega build` + `omega verify` → deploy → delete Gemfile/_config.yml. **A brand's website migration is also its consolidation moment**: the brand monorepo is created then (website moves in; already-cutover targets join it, each gated — deploy pointers, Pages/Actions, release repos re-aimed per brand with verification). Pilot order: deployment-playground (1 page) → ultimate-jekyll-website (dogfood) → daily-embers or universal-auth (posts+auth) → **somiibo (1031-post scale test — record timings vs Jekyll baseline)** → sweet-saucy (consumer-theme + custom-collections stress) → remaining 44 in waves of 8–10, smallest-custom-count first, driven by the manager tooling.

**Phase 5 — @omega.js/manager product + cleanup**: extract the manager engine (onboard, disperse, update, service runners, company/brand schema) from omega-manager into `packages/manager` (gated — omega-manager repo becomes Ian's private company instance consuming it); ship the **public GitHub brand template** ("Use this template" → onboarding wizard → brand monorepo). Delete dual-read/dual-write paths; archive UJM + jekyll-uj-powertools + freeze `web-manager@4.x`; deprecate resolve-account; rewrite `omega:*` skills + shrink mirror-spec.

# Verification

- **Every phase has an explicit gate above**; nothing proceeds on green-looking-but-unverified work.
- Bake-off: both spikes build the 1136-document corpus; RESULTS.md scorecard complete; frontmatter-only override renders consumer data over layout defaults in both.
- @omega.js/web: `apps/sandbox-website` with a 5-line omega.json5 and zero pages serves all ~30 default pages via `omega dev`; theme swap rebuilds with **zero files written outside `.omega/` and `dist/`**; full `omega build` (purge+minify+translation) completes; `omega test` green.
- Consumer migrations: `omega verify` = 100% URL parity (or documented diffs) + Lighthouse ≥ Jekyll baseline; somiibo cold build minutes → tens of seconds, incremental sub-second-to-few-seconds.
- Schema/account: golden-master byte-parity + BEM `npx mgr test` + WM suite + canary login/subscription/usage e2e.
- Monorepo hygiene: `npm pack` → scratch-install smoke per package in CI (catches phantom hoisted deps).

# Top risks

1. **@omega.js scope unavailable** → Phase 0 step 1 gates everything.
2. **LiquidJS ≠ Jekyll Liquid edge cases** → compat filter pack + liquid-lint run against real somiibo/studymonkey/sweet-saucy sources **during the bake-off**, not after.
3. **Eleventy layered layouts** is the load-bearing bet → virtual templates validated in bake-off; symlink-farm compose is the guaranteed fallback.
4. **web-manager dual-name window** (UJM pins `web-manager@^4` while others move to `@omega.js/client@5`) → freeze 4.x bugfix-only; scripted old-name publishes from `packages/client` if needed.
5. **Disperse/framework version skew** → dual-write + idempotent `mgr setup` migration until each bulk migration completes.
6. **PurgeCSS or frontmatter-Liquid may be the new bottleneck at 1031 posts** → both measured in bake-off; caching strategies specified.
7. **BEM v6 blast radius (30 live backends)** → v6 is *only* the name+config flip; account/config/devkit all shipped earlier as v5 patches/minors; recipe proven on 3 frameworks first.
8. **CI across 49 repos regenerates via `omega setup`** → translation cache branch (`cache-uj-translation`) must survive; scheduled rebuild AI spend watched.

# Ian's follow-up notes — how each is addressed

- **"Harmonize framework structure; BEM drifts"** → §6: BEM gets src→dist + generated/gitignored `public/*` + full defaults, shipped as v5 releases before its rename.
- **"Testing is a mess + automate cross-framework testing (signin with site + emulator)"** → §7: shared 3-layer runner in devkit + `omega e2e` cross-stack harness at framework AND brand level; built FIRST in Phase 1 because everything else gates on it.
- **"Tons of non-DRY systems (logging, config.json…)"** → devkit absorbs the verified ~99%-identical logger ×4, safe-install ×5, attach-log-file, cli router ×5, defaults engine ×4; config.json fragmentation dies with omega.json5; BEM's console+file route logging stays a BEM feature but its logger plumbing moves to devkit.
- **"Continuously check work with unit/integration/e2e"** → every phase gate now includes the relevant suites + cross-stack e2e; golden-master pattern for extractions.
- **"UJM: set up as-is first, or from scratch?"** → As-is import for EM/BXM/MAM/BEM/client (harmonize incrementally, old names keep shipping); **@omega.js/web is built fresh from the bake-off spike** — refactoring UJM's gulp/Jekyll plumbing first would be throwaway work. UJM is never renamed; it retires site-by-site.
- **"Config: framework-specific overrides of global values (Sentry/GA/Chatsy per-surface)"** → §2 override hierarchy: any shared key can be overridden in the target section, agnostic deep-merge, `enabled: false` works uniformly.
- **"Blueprint system + append pattern (privacy policy) must survive"** → §4/Phase B: default pages preserved as virtual templates with frontmatter-only overrides, **including the append/extend mechanism for legal pages** (default text + consumer-appended paragraphs) — pattern-compatible, not just feature-compatible.
- **"I like the existing patterns — optimize, don't reinvent"** → the plan's standing rule: preserve semantics (blueprints, defaults scaffolding semantics, mgr i local, prepare-watch, disperse model), replace only plumbing (Ruby/Jekyll, copy-hacks, duplicated code).

# Standing permission: consistency changes (Ian, explicit)

Where frameworks do the same job **similarly but not identically**, normalizing them to be identical — or better, extracting the shared implementation into devkit — is licensed scope, not creep. When two implementations differ in behavior, pick the better one and make it the shared standard (don't preserve both quirks). Discipline unchanged: normalize → extract → adopt → verify (suites + canary) per step.

# Adopted recommendations (Ian can veto any)

- Repo at `/Users/ian/Developer/Repositories/Omega`; package dirs match omega.json5 target names (`web`/`backend`/`desktop`/`extension`/`mobile`).
- web-manager → `@omega.js/client` (the `web` name goes to the framework), **internal/private + bundled** like the other shared packages; no separate web CLI package — `@omega.js/web` ships its own bin like every other framework. Framework bundlers alias legacy `web-manager` imports in consumer page modules to the bundled client.
- Backend config at `functions/config/omega.json5` (standalone) / `apps/backend/config/omega.json5` (brand monorepo); extension's section named `extension` (mapping table bridges legacy `browser-extension` unified key).
- omega-manager's private DATA stays out of the monorepo; the ENGINE becomes published `@omega.js/manager` in Phase 5 (revised from the earlier stay-private call, per Ian's template-product vision).
- `@omega.js/themes` deferred until web's theme port stabilizes; wonderful-*/node-powertools stay external; changesets owns monorepo versions (`npu bump` remains consumer-repo-only).
- Keep `_posts/YYYY-MM-DD-slug.md` convention; UJM in maintenance mode (never renamed) until the final wave.
