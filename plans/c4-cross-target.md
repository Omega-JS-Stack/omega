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
   - **cp106a** — client engine adopts desktop's semantics: canonical
     providers shape (index.js flat handoff + web foot.html's flatten bridge
     DIE), uuidv5 identity, secret stays env-at-build (extension package.js
     already bakes `GOOGLE_ANALYTICS_SECRET`), and the ITW dev creds are
     DELETED — dev mode logs events instead of posting (consumers' dev
     traffic must not land in ITW properties). Web runtime becomes
     shape-ready but gtag remains the web path pending Ian.
   - **cp106b** — desktop's lib collapses onto the client engine (main-process
     wrapper keeps the preload/renderer IPC bridge + env secret; the
     analytics-bridge suite repins).
   - **QUEUED TO IAN**: web analytics — keep gtag.js (Google's script,
     auto-collected page_view/scroll/engagement) or unify on the client's
     Measurement Protocol (no third-party script, but auto-collection is
     lost)? Marketing-data trade-off, not an engineering call.
4. **cp107 — FormManager → shared.** Moves into `@omega.js/client` (it already
   only uses client primitives); web re-imports; desktop/extension gain it for
   real (fixes desktop's dead alias).
5. **cp108 — FontAwesome story.** One icon mechanism (likely: shared runtime
   inline-SVG module + per-target asset supply; desktop's FA-Pro set stays its
   asset source). Decide after cp104 proves the css channel.
6. **cp109 — theme-once acceptance.** Desktop/extension consume the FULL theme
   layer chain (classy triplication dies); omega-brand desktop + extension
   render the brand theme zero-copy-paste. Lands with/after the skin pass so
   the reskin ships everywhere at once. `@omega.js/themes` packaging revisited
   here (master-plan note).
