# Ads — the `data-omega-ad` auto-bind

@omega.js/desktop renderers auto-bind the OMEGA ads system (monorepo
`plans/ads-system.md`, phase 4): drop a `[data-omega-ad]` element into any
view and the renderer bootstrap hands it to `@omega.js/client`'s ads module —
zero consumer JS, same element vocabulary as the web `ads/unit` section and
@omega.js/extension.

```html
<div data-omega-ad data-omega-ad-size="banner"></div>
```

## What the wiring does

`renderer.js _wireAds` (runs inside `manager.initialize()`, same liveness
model as the FontAwesome/tooltip wiring) binds every `[data-omega-ad]`
element present at init AND inserted later (MutationObserver), marking bound
hosts `data-omega-ad-bound="house"`. Everything after the bind lives in the
client module (`@omega.js/client/modules/ads.js`): lazy arming near the
viewport, a sandboxed iframe to the resolved in-house source's
`/omega/ads/serve`, origin-validated postMessage, host-owned rotation +
staleness recovery, and no-fill collapse (the host hides itself).

## House/company lane ONLY — no AdSense

Desktop surfaces never run the AdSense provider lane (policy: no web
context). The wiring pins `type: 'house'` on every mount — the pin wins over
the element's `data-omega-ad` type, so even a shared omega.json5 that carries
`advertising.providers['google-adsense']` (the web target uses it) can only
ever reach the house/company inventory here. Pinned by the renderer ads
suite: an AdSense-configured harness must never see an `adsbygoogle` script
or `<ins>`.

## Config

The shared `advertising` section of `config/omega.json5` flows into the
renderer via `OMEGA_BUILD_JSON` like every other section:

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
| `data-omega-ad` | binds the element (type value is ignored on desktop — house pin) |
| `data-omega-ad-size` | size preset (`banner`/`leaderboard`/`rectangle`/…) or raw px max-height |
| `data-omega-ad-id` | pin a specific ad |
| `data-omega-ad-tags` | comma-separated contextual tags for this unit |
| `data-omega-ad-bound` | set by the wiring (`"house"`) once bound — observability/debugging |

Units emit `omega-ad:fill` / `omega-ad:no-fill` / `omega-ad:click` /
`omega-ad:reload` CustomEvents on the host (bubbling) for app-side hooks.
