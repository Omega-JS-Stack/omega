# Ads — house inventory module

The backend half of the OMEGA ads system (spec: monorepo `plans/ads-system.md`): a brand (or the parent COMPANY — sub-brands point at its api) hosts its own ad inventory and serves self-contained ad units. Providers (AdSense) and the fallback ladder live in the client (`ads/unit` section) — this module is the in-house lane they fall back to.

## Firestore collection `ads`

`{ enabled, title, description, button, link, image, footer, weight (default 1), targeting: { sites: [], categories: [], keywords: [] }, whitelist: [], blacklist: [], metadata }`

Client-inaccessible by rules (the framework's default admin-only lock — proven by `test/rules/ads.js`); ALL access rides the routes.

## Routes

| Route | Auth | Behavior |
|---|---|---|
| `GET /omega/ads/serve` | public | `parent, tags, width, height, theme ('' \| light \| dark), adId` → a SELF-CONTAINED HTML ad unit (inline CSS/JS, light/dark theming, origin-checked postMessage `omega-ad:set-dimensions` via ResizeObserver + `omega-ad:click`, zero timers — the HOST owns rotation/staleness recovery), or **204 on no fill** (the host's fallback ladder moves on). The postMessage target origin PRESERVES an explicit parent port (`localhost:4100` → `http://localhost:4100` via `normalizeOrigin`) — a port-stripped origin would silently drop every report in local dev |
| `GET /omega/ads/redirect?id&parent` | public | fail-closed click hop: 302 ONLY to the ad's STORED http(s) link + `utm_source=<parent>`/`utm_medium=ad`/`utm_campaign=<adId>`; unknown id or non-http link → 404; caller-supplied URLs are never redirected to |
| `GET/POST/PUT/DELETE /omega/ads` | admin | schema-validated CRUD; PUT edits provided fields only (id/created immutable); writes bust the inventory cache |

## Selection pipeline (`routes/ads/utils.js`)

Eligibility (enabled ≠ false → whitelist [fail-closed on unknown parent] → blacklist → never-advertise-self via normalized link-host == parent-host) → optional eligible `adId` pin → contextual score (overlap count of the ad's flattened targeting tags × the request's tags; no tags anywhere = neutral) → weighted random among the TOP scorers (`weight` default 1).

## Inventory cache

Module-level, shared by serve + redirect: ~5 min TTL in production (one Firestore read per instance per interval — runtime serving at ~zero read cost per impression), TTL 0 under the emulator for determinism, `resetInventoryCache()` on every CRUD write + as the test seam. View/click events track server-side via the standard `analytics.event()` lane (no gtag inside the frame).

## Tests

`test/routes/ads/{selection,cache,serve,redirect,crud}.js` + `test/rules/ads.js` — 54 tests: scoring/eligibility, cache TTL, serve round-trip (200 HTML / 204 no-fill / XSS escaping / port-preserving target origin), redirect fail-closed + UTM, CRUD auth gates, rules lock. The cross-brand company-mode e2e (monorepo `scripts/e2e-ads-company.js`, root `npm run test:ads`) exercises the same routes through a real consumer resolution. Serve/redirect round-trips use raw `fetch` (HTML/302 can't ride the JSON `http` client — mcp-test precedent).
