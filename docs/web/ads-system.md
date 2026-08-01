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
    adsense: {
      client: 'ca-pub-XXXX',            // feeds the ad tag AND ads.txt (SSOT)
      displaySlot: '…', inArticleSlot: '…', inFeedSlot: '…', multiplexSlot: '…',
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
- **One unit document, one renderer**: every vert unit document comes from `@omega.js/client`'s `modules/vert-document.js` — the serve route maps a stored vert onto it (the backend holds no template of its own; the CJS route pulls the ESM module in by dynamic import), and the client's terminal promo lane calls the same function with the house promo data. The look is one media row: thumbnail left, title with a clamped muted description, a hairline, then a muted label ('Sponsored', or the vert's own footer) on the left and the accent CTA button on the right. The card is content-sized — its natural height IS the card height, and the slot preset stays a ceiling the host clamps to, never a floor the card stretches into. A short or narrow slot tightens the row (smaller thumbnail, no description) on a spacing budget that keeps the compact card under the leaderboard ceiling — the shortest preset, the one a taller card would be cropped by; a skyscraper-shaped slot stacks. Colours are literal pairs per theme inside the document; the accent pair is an option, defaulting to neutral ink for served verts and passing the omega indigo for the promo. Every field from vert data is escaped; the single trusted-markup slot (the thumbnail) takes framework constants only. The document declares `color-scheme` (both modes when it follows the OS, the pinned one when a theme is passed) so the canvas the browser falls back to whenever it rasterizes the frame without the root's transparency — first paint, a re-raster on scroll or zoom — matches the card instead of defaulting to light-mode white, which is what showed as white corner notches around the card's radius and a sliver under its bottom edge. The card owns ALL the chrome (background, border, radius) and the host is invisible — the `.omega-vert-unit` element and any theme sheet carry no surface, no radius and no clipping, so the visible box IS the card. Sizing follows from the same rule: the document reports its CARD box (never `documentElement`, which can never measure shorter than the frame it fills), and the host shrinks the frame to it.
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
- `ads.txt`: web build emits it from `providers.adsense.client` when present (closes the parity-gap item).

### Automatic placements (#44 items 24/25, 2026-07-31)

- The AUTOMATIC placements — blog post in-article unit, blog index in-feed unit, mid-article insertion (`[slug].js`, every 4th paragraph), and the dashboard rail slot — are build-time gated on `site.advertising`: no advertising config, zero vert markup. Hand-authored `{% section "verts/unit" %}` calls stay ungated — an author who writes the tag asked for it.
- A post opts out with `verts: false` frontmatter: suppresses the layout unit and stamps `data-omega-verts="false"` on the article, which the mid-article inserter honors.
- The dashboard rail slot keys on the sidebar data's `bottom.vert.enabled` AND `site.advertising`; the admin sidebar carries no bottom block, so staff surfaces stay vert-free.
- Visual QA: `/test/libraries/verts` shows every format and size preset with the literal producing tag and a config-state banner.
- **A unit follows the PAGE's theme, not the OS**: mount reads `data-bs-theme` off the root element and passes it into both lanes — the house serve URL's `theme` param and the promo document's `data-theme` stamp — so a site toggled dark on a light machine renders dark cards. A host's own `data-omega-vert-theme` pins the frame and wins; nothing stamped anywhere leaves the frame on its own `prefers-color-scheme` branch. A flip AFTER render re-stamps every live promo frame from one `MutationObserver` on that attribute (a `srcdoc` assignment, zero network); a house frame keeps the theme it mounted with, because re-theming it would mean re-fetching it.

- **The ladder ends in the promo, never in nothing** (Ian's QA ruling 2026-07-31): when every configured lane fails (provider no-fill/blocked AND the fallback source unresolvable or unreachable), the unit renders the built-in omegajs.dev promo at the slot's reserved size. The promo is a REAL unit, not a stub: the same sandboxed iframe (`title="Sponsored"`, the house sandbox set minus `allow-same-origin`, which a srcdoc frame cannot safely carry), the same `omega-vert:set-dimensions` / `omega-vert:click` postMessage vocabulary, the same host-owned sizing and max-height clamp, and the same `target="_blank" rel="noopener noreferrer sponsored"` link contract the backend-served unit uses. Its document comes from the SAME renderer a served vert's does (`@omega.js/client`'s `modules/vert-document.js`) — only the trusted inline-svg thumbnail and the indigo accent are promo-specific. The difference is delivery: the document arrives inline by `srcdoc`, so the lane makes ZERO network requests and carries literal colours per theme (css variables do not cross the frame boundary, so it holds in light, dark, and on an unthemed page). Because a sandboxed srcdoc frame posts with origin `null`, the host validates the promo frame by `contentWindow` identity; the house lane's origin check is untouched. `omega-vert:no-fill` still fires first (nothing was sold), then `omega-vert:promo`. A unit never renders empty.

### Click tracking and UTM (#44, Ian's QA 2026-07-31)

- **Every click destination is UTM-tagged automatically**, both lanes, through one tagger: `applyVertUtm` in `@omega.js/client`'s `modules/vert-document.js`. The promo lane tags its own `https://omegajs.dev` link in the browser (`utm_source=<the host page's hostname>`, `utm_medium=omega-vert`, `utm_campaign=omega-promo`, `utm_content=<the slot's size preset>`); a served vert is tagged by the backend redirect route on the STORED link (`utm_source=<parent host>`, `utm_medium=omega-vert`, `utm_campaign=<vert id>`), which is where the final destination is known and where the parent host already arrives as `?parent=`.
- **Existing params win.** The tagger only fills keys the URL does not already carry, so an advertiser's own tagging survives verbatim and nothing double-appends. Non-http(s) or unparseable values come back untouched.
- **Analytics fires HOST-side, on the click message.** Analytics cannot run inside a cross-origin frame, which is why the legacy stack bounced every click through a top-level forward page (`/verts/redirect`) that fired a `vert_redirect` gtag event, waited on the event callback, and only then navigated. The new unit already forwards clicks OUT of the frame, so the host handles it: on `omega-vert:click` the host fires `vert_click` through this brand's own `@omega.js/client` analytics with `vert_id`, `vert_lane` (`house`/`promo`), `vert_campaign`, `vert_slot`, and `vert_source`. **There is no forward page and there never will be one** — no interstitial, no navigation delay, and the server-side `verts/redirect` analytics event still records the same click from the other end.

## Sequencing (proposed)

1. Backend module (collection + serve/redirect routes + tests) — provable offline via emulator.
2. Client ads module in `@omega.js/client` + the web `ads/unit` section (§7 lanes, goldens, showcase entry).
3. Admin CRUD card.
4. Desktop/extension `data-omega-ad` binding.
5. Retire `core/js/modules/vert.js`, `adunits/*` includes, the assets.js skip-guard note; blog `[slug].js` flips to the section. (DONE)
6. Company-mode proof on the playground (Paperloom serves, a second in-repo brand consumes). (DONE — root `npm run test:verts` / scripts/e2e-verts-company.js; The Daily Build carries the standing `source: 'company'` + `company.url` config)
- AdSense LIVE verification stays gated behind the real publish (Ian 2026-07-14: AdSense console needs the published site).

## Resolved questions (Ian 2026-07-20)

1. Serve surface: backend routes (`/omega/ads/serve`), runtime reads — ratified (with the in-memory cache).
2. Weight: required, default 1, composed with contextual match scoring.
3. Legacy promo-server: site stays online untouched until the ITW brands migrate to OMEGA; inventory imports into the ITW company module at that migration.

## Naming: vert (cp258, Ian's ruling 2026-07-21)

Adblock-safe naming — the ad system speaks **vert** EVERYWHERE at runtime (paths `/omega/verts/*`, DOM `data-omega-vert*`/`.omega-vert-unit`, Firestore collection `verts`, postMessage `omega-vert:*`, client `omega.verts()`/`Verts`/`VertUnit`, section `verts/unit`, admin `/admin/verts`). Only ads.txt, Google's own ad* tokens (adsbygoogle, `data-ad-*`), and the `advertising` config key say "ad". This plan file keeps its historical name.
