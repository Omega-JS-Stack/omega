# Verts — the `data-omega-vert` auto-bind

@omega.js/extension page surfaces auto-bind the OMEGA verts (ads) system (monorepo
`docs/web/ads-system.md`, phase 4): drop a `[data-omega-vert]` element into a
popup/options/sidepanel/page view and the surface Manager hands it to
`@omega.js/client`'s verts module — zero consumer JS, same element vocabulary
as the web `verts/unit` section and @omega.js/desktop.

```html
<div data-omega-vert data-omega-vert-size="banner"></div>
```

## What the wiring does

`lib/verts.js wireAds()` (called by each page-surface Manager's `initialize()`
after `omega.initialize()`) binds every `[data-omega-vert]` element present at
boot AND inserted later (MutationObserver), marking bound hosts
`data-omega-vert-bound="house"`. Everything after the bind lives in the client
module (`@omega.js/client/modules/verts.js`): lazy arming near the viewport, a
sandboxed iframe to the resolved in-house source's `/omega/verts/serve`,
origin-validated postMessage, host-owned rotation + staleness recovery, and
no-fill collapse (the host hides itself).

**Content scripts, background, and offscreen do NOT auto-bind.** Content
scripts follow the `lib/icons.js` rule — scanning a HOST page's DOM would
mount verts into arbitrary websites; background/offscreen have no user-facing
DOM.

## House/company lane ONLY — no AdSense

Extension surfaces never run the AdSense provider lane (store policy — and
the scaffolded MV3 `extension_pages` CSP blocks the remote script anyway).
The wiring pins `type: 'house'` on every mount — the pin wins over the
element's `data-omega-vert` type, so even a shared omega.json5 that carries
`advertising.providers.adsense` (the web target uses it) can only
ever reach the house/company inventory here. Pinned by the build-layer
`verts-binding` suite.

## Config

The `advertising` and `company` sections of `config/omega.json5` ride the
build snapshot (`OMEGA_BUILD_JSON`, baked into every bundle) into every surface:

```json5
advertising: {
  providers: {
    inhouse: { source: 'company' },  // 'self' | 'company' | full URL
  },
  tags: ['music', 'audio-tools'],    // contextual targeting inputs
}
```

No `advertising` key (or no resolvable inhouse source) → bound units collapse
quietly. Nothing else to configure.

## Element vocabulary

| Attribute | Meaning |
|---|---|
| `data-omega-vert` | binds the element (type value is ignored in extensions — house pin) |
| `data-omega-vert-size` | size preset (`banner`/`leaderboard`/`rectangle`/…) or raw px max-height |
| `data-omega-vert-id` | pin a specific vert |
| `data-omega-vert-tags` | comma-separated contextual tags for this unit |
| `data-omega-vert-bound` | set by the wiring (`"house"`) once bound — observability/debugging |

Units emit `omega-vert:fill` / `omega-vert:no-fill` / `omega-vert:click` /
`omega-vert:reload` CustomEvents on the host (bubbling) for app-side hooks.
