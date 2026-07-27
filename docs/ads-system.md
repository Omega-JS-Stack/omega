---
status: ratified
created: 2026-07-20
---
# OMEGA Ads System — spec (RATIFIED with amendments, Ian 2026-07-20)

> Queue item (b), Ian 2026-07-20: ads are "super important" — provider ads first (AdSense), in-house/fallback ads hostable on the parent company OR the brand itself. Grounded in the legacy survey (vert.js, promo-server-website/backend, UJM adunits, `ultimate-jekyll-manager/plans/unified-vert-ad-units.md`).
>
> **Ian's amendments (2026-07-20)**: (1) Detection is a FULL REWRITE — don't preserve the legacy poll mechanics, just the behavior: adblock detected OR no-fill for any reason → in-house fallback. (2) Serving is RUNTIME (function/Firestore read), not build-time — cost handled by an in-memory inventory cache in the function (TTL ~5 min → one Firestore read per instance per interval, not per impression). (3) `weight` required; RELEVANCE required: contextual targeting v1 (per-ad tags × the requesting brand/page's tags, match-score × weight) — no user tracking; viewer-level targeting is a later layer on the same scoring. (4) Company model confirmed: ITW Creative Works is the company; legacy brands (soundgrail, sweet-saucy, …) eventually migrate and look to the COMPANY for ads etc. promo-server.itwcreativeworks.com stays online untouched until that migration; its inventory imports into the company module then.

## What the legacy system got right (preserved)

- The **fallback ladder**: provider fills → shown; unfilled / timeout / script-load-failure → in-house unit → nothing. No adblock library, graceful always.
- **Origin-validated postMessage** with a tiny fixed vocabulary (set-dimensions, click) + sandboxed iframe.
- **Fail-closed redirect validation** (origin+pathname allowlist) and UTM-tagged click-throughs.
- **Lazy rendering** — units cost nothing until near-viewport.
- **One SSOT for the publisher ID** feeding both the ad tag and `ads.txt`.
- Per-ad **whitelist/blacklist + enabled** flags; client-side shuffle rotation.

## What it kills by design

1. **The vert.js parked-build problem**: the legacy client was a standalone IIFE that can't `import @omega.js/client` without duplicating the singleton. The new client is an **`ads/unit` SECTION** — its `section.js` rides the §7 main-bundle lane (DOM-presence init), sharing the one client instance like every other section. `core/js/modules/vert.js` and the `adunits/*` includes die.
2. **The self-refresh "chrome-error" bug**: rotation lived INSIDE the cross-origin iframe (a sleep/offline refresh strands `chrome-error://` with no JS left to recover). New rule: **the HOST owns all lifecycle** — rotation timer, staleness recovery (`visibilitychange`/`online` → reload iframe if stale), fill monitoring. The iframe only renders and reports.
3. **Raw hardcoded consumer iframes** (the Tabblar antipattern): every surface gets the same first-class unit — web via the section, desktop/extension via the shared client's ads module bound to a `data-omega-ad` element (mirrored-implementation rule).
4. Cargo-cult remnants: the dead `popupads.js` "detector" stub, duplicated AdSense in-feed layout keys (one JS-side table), allow-all Firebase rules.

## Config (omega.json5 — provider-discriminated, D12 shape)

```json5
advertising: {
  providers: {
    'google-adsense': {
      client: 'ca-pub-XXXX',            // feeds the ad tag AND ads.txt (SSOT)
      slots: { display: '…', inArticle: '…', inFeed: '…', multiplex: '…' },
    },
    inhouse: {
      source: 'company',                 // 'self' (this brand's backend) | 'company' (parent's api) | full URL
    },
  },
  fallback: 'inhouse',                   // provider role to fall through to; false = none
  tags: ['music', 'audio-tools'],        // this brand's contextual tags (targeting match input)
}
```

- Shared-section key, overridable per target. Key presence enables; no keys = no ads anywhere.
- `source: 'company'` resolves through the config company layer to the parent's api URL — sub-brands inherit the parent inventory with one word. `'self'` serves the brand's own inventory. **No hard company requirement** (Ian): a brand alone is fully functional.
- Legacy `advertising.<provider>` flat shape already converts via the existing migrate lane (`advertising.providers.*`).

## House inventory — a backend module (modern replacement for the Jekyll-file verts)

- **Firestore collection `ads`**: `{ enabled, title, description, button, link, image, footer, weight, targeting: { sites: [], categories: [], keywords: [] }, whitelist: [], blacklist: [], metadata }` — the legacy frontmatter shape, DB-backed + targeting. Public-read via routes only (no direct Firestore reads from foreign origins).
- **Selection scoring**: eligibility (enabled + white/blacklist + never-advertise-self) → contextual match score (ad `targeting` tags vs the request's `tags` — brand-configured + page context) → weighted random among the top scorers (`weight`, default 1). No tags anywhere = pure weighted shuffle (legacy behavior).
- **Inventory cache**: the serve route holds the ads collection in function memory (TTL ~5 min) — runtime serving at ~zero Firestore read cost per impression (Ian's ruling: runtime read is correct; this makes it cheap).
- **Routes** (built-in, `/omega/ads/*`):
  - `GET /omega/ads/serve?parent=<host>&…` — selection (filter enabled + white/blacklist + never-advertise-self, weighted shuffle) → the rendered unit page (self-contained HTML: card layout, dimension reporting, click postMessage). Serves from the backend's hosting surface, so 'self' needs only the backend target.
  - `GET /omega/ads/redirect?id&url` — fail-closed allowlist validation (known ad links only) → UTM'd redirect. View/click events tracked server-side (Analytics lane) — no gtag dependency inside the frame.
  - Admin CRUD rides the standard admin routes + an **admin dashboard card** (list/create/edit/toggle, image via the assets lane).
- **Company mode**: the SAME module on the parent company's backend IS the ad network (promo-server successor). Sub-brands point `source: 'company'` at it. A parent can scope inventory per sub-brand via the white/blacklists.

## Client unit — the `ads/unit` section (+ mirrored surfaces)

- `{% section "ads/unit" %}` with args: `type` (`display`/`in-article`/`in-feed`/`multiplex`/`house`), `size` preset (banner/leaderboard/rectangle/…), optional `ad_id` pin. Neutral json5 defaults; markup is context-free per §sections doctrine.
- `section.js` (§7 presence-init, shared client singleton):
  1. Lazy: IntersectionObserver arms the unit near viewport.
  2. Provider lane (FULL REWRITE — Ian: don't trust the legacy mechanics): adblock detection first (script-load failure of `adsbygoogle.js` IS the detector — no bait divs, no separate library); blocked → straight to fallback. Otherwise build the `<ins>` and await fill via a `data-ad-status` attribute observer (MutationObserver + timeout, not a 100ms poll) — `filled` → done; `unfilled`/timeout → fallback lane (if configured).
  3. Fallback lane: sandboxed iframe → resolved inhouse source's `/omega/ads/serve`; origin-validated postMessage (set-dimensions/click); HOST-side rotation + staleness recovery.
  4. Paying users: unit hides on `auth.resolved.active` via the standard bindings (legacy behavior kept).
- Desktop/extension: no AdSense (policy/no-web-context) — the shared client ships the same fallback-lane logic as an `omega.ads()` module binding `data-omega-ad` elements straight to the house/company inventory. Web section uses the same module under the hood (one implementation, three surfaces).
- `ads.txt`: web build emits it from `providers['google-adsense'].client` when present (closes the parity-gap item).

## Sequencing (proposed)

1. Backend module (collection + serve/redirect routes + tests) — provable offline via emulator.
2. Client ads module in `@omega.js/client` + the web `ads/unit` section (§7 lanes, goldens, showcase entry).
3. Admin CRUD card.
4. Desktop/extension `data-omega-ad` binding.
5. Retire `core/js/modules/vert.js`, `adunits/*` includes, the assets.js skip-guard note; blog `[slug].js` flips to the section. (DONE)
6. Company-mode proof on the playground (Paperloom serves, a second in-repo brand consumes). (DONE — root `npm run test:ads` / scripts/e2e-ads-company.js; The Daily Build carries the standing `source: 'company'` + `company.url` config)
- AdSense LIVE verification stays gated behind the real publish (Ian 2026-07-14: AdSense console needs the published site).

## Resolved questions (Ian 2026-07-20)

1. Serve surface: backend routes (`/omega/ads/serve`), runtime reads — ratified (with the in-memory cache).
2. Weight: required, default 1, composed with contextual match scoring.
3. Legacy promo-server: site stays online untouched until the ITW brands migrate to OMEGA; inventory imports into the ITW company module at that migration.

## Naming: vert (cp258, Ian's ruling 2026-07-21)

Adblock-safe naming — the ad system speaks **vert** EVERYWHERE at runtime (paths `/omega/verts/*`, DOM `data-omega-vert*`/`.omega-vert-unit`, Firestore collection `verts`, postMessage `omega-vert:*`, client `omega.verts()`/`Verts`/`VertUnit`, section `verts/unit`, admin `/admin/verts`). Only ads.txt, Google's own ad* tokens (adsbygoogle, `data-ad-*`), and the `advertising` config key say "ad". This plan file keeps its historical name.
