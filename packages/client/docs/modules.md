# Module Quick Reference

## Storage (`storage.js`)

- **Class**: `Storage`
- **Key Methods**: `get(path, default)`, `set(path, value)`, `remove(path)`, `clear()`
- **Session**: Same methods under `.session` namespace
- **Storage Key**: `_manager` in localStorage

## Auth (`auth.js`)

- **Class**: `Auth`
- **Key Methods**: `listen(options, callback)`, `isAuthenticated()`, `getUser()`, `signInWithEmailAndPassword()`, `signOut()`, `getIdToken()`, `resolveSubscription(account?)`
- **Bindings**: Updates `auth` and `usage` context on auth settle
- **Usage Resolution**: `_resolveUsage(state)` merges `account.usage` (Firestore) with product limits from `config.payment.products` (OMEGA-canonical shape — same key name in @omega.js/backend, UJM, and @omega.js/desktop) to produce the `usage` bindings key (e.g., `{ credits: { monthly: 5, limit: 100 } }`)

### resolveSubscription(account?)

Derives calculated subscription fields from raw account data. Returns only fields that require derivation logic — raw data (product.id, status, trial, cancellation) lives on `account.subscription` directly.

```javascript
const resolved = auth.resolveSubscription(account);
// Returns: { plan, active, trialing, cancelling }
```

- `plan`: Effective plan ID the user has access to RIGHT NOW (`'basic'` if cancelled/suspended)
- `active`: User has active access (active, trialing, or cancelling — all mean the user can use the product)
- `trialing`: In an active trial (status `'active'` + `trial.claimed` + unexpired `trial.expires`)
- `cancelling`: Cancellation pending (status `'active'` + `cancellation.pending` + NOT trialing)

**Unified with @omega.js/backend**: The same function exists on `User.resolveSubscription(account)` in @omega.js/backend (`helpers/user.js`) with identical logic and return shape.

### Auth Settler Pattern

Auth uses a promise-based settler (`_authReady`) that resolves once Firebase's first `onAuthStateChanged` fires — the moment auth state is guaranteed (authenticated user OR null). This eliminates race conditions.

- **`once` listeners** (`listen({ once: true }, cb)`): Wait for `_authReady`, fire once, done. No cleanup needed.
- **Persistent listeners** (`listen({}, cb)`): Subscribe to `_authStateCallbacks`. If auth already settled when registered, catch up via `_authReady.then()`. Otherwise, `_handleAuthStateChange` handles the initial call naturally.
- **`_hasProcessedStateChange`**: Ensures bindings/storage updates run only once per auth state change across all listeners.
- **Manager owns the promise**: `_authReady` and `_authReadyResolve` live on the Manager instance. The `onAuthStateChanged` callback in `index.js` resolves it on first fire and sets `_firebaseAuthInitialized = true`.

## Bindings (`bindings.js`)

- **Class**: `Bindings`
- **Key Methods**: `update(data)`, `getContext()`, `clear()`
- **HTML Attr**: `data-omega-bind`
- **Actions**: `@text`, `@value`, `@show`, `@hide`, `@attr`, `@style`
- **Deep reference**: [bindings.md](bindings.md) — comma syntax, condition operators, state paths, skeleton loaders, root-key filtering

## Request (`request.js`) — harmonized API fetch

- **Singleton API**: `await omega.request('/omega/user/token', { method: 'POST', body: {} })`
- **Options**: `method` (default GET), `headers`, `body` (objects JSON-encoded automatically), `auth: false` (skip the Bearer token for public routes), `output: 'complete'` (returns `{ status, ok, headers, data, properties }` instead of just the body)
- **Behavior**: leading-`/` paths resolve through `getApiUrl()`; absolute URLs pass through. A fresh Firebase ID token rides as `Authorization: Bearer` when signed in. Non-ok responses THROW an `Error` carrying `.code` (HTTP status), `.data` (parsed body), and `.properties`.
- **omega-properties**: the backend assistant attaches this header (code, tag, usage current+limits, schema, additional) to every response; `omega.request()` parses it on success AND error, and merges server usage into the `usage` bindings key — `data-omega-bind` elements refresh automatically.
- **Standalone**: non-singleton contexts (desktop main, extension service worker) build their own via `createRequest({ getApiUrl, getIdToken, onProperties })` from `@omega.js/client/modules/request.js` — the desktop client-bridge and the extension background token sync both do.

## Device (`device.js`) — local device stats

- **Class**: `Device` (`omega.device()`)
- **Key Methods**: `getUsageDuration(unit)`, `getSessionDuration(unit)`, `getInstalledDate()`, `getSessionCount()`, `getBindingData()`, `reset()`
- **Storage**: localStorage (web) or extension storage, key `omega_device`
- **Bindings**: seeds the `device` key on initialize (installed / session / version / duration) — distinct from the server-derived `usage` key (see [bindings.md](bindings.md))

## Firestore (`firestore.js`)

- **Class**: `Firestore`
- **Key Methods**: `doc(path)`, `collection(path)`
- **Doc Methods**: `.get()`, `.set()`, `.update()`, `.delete()`
- **Query Methods**: `.where()`, `.orderBy()`, `.limit()`, `.startAt()`, `.endAt()`

## Notifications (`notifications.js`)

- **Class**: `Notifications`
- **Key Methods**: `isSupported()`, `isSubscribed()`, `subscribe()`, `unsubscribe()`, `getToken()`, `onMessage()`
- **Storage**: Saves to localStorage and Firestore
- **VAPID key**: resolved from `config.cloud.messaging.vapidKey` (the omega.json5 home; the web engine bridges it into the `firebase.messaging.config.vapidKey` contract shape too). Public by design.

## ServiceWorker (`service-worker.js`)

- **Class**: `ServiceWorker`
- **Key Methods**: `isSupported()`, `register()`, `ready()`, `postMessage()`, `onMessage()`, `getState()`, `unregisterAll()`
- **Registration policy**: `serviceWorker.enabled` (default true) registers at
  scope `/` with `updateViaCache: 'none'` on every init — dev included (the
  worker is how push/caching get tested locally, and same-scope registration
  is what replaces a DIFFERENT project's worker left on the same localhost
  port). `enabled: false` calls `unregisterAll()` instead — the origin is
  swept clean, never left to a stale foreign worker.

## Sentry (`sentry.js`)

- **Class**: `Sentry` (named `mod` internally)
- **Key Methods**: `init(config)`, `captureException(error, context)`
- **Filtering**: Blocks dev mode, Lighthouse, Selenium/Puppeteer

## DOM (`dom.js`)

- **Exports**: `loadScript(options)`, `ready()`
- **loadScript Options**: src, async, defer, crossorigin, integrity, timeout, retries

## Utilities (`utilities.js`)

- **Exports**: `clipboardCopy()`, `escapeHTML()`, `showNotification()`, `getPlatform()`, `getBrowser()`, `getRuntime()`, `isMobile()`, `getDevice()`, `getContext()`

## Verts (`verts.js`) — adblock-safe ad engine

- **Class**: `Verts` (+ `VertUnit` per mounted house unit)
- **Key Methods**: `render($el, options)` (the full ladder), `renderHouse($el, options)` (fallback lane directly — the desktop/extension lane), `mount($el, options?)` (lazy IntersectionObserver arm from `data-omega-vert*` attributes, idempotent), `bind(root?)` (auto-mount every `[data-omega-vert]`), `resolveSource(source?)`
- **The ladder** (plans/ads-system.md, monorepo): AdSense when `advertising.providers['google-adsense'].client` is configured and the type is a provider type — script-load failure of `adsbygoogle.js` IS the adblock detector (no bait divs, no poll); fill awaited via a MutationObserver on `data-ad-status` + timeout; `unfilled`/timeout/blocked → the `advertising.fallback` lane (`'inhouse'`) → no-fill collapse (`display: none` + `omega-vert:no-fill`)
- **House lane**: sandboxed iframe → `<source>/omega/verts/serve` (`parent`, `tags`, `vertId`, `height`, `theme`, cache-buster); origin-validated postMessage vocabulary `omega-vert:set-dimensions` / `omega-vert:click`; HOST-owned lifecycle — rotation timer (`rotateInterval`, off by default), staleness recovery (`visibilitychange`/`online` → reload when stale), fill timer
- **Source resolution** (`advertising.providers.inhouse.source`): `'self'` → `getApiUrl()`, `'company'` → `config.company.url` through the api derivation, full URL → verbatim
- **Element vocabulary**: `data-omega-vert` (type: `display`/`in-article`/`in-feed`/`multiplex`/`house`), `data-omega-vert-size` (preset or px), `data-omega-vert-id`, `data-omega-vert-tags` — the web `verts/unit` section and the phase-4 desktop/extension binding share it
- **Events**: `omega-vert:fill` / `omega-vert:no-fill` / `omega-vert:click` / `omega-vert:reload` bubble from the host (+ `onFill`/`onNoFill`/`onClick`/`onReload` callbacks)

## Motion (`motion.js`)

- **Exports**: `createMotion()`, `parseCountTarget(text)`, `formatCount(target, value)`
- **Pattern**: transport-free factory like icon-renderer — not a singleton module; each embedding framework boots it (`@omega.js/web` does in `core/js/core/motion.js`)
- **Engine surface**: `start(doc?)` (idempotent scan + IntersectionObserver + MutationObserver + scroll watcher), `stop()`, `scan(root)` for manually rendered roots
- **Attribute contract** (styled by the embedding framework's motion stylesheet): `data-omega-reveal[="up|fade|left|right|scale"]`, `data-omega-reveal-stagger`, `data-omega-countup`, `data-omega-rotate`, `data-omega-marquee` (+ `.omega-marquee__track` — the set is cloned until half the track covers the container; attr value = px/s), `data-omega-scroll-watch`, `data-omega-segmented` (gliding `.omega-segmented__thumb` under the checked/`.active` segment), `data-omega-dotfield` (canvas dot grid: traveling wave + drifting rainbow tint + window-tracked pointer glow; attr value = px spacing)
- **Resilience**: no-JS pages render visible (the hiding styles are gated on an inline `html[data-omega-motion]` stamp); `prefers-reduced-motion` renders final states with no animation; missing observers (exotic embeds) degrade to instant reveal
