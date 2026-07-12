# C4 — Cross-target sharing (survey + slicing)

> Opened cp103+ (2026-07-11), Ian's go. Read-only survey by fan-out agent over
> packages/{web,desktop,extension,client,config}; verified spot-wise. Arc
> context: [dogfood-arc.md](dogfood-arc.md) cp10x block. Acceptance for the
> whole arc: **omega-brand desktop + extension render the brand theme + shared
> modules with zero copy-paste.**

## Survey — what's duplicated, where

**Theme/CSS (the anchor cluster).** Bootstrap 5.3 + classy are TRIPLICATED —
full copies in `web/themes/`, `desktop/src/assets/themes/`,
`extension/src/assets/themes/`; each target's sass pipeline
(`desktop/src/gulp/tasks/sass.js`, `extension/src/gulp/tasks/sass.js`) resolves
only its own copy, and they're already drifting (`hero-demo-form.js` differs
web↔desktop; extension's classy is a reduced stub). **Zero `--omega-*` token
references outside packages/web** — the C3 contract stops at web's boundary;
desktop/extension classy `_config.scss` still speak raw Bootstrap vars.

**FontAwesome — three incompatible systems.** web: build-time prerendered SVGs
(`uj_icon` tag + `libs/prerendered-icons.js` + `_custom-font-awesome.scss`).
desktop: hand-rolled main-process IPC server over a vendored FA-Pro SVG set
(`src/lib/fontawesome.js` + renderer `_wireFontAwesome`). extension: nothing
(commented-out import).

**Analytics — GA4 implemented 2–3×.** `client/src/modules/analytics.js` =
browser Measurement Protocol (runtimes: extension+electron; web is a literal
TODO) with **hardcoded ITW dev GA4 ids/secrets at the top**;
`desktop/src/lib/analytics.js` = a second, independent Node MP implementation;
web = a third path via gtag.js in `foot.html`. Config-shape split: schema says
`analytics.providers.google.id` (nested), client reads flattened
`analytics.google`/`googleSecret`, and web's foot.html hand-flattens between
them.

**Ads — web-only + unschema'd + ITW-hardcoded.** `vert.js`/`popupads.js`/
`_verts.scss`/`adunits/*` exist only in web. Templates consume
`resolved.advertising.google-adsense.*` but **`advertising` is NOT in the
config schema** (`SHARED_SECTIONS`) — pure passthrough today. De-ITW targets in
`vert.js`: hardcoded `https://promo-server.itwcreativeworks.com/verts/main`
fallback (L189), same-origin allowlist (L95), `brand.id === 'promo-server'`
special-case (L187).

**Forms — web-only, wanted elsewhere.** `web/core/js/libs/form-manager.js`
builds on `@omega.js/client` primitives; desktop's copied classy theme
dead-imports `__main_assets__/js/libs/form-manager.js` (alias undefined in
desktop webpack); extension has nothing; client has no form module.

**Theme-once mechanism: none.** No `@omega.js/web` imports in desktop or
extension; themes were hand-copied and drift. (Other ITW hardcodes noted for
later: `extension/src/background.js` api.itwcreativeworks.com fallback,
extension package/webpack `validRedirectHosts`.)

## Slices (cp104+; order = backbone first, modules after)

1. **cp104 — cross-target token plumbing. ✅ SHIPPED (2026-07-11).** Channel
   chosen: devkit vendor's NEW declared-assets manifest (`omega.vendorAssets`
   in package.json — copies from the resolved `@omega.js/web` devDep into
   dist at every prepare; loud on missing source) rather than a runtime dep
   or sass importer — dist stays self-contained for consumers. Both entries
   emit `tokens/index` before the theme; first consumer
   `body { accent-color: var(--omega-accent) }` on both targets. Bonus
   hardening: vendor scan now REFUSES publishable-package references outside
   runtime deps (allowlist devkit/config/account) instead of folding whole
   packages into dist. Proofs: byte-identical sheets on plain install;
   omega-brand extension + desktop builds carry the tokens; devkit 186 /
   desktop 764 / extension 102.
2. **cp105 — `advertising.*` schema + vert de-ITW. ✅ SHIPPED (2026-07-11).**
   `advertising.providers.{google-adsense.{client,4 slots}, inhouse.serverUrl}`
   in SHARED_SECTIONS; all consumers respelled; vert.js hardcodes dead (URL,
   origin allowlist, promo-server special-case → "brand hosts the ad server"
   rule); config-convert lifts legacy flat shape; ad TYPE param was already
   live (cp63 port). config 95 / web 102 / manager 584.
3. **cp106 — analytics ONE engine.** Survey verdict (2026-07-11): the collapse
   direction REVERSES — desktop's `src/lib/analytics.js` is the superior
   engine (canonical `analytics.providers.google.id` read, secret via
   `GOOGLE_ANALYTICS_SECRET` env like backend/extension, uuidv5 cross-surface
   identity: deviceId→client_id, firebaseUid→user_id, namespace from
   projectId); the client module is the weak twin (flat `analytics.google`
   shape, **real ITW GA4 ids+API secrets hardcoded in source** as dev creds,
   no identity model). Best-implementation-wins:
   - **cp106a — SHIPPED (2 commits, 2026-07-12)** — client engine adopted
     desktop's semantics: canonical providers shape everywhere (index.js flat
     handoff DEAD, web foot.html flatten bridge DEAD — resolved.analytics
     rides through verbatim, extension package.js emits nested
     providers.google.{id,secret}), uuidv5 identity ported (namespace =
     uuidv5(projectId, URL), client_id = uuidv5(deviceId, ns) with a
     persisted `_omega_device_id`, user_id = uuidv5(uid, ns) auto-wired to
     onAuthStateChanged; raw uids never leave the device), user_properties
     wrapped {value}, ITW dev creds DELETED (prong 1) — dev logs, never
     posts. Dead `itwcw-package-analytics` dep dropped; `uuid` added.
     client 85 / web 103 / extension 102.
   - **cp106b — SHIPPED (2026-07-12)** — desktop's lib collapses onto the client engine (main-process
     wrapper keeps the preload/renderer IPC bridge + env secret; the
     analytics-bridge suite repins).
   - **IAN ANSWERED (2026-07-12)**: "We definitely need an analytics system
     for backend and potentially desktop and extension… events don't
     automatically fire for desktop and extension… if we need an analytics
     library, we should unify it and have it in one place. Right?" →
     **ONE unified lib, living in @omega.js/client** (the MP engine for every
     runtime where nothing auto-fires: desktop, extension, web-as-needed;
     backend keeps its server-side MP sender on the same config/env
     conventions). Web keeps gtag.js for auto-collection — it's a tag the
     page loads, not a second library we maintain; the client engine is the
     single in-house implementation. cp106a/cp106b proceed as sliced.
4. **cp107 — FormManager → shared. ✅ SHIPPED (2026-07-12).** Moved verbatim
   into `@omega.js/client/modules/form-manager.js` — its only imports were
   already client primitives, now relative (`./dom.js`, `../index.js`; no
   self-name refs, pre-publish safe). 23 web import sites + web classy's
   dynamic import respelled to the client path; web's copy DELETED. Desktop's
   dead `__main_assets__` alias import (classy hero-demo-form) now points at
   the client module (client is a desktop runtime dep since cp106b);
   extension gets the module for free via its client dep. client 90 (+5:
   real import under the test DOM shim, constructor-throw behavior,
   relative-imports/no-alias pins, dist presence) / web 103 / desktop 764 /
   ext 102.
5. **cp108 — FontAwesome story. ✅ SHIPPED (2026-07-12, Ian's go).** ONE icon
   mechanism: NEW `@omega.js/client/modules/icon-core.js` (pure CJS, the
   analytics-core pattern) owns icon SEMANTICS — name/style whitelists,
   candidate order (style dir → brands fallback), the injected root
   attributes (merged best-of-both: web's only-when-absent injection +
   desktop's full set incl. the FA-7 `overflow="visible"` clip fix), and
   alias mapping. Asset source = **@fortawesome/fontawesome-free npm dep**
   (web + desktop; resolved from node_modules, never vendored) — kills the
   LICENSE BUG (desktop vendored 21MB/4,799 FA **Pro** SVGs inside a
   package destined for public npm = redistribution) and closes web's icon
   gap (core had only 12 curated SVGs; the other ~579 `uj_icon` uses
   rendered the default triangle — now the chain
   `[core/icons, fa-free/svgs]` + `metadata/icon-families.json` aliases
   resolves everything, with a warn-once on true misses). template-kit's
   `uj_icon` and desktop's `lib/fontawesome.js` both consume icon-core
   (template-kit gains the client dep; desktop's IPC/renderer contract
   unchanged). Brand-level Pro override → shipped as cp111; extension
   supply still waits for an icon consumer there. Proofs: live
   chain render (curated-first `rocket`, free-only `circle-user`, alias
   `search`, brands-fallback `github` — all `+attrs`); client 94 (+4) /
   template-kit 42 (+1) / web 103 / desktop 764+5skip.
6. **cp109 — theme-once MECHANISM. ✅ SHIPPED (2026-07-12, Ian's go; skin
   rides it).** The classy/bootstrap TRIPLICATION IS DEAD: web's `themes/`
   tree is the ONE source; desktop + extension vendor it whole
   (`omega.vendorAssets` += `{from: 'themes', to: 'assets/themes'}` — the
   proven cp104 channel; both targets' sass loadPaths + ext webpack
   `__theme__`/`__main_assets__` aliases already pointed at
   `dist/assets/themes`, so pipelines barely changed) and their local
   copies are DELETED. The drift audit proved the pain both ways —
   desktop's fork was MISSING web's has-validation forms fix while web was
   MISSING desktop's `safeRedirect` hero-form security gate — so the SSOT
   classy is the UNION, best-implementation-wins: upstreamed INTO web
   classy = desktop's safeRedirect (hero-demo-form.js), desktop's
   `$min-contrast-ratio` knob (+bootstrap map pass), desktop's
   `_titlebar.scss` (inert without desktop DOM), and extension's six
   fork-only modules (soft-colors, spacing, avatars, links, logo-scroll,
   spinners); web wins every divergent shared file (the living line —
   ext's stale fork deltas die, resurfacing in the skin pass rewrite
   anyway). Desktop's prebuilt `bootstrap.bundle.js` moved out of themes/
   to `assets/js/` (renderer + test-preload respelled). `@omega.js/themes`
   packaging RE-DECIDED: no separate package — the vendor channel gives
   one-source semantics without another publishable surface. Proofs:
   vendored dists carry has-validation + safeRedirect + titlebar in BOTH
   targets; omega-playground extension AND desktop consumer builds exit 0
   with compiled css carrying has-validation/em-titlebar/avatar-/
   logo-scroll (the ext build also proves web's `_theme.js` resolves via
   the existing `__main_assets__` alias — ext pages now get the real
   component init, not the commented-out stub). Suites: web 103 / ext 102 /
   desktop 764+5skip. REMAINING for the arc: the actual skin (cp99a+ on
   Ian's board notes) ships everywhere at once through this channel.
7. **cp111 — brand Pro supply. ✅ SHIPPED (2026-07-12, Ian: "i want to use
   my pro icons").** The channel cp108 deferred: best-first root chain on
   every icon surface — `OMEGA_FONTAWESOME_ROOT` (fontawesome.com download
   dir, tokenless route) → brand-installed `@fortawesome/fontawesome-pro`
   (FA npm-token route) → the free floor, ALWAYS last in the chain so a
   partial brand set never loses free icons/metadata. Pro stays out of
   every package.json omega owns (license — the brand authenticates the
   `@fortawesome` scope itself). icon-core owns the order (`PACKAGES`) and
   style validity moves whitelist → path-safe shape (`STYLE_REGEX`): Pro
   families (light/thin/duotone/sharp-*) and future FA sets work with zero
   framework edits, traversal guarantee intact. web: NEW
   `src/fontawesome-roots.js` (engine chain `[core, brand?, free]` +
   richest aliasFile). desktop: `_resolveRoots()` walks the same chain
   (env logged, Pro logged, multi-root `_read`/`_alias` fallthrough), and
   the renderer auto-render learns FA's family × weight classes
   (`fa-sharp fa-light` → sharp-light; pre-cp111 everything but fa-brands
   rendered SOLID — Pro markup without Pro now stays empty, never the
   wrong style). Tests Pro-presence-PROOF (adaptive — green before/after
   Ian installs Pro; desktop main-process proof: env-root glyph resolves
   while play/search still come from free; renderer proof: fa-light never
   falls back to solid). client 95 (+1) / web 107 (+4) / template-kit 42 /
   desktop 766 (+2). Extension still consumer-less for icons — its supply
   keeps riding the vendor channel when one appears.
8. **cp112 — dynamic icons everywhere. ✅ SHIPPED (2026-07-12, Ian:
   "fa-{icon} via js MUST work" + "one single WEB library").** ONE browser
   auto-render in client — NEW `modules/icon-renderer.js` (scan +
   MutationObserver over insertions AND class changes → set/changed fa-*
   classes re-render in place, removal clears; `data-omega-fa` marker;
   caching; transport injected) + `parseIconClasses` joins icon-core
   (family × weight SSOT — desktop's cp111b local copy deleted same-day,
   as it should be). Desktop renderer = 10-line IPC wrapper; web boots
   the watcher on every page (runtime/boot.js initialize) with a fetch
   resolver against the site's OWN emitted set — new `icons` build phase
   ships the merged chain (Pro + free + curated core, best per file) to
   assets/fa/ (~25MB with Pro; fetch-per-icon so only used icons ever
   transfer; hosting diffs by hash). Extension: recipe in docs/icons.md,
   wires when its first consumer lands. docs/icons.md is now the icon
   HUB (authoring + chain + Pro supply; desktop doc trimmed to a
   pointer; CLAUDE.md Icons section). client 96 / web 109 / desktop 767
   (live re-class → swap → clear proof). The desktop suite IS the
   real-DOM proof of the exact module web pages run — same code path.
   **cp112b (same day, Ian: "SYNONYMOUS IN ALL including bxm"):** ext
   wired — build-side chain+emit moved to `@omega.js/devkit/icons` (ONE
   impl; web's copies deleted), ext gains the fa-free floor dep + gulp
   `fontawesome` emit task + self-starting `lib/icons.js` watcher import
   on all four page surfaces (getURL fetch, packaged/offline) + WAR
   `assets/fa/*` for content-script-injected UI (host DOMs never
   auto-watched — collision by design). Playground ext build: 5,681
   icons emitted incl Pro-only acorn (brand .env → BXM chain proven).
   devkit 195 / web 103 / ext 102.
