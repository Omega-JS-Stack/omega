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
5. **cp108 — FontAwesome story.** One icon mechanism (likely: shared runtime
   inline-SVG module + per-target asset supply; desktop's FA-Pro set stays its
   asset source). Decide after cp104 proves the css channel.
6. **cp109 — theme-once acceptance.** Desktop/extension consume the FULL theme
   layer chain (classy triplication dies); omega-brand desktop + extension
   render the brand theme zero-copy-paste. Lands with/after the skin pass so
   the reskin ships everywhere at once. `@omega.js/themes` packaging revisited
   here (master-plan note).
