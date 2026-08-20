# Analytics — the catalog, the one call, and where an event fires

> Every event any OMEGA surface counts — a web page, the desktop main process, the
> extension, a Cloud Function — is declared ONCE in a catalog and fired through ONE
> call, and each provider hears it in its own dialect
> ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)).

This file is the CONTRACT, not a migration report: the package and its catalog are built
([#382](https://github.com/Omega-JS-Stack/omega/issues/382)), the web consent gate is built
([#383](https://github.com/Omega-JS-Stack/omega/issues/383)), the server-side delivery is
built ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)), and every front-end call
site now fires through the facade ([#386](https://github.com/Omega-JS-Stack/omega/issues/386)).
New code writes to what is below.

## The shape

`@omega.js/analytics` is a private workspace package — it never publishes, and prepare
vendors it into the published frameworks (the `@omega.js/account` pattern, HARD RULE 3 in
the repo map; [publishing.md](publishing.md)). It is CJS, because a Cloud Function and the
Electron main process `require()` it while the browser bundles import it with standard
interop.

| File (`packages/analytics/src/`) | What it owns |
|---|---|
| `index.js` | The facade — `event()`, `configure()`, and the fire walk |
| `catalog.js` | The SSOT: one entry per canonical event, with every provider mapping |
| `adapters/resolve.js` | The shared adapter mechanism (catalog lookup → mapping → payload) |
| `adapters/ga4.js` · `meta.js` · `tiktok.js` | One file per provider: its consent category and where attribution attaches |
| `transports/browser.js` | Executes a descriptor against the page globals, guarded ([#306](https://github.com/Omega-JS-Stack/omega/issues/306)) |
| `consent.js` | The consent seam — `createConsentGate(providerFn)`, categories, `GRANT_ALL` |
| `core.js` | GA4 Measurement Protocol semantics (client_id/user_id derivation, payload shape) |
| `logger.js` | This package's `[@omega.js/analytics:<module>]` tag ([logging.md](logging.md)) |

**The one call**, from client code and backend code alike:

```js
analytics.event('purchase', { transaction_id: id, value: 19, currency: 'USD', items: [...] });
```

One fire walks three steps per provider, in this order:

1. **consent** — a blocked category's providers never even resolve
2. **adapter** — this provider's catalog mapping, or `null` when it has none
3. **transport** — the host's seam; a missing or blocked page global is a silent no-op

Nothing in that walk throws at a visitor. A transport that could not deliver returns
`false`, and the dev log is the only trace.

**The host injects its seams** — nothing is sniffed:

```js
analytics.configure({ transport, consent, context, environment });
```

`transport` is `{ send(descriptor) => boolean }`; `consent` is a gate from
`createConsentGate`; `context` is `{ attribution, consent, runtime }`; `environment` mirrors
the client's `config.environment` seam and defaults to `'production'`. An unconfigured
runtime is INERT — it resolves and logs, and delivers nothing — never a guess at page
globals.

**Who injects what**, per runtime:

| Host | transport | consent | context | environment |
|---|---|---|---|---|
| web page (`@omega.js/web` `core/js/libs/analytics.js`) | the guarded browser transport | the banner's record, read live | attribution + `runtime: 'web'` | — |
| `@omega.js/client` | the browser transport on web; the Measurement Protocol on desktop/extension | — | `runtime` on desktop/extension | the brand's `config.environment` |
| `@omega.js/desktop` main process | its own Measurement Protocol fetch | — | `runtime: 'electron'` | the app's dev flag |
| `@omega.js/backend` | the three HTTP APIs (`libraries/analytics/conversions.js`) | the order's/user's snapshot | the order's attribution | — |

Web core reaches the package THROUGH `@omega.js/client` (`@omega.js/client/modules/analytics.js`),
never as a bare `@omega.js/analytics`: the package is private, so in a consumer install it
exists only as the copy vendored into the client's dist — and the client is a real runtime
dependency of every framework.

**A fire may also carry options**: `event(name, params, { eventId, providers })`. `eventId`
is the platform dedupe key both halves of a two-sided event name (Meta's fourth pixel
argument `eventID`, TikTok's `event_id`; GA4 has no such thing). `providers` restricts a fire
to the providers THIS side owns — which is how the two `both` events avoid double-counting.

**An unknown event name is a programmer error.** It throws in development (a typo must not
silently cost a conversion) and is logged-and-skipped in production, where the throw would
take the customer's action with it.

## The catalog contract

One entry per canonical event; callers only ever speak canonical names and canonical
params. There is no unified cross-provider signature — each adapter speaks its provider's
dialect (Ian's constraint). The canonical vocabulary is GA4-flavoured (flat params plus an
`items` array), so GA4 is pass-through and the `map()`s live where the ad platforms
genuinely disagree.

```js
add_to_cart: {
  params: ['currency', 'value', 'items'],
  placement: 'client',
  providers: {
    ga4: { name: 'add_to_cart', kind: 'standard' },
    meta: { name: 'AddToCart', kind: 'standard', map: metaCommerce },
    tiktok: { name: 'AddToCart', kind: 'standard', map: tiktokCommerce },
  },
},
```

- **`params`** — the canonical param contract; documentation for callers.
- **`placement`** — `'client' | 'server' | 'both'` (the rule below).
- **`providers`** — the per-provider mapping. Each carries `name` (the provider's NATIVE
  event name), `kind`, and an optional `map(params, context) => payload` (default:
  pass-through).

**The three mapping kinds** — and the third one is an absence:

| Kind | Meaning | What the transport does |
|---|---|---|
| `standard` | The platform defines this event | Meta `fbq('track', …)`, the platform's own event |
| `custom` | A deliberate custom event (often preserving today's data continuity, e.g. Meta `ExitPopupShow`) | Meta `fbq('trackCustom', …)` |
| *absent* | This provider has no mapping for this event | The adapter returns `null`; the facade dev-logs `skipped (no mapping)` |

**Unmapped stays unmapped.** An absent mapping is a decision, not a gap to fill: inventing a
custom event so a provider "has coverage" ships junk into an ad account nobody will ever
read. Equally, a mapping must be HONEST — several pre-OMEGA call sites claimed standard
names their platform does not define, and those are `custom` here.

**Adding an event is one catalog entry plus a test.** The entry lands in `catalog.js` under
its section, and `packages/analytics/test/catalog.test.js` gets the resolve case that proves
the mapping (name, kind, and the payload each provider receives). The shape guards —
placement valid, every mapping carrying a name and a known kind — already run over the whole
catalog, so a malformed entry fails without new test code.

**Naming.** Canonical names are snake_case and follow GA4's standard names where one exists
(`file_download`, not `download`). Action buckets stay buckets — `billing_action`,
`refund_action`, `account_section_view` carry an `action`/`section` param rather than
sprawling into an event per button. Two events that look similar are only merged when they
answer the same question: `newsletter_signup` and `status_subscribe` are deliberately
distinct.

## The placement rule

**Money and account truth fires SERVER-side. UI actions fire CLIENT-side. `sign_up` fires
BOTH.**

| Placement | Why | Examples |
|---|---|---|
| `server` | The browser cannot be trusted for revenue, and the outcome is only known where it happened | `refund`, `start_trial`, `subscription_cancelled`, `subscription_renewed`, `payment_recovered`, `user_delete` |
| `client` | The event IS the interaction — nothing server-side ever sees it | `view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `page_view`, `file_download`, the exit-popup, consent, notification-permission and account-navigation events |
| `both` | Ad platforms need the browser signal for retargeting AND the server signal for truth | `sign_up`, `purchase` |

When both halves fire, both must carry the SAME event id so the platform collapses them into
one conversion (Meta's deduplication, TikTok's `event_id`). Sending both without the id is
double-counting; sending only the server half loses the retargeting signal — which is exactly
the hole the commented-out purchase pixel left
([#302](https://github.com/Omega-JS-Stack/omega/issues/302)).

**GA4 has no cross-source deduplication**, so each `both` event names ONE owner per provider,
and the two events split it the opposite way:

| Event | The dedupe id | Browser half | Server half |
|---|---|---|---|
| `sign_up` | `sign_up.<uid>` — the uid is the only thing both sides hold before either fires | GA4 + Meta + TikTok (`libs/auth/tracking.js`) | Meta + TikTok (`events/auth/on-create.js`) |
| `purchase` | `purchase.<order id>` — the order-id branch of the webhook's own `<canonical>.<webhook event id>` derivation | Meta + TikTok (`pages/payment/confirmation/modules/tracking.js`) | GA4 + Meta + TikTok (`events/firestore/payments-webhooks/analytics.js`) |

Revenue is the server's, because a browser cannot be trusted with it; a registration's GA4
count is the browser's, because that is where the funnel it belongs to lives.

An entry's `placement` is where the rule is written down per event, so a call site in the
wrong tier is a reviewable finding, not a judgment call.

## Consent

Nothing counts before the visitor's answer is known. Two tiers, chosen by the browser's own
timezone — no network call, nothing to consent to before consent exists
(`packages/web/core/js/libs/consent-region.js`):

- **Opt-in regions (EEA + UK)**: no provider script loads until Accept, and the banner is the
  GATE that asks. Google Consent Mode's `consent default` is queued into `dataLayer` before
  gtag.js can load (denied), and every change pushes a `consent update`, so the tag itself
  honors the flags on top of us not loading it. A timezone we cannot place reads as opt-in —
  the only safe direction.
- **Everywhere else**: auto opt-in, scripts load immediately, and a first visit sees **no
  banner at all** ([#391](https://github.com/Omega-JS-Stack/omega/issues/391)) — only the
  small Cookies Settings tab, which reopens the full panel for anyone who wants to turn things
  off. There is nothing to gate and nothing worth interrupting, so `cookie_banner_show` fires
  only where the banner actually shows.

The record is `trackingConsent` in the client storage blob
(`packages/web/core/js/libs/tracking-consent.js`): `{ analytics, marketing, region,
timestamp, version }`. Two categories, because that is what a visitor can meaningfully
answer — `analytics` (GA4) and `marketing` (Meta, TikTok); "necessary" is not a category
because nothing about it is optional. Bumping `TRACKING_CONSENT_VERSION` re-prompts everyone,
which is what changing what a category COVERS requires.

- The banner is `packages/web/core/js/core/consent.js`: a cookie-iconed message, one big
  Accept, and a small Customize opening the panel — a dense legal intro, a row of pill
  switches (Necessary locked on, then Analytics and Marketing), then **Accept all / Accept
  none** bottom-right. Every switch APPLIES AND SAVES the moment it is flipped and the panel
  stays open, so there is no Save to forget to press; either button flips every switch to
  match, saves, and collapses to the tab. Refusal is one click at the same size as the grant
  (the EU equal-ease rule). The loader that actually gates the scripts is
  `packages/web/core/js/core/analytics-loader.js`, and it runs FIRST in `main.js` — nothing
  may count an event ahead of that decision.
- **A save that grants nothing IS the denial** — Accept none and an all-off panel are the
  same answer and fire the same `cookie_consent_deny`. That fire is made AFTER the record is
  written, so the gate the visitor just closed is the one it is asked about: a denial is
  honored, not counted.
- Granting a category injects its loader immediately, no reload. REVOKING cannot unload a
  running script, so it takes effect on the next page load while Consent Mode updates now.
- In the package, each adapter declares its `CONSENT_CATEGORY` and the facade asks the gate
  once per provider per event. The gate reads its provider function LIVE, so a visitor who
  accepts mid-session is counted from that moment with nothing re-configuring. The default
  when no host injects a gate is `GRANT_ALL` — desktop, extension and backend have no banner
  to gate on.
- The same consent state gates the server-side match-data enrichment
  ([#302](https://github.com/Omega-JS-Stack/omega/issues/302)): an opted-out user sends
  nothing, from either side.
- **Absence is not denial.** Server-side, a null or absent `trackingConsent` snapshot
  GRANTS both categories — only an explicit `false` blocks. Legacy orders predating the
  consent system and the raw-API recovery lane (which mints orders with no client anywhere
  near them) carry no snapshot at all, and refusing to report their revenue would be a
  silent accounting hole rather than a privacy win.

**The `consent` name is taken.** `consent` in storage and in the signup payload is the
signup form's LEGAL record (`{ legal, marketing }`, captured by
`packages/web/core/js/libs/auth/forms.js` and interpreted by the backend signup route).
Tracking consent is `trackingConsent` — key, exports, and payload field — everywhere. Sharing
one key would read a tracking answer as a revoked terms agreement.

## Attribution

Attribution is captured once and CARRIED; no event assembles its own.

- **The shape**: `attribution: { first, last, affiliate }` in client storage — first-touch
  written on the first visit ever seen and never overwritten, last-touch replaced only by a
  TAGGED visit, both timestamped (any lookback window is computed at read time).
- **Where it attaches**: the user doc at signup, `payments-intents` at creation, and
  `payments-orders` via the intent fold. The tracking-consent snapshot rides the same
  payloads under `trackingConsent`.
- **The reserved slot**: every event carries attribution through the facade's `context`, not
  through its params — `configure({ context })` → `resolve(name, params, context)` → each
  adapter attaches it the way ITS provider wants: GA4 takes campaign fields as flat event
  params, while Meta (`fbc`, `fbp`) and TikTok (`ttclid`, `ttp`) take theirs in the
  descriptor's `userData` match block, never in the event's custom data. A call site never
  hand-attaches attribution.

Capture and storage are [#384](https://github.com/Omega-JS-Stack/omega/issues/384); the
server-side delivery with full match data (hashed email/phone, IP, user agent, click ids) is
[#385](https://github.com/Omega-JS-Stack/omega/issues/385);
[#302](https://github.com/Omega-JS-Stack/omega/issues/302) owns the deep spec for both.

## Dev logging — one line per fire

In development the whole walk prints as ONE tagged line, the complete per-provider outcome
of that event:

```
[@omega.js/analytics:events] add_to_cart → ga4 sent, meta sent, tiktok skipped (consent: marketing)
```

The outcome vocabulary is the walk itself: `sent`, `skipped (consent: <category>)`,
`skipped (no mapping)`, `skipped (no transport)`, `blocked (no global)` — which is how a
blocker looks, since a blocked global is a silent no-op by contract. Production prints
nothing per fire.

This one line is the whole dev trace. It replaced web core's `setupTrackingInterceptors()`
(`packages/web/core/js/libs/dev.js`), which retired with the call-site rewire
([#386](https://github.com/Omega-JS-Stack/omega/issues/386)): monkey-patching the globals
only ever saw the calls that survived the page's own guards, while the walk above reports the
skips too, and why.

## Identity is not an event

An identity has no catalog entry, because it is not something that happened — it is a SETTING
the events after it inherit. Each provider takes its own: GA4's `set` (`user_id`, user
properties), the Meta Pixel's advanced-matching `init`, TikTok's `identify`. So it lives
beside the transport rather than inside the catalog, in exactly one module per runtime:

- **web** — `identify(user)` / `reset()` in `core/js/libs/analytics.js`, called by
  `core/js/core/auth.js` off the auth state, guarded per provider like every other page call.
  It sets GA4's user PROPERTIES, the Meta `init` and the TikTok `identify` — the RAW uid is
  correct in the last two, because `external_id` is each platform's own key. Every OTHER match
  key is SHA-256 hashed before it reaches a pixel, normalized per that platform's own spec
  (Meta hashes a phone as bare digits, TikTok as E.164), and the rules live in
  `@omega.js/analytics/identity`. Against the server's match data the EMAIL digest already
  matches exactly; the PHONE does not yet — `match-data.js` hashes digits-only for both
  providers, so its TikTok key differs from the browser's until the server converges onto the
  same helper ([#392](https://github.com/Omega-JS-Stack/omega/issues/392)).
- **every runtime** — `@omega.js/client`'s `setUserId` / `setUserProperties`, which SEND on
  web through the page's gtag and ride the Measurement Protocol payload elsewhere. The
  cross-surface value is `uuidv5(uid, namespace)`: the same human is the same `user_id` on a
  page, in the desktop app, in the extension and from a Cloud Function.

**GA4's `user_id` has exactly ONE owner: the client.** Both modules run on a web page off the
same auth transition, so a second writer is simply the last writer — and web writing the raw
uid there would leave GA4 holding an id no other surface ever sends. `identify()` therefore
sets no `user_id`, and `reset()` clears none.

The client also fires `login` / `logout` off auth state — on every runtime EXCEPT web, where
the auth pages own them, because only the call site knows the method the visitor actually
used.

## Verifying

- **The package**: `npm test` in `packages/analytics` (and the root `test:packages` lane) —
  catalog shape, per-provider resolve, the guarded transport, the consent gate, the dev log.
- **A call site**: drive the flow with a dev server running and read the fire-log line —
  that is the proof the event fired, with what, to whom. Reading the template proves nothing;
  the catalog is what decides.
- **A live drive**: the platforms' own debuggers — GA4 DebugView, Meta Events Manager's Test
  Events, the TikTok Pixel Helper — and both consent regions (an opt-in timezone must show
  nothing loading before Accept).

## Enforcement

The checklist is the plugin's `omega:analytics` skill
([agent-plugins/claude/skills/analytics/SKILL.md](../../agent-plugins/claude/skills/analytics/SKILL.md)),
and the quality hook fires it on every surface that owns an event: the web flow pages and the
auth modules, the backend payment routes and the auth/webhook events, and the package itself.
