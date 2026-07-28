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

- **Exports**: `clipboardCopy()`, `escapeHTML()`, `sanitizeURL()`, `renderMarkdown()`, `showNotification()`, `getPlatform()`, `getBrowser()`, `getRuntime()`, `isMobile()`, `getDevice()`, `getContext()`
- **escapeHTML(input)**: walks strings, arrays and objects recursively; escapes `& < > " '` (quotes too, so an escaped value is safe inside an attribute). Non-strings pass through.
- **sanitizeURL(url)**: returns the URL unchanged when it resolves to `http:`/`https:`, `''` for every other scheme (`javascript:`, `data:`, …).

### renderMarkdown(text)

Untrusted text as safe markup — an escape-first mini renderer for API answers and user-supplied prose (ported from the workkit tower's issue dialog). It composes the two helpers above rather than owning escaping: the source is escaped ONCE up front and every rule then works on that escaped string, so no rule can resurrect a `<script>` that is already `&lt;script&gt;`.

- **Grammar**: `#`–`######` headings, fenced blocks (```` ``` ````), inline code, `-`/`*` bullet and `1.`/`1)` numbered lists, `**bold**`, `*italic*`, and `[label](href)` links. Anything else renders as the text it was — it is not a markdown engine.
- **Links**: `sanitizeURL` gives the scheme verdict and the href must additionally be absolute `http(s)` — a `javascript:`/`data:`/relative href leaves the bracket text as text, never an anchor. Built anchors are stashed behind a NUL sentinel while the emphasis rules run, so an href holding asterisks survives untouched. Anchors carry `target="_blank" rel="noopener"`.
- **Output shape**: headings render three levels down (`#` → `<h4 class="h6 mt-3 mb-2">`, floored at `h6`) so a rendered fragment never competes with its host page's title; fenced blocks render `<pre class="p-2 rounded"><code>` (Bootstrap utilities, same idiom as `showNotification`).
- **Edges**: empty/whitespace/`null` input returns `''` (the caller says what empty means); an unterminated fence still renders its content.

## Live Page (`live-page.js`) — the self-refreshing page primitives

- **Exports**: `loading(message)`, `swap(host, markup)`, `createFeedPoller(options)`
- **Pattern**: transport-free standalone module (like `motion`) with the deps-injected seam `request` uses — the page boots it and hands it a fetcher; there is no singleton coupling. Ported from the workkit tower's page runtime.
- **`swap($host, markup)`**: writes `innerHTML` ONLY when the markup differs from what swap itself last wrote (a WeakMap keyed by the element), so an unchanged section keeps its DOM, focus, scroll position and open `details` across a poll. The comparison never reads `host.innerHTML` back — the browser re-serializes what it parses, so a read-back never matches the string that produced it and every tick would count as a change. Returns `true` when it wrote, which is what post-draw work (charts, listeners) hangs off.
- **`loading(message)`**: the spinner line a section shows while its feed has never answered — a first paint says which read it is waiting on instead of drawing an empty region. The message is escaped through `utilities.escapeHTML`.
- **`createFeedPoller({ feeds, fetcher, onChange })`**: `feeds` is the declared table (`{ name: { path, every, fresh? } }` — `fresh` is the cache-bypass path a user-triggered refresh uses); `fetcher` is an `omega.request`-shaped function (resolves with the body, throws an `Error` carrying `.code`), so a page passes `omega.request` and a non-singleton context passes its own `createRequest(...)`; `onChange` fires at every state transition (a read starting, a read landing) and is where the page repaints.
- **Poller surface**: `state` (`{ feeds, pending, stamp }`), `read(name, fresh)`, `readAll(fresh)`, `staleFeeds()`, `start()` (first pass, then arms one interval per feed; idempotent), `stop()`.
- **Feed result shape**: `{ ok, data, status, reason }` — `status` is the thrown error's `.code` (null for a transport failure), `reason` its message.
- **Keep-last-good**: a refresh that fails does NOT clear the page — the last good result stays in `state.feeds[name]` with a `stale` key naming why the refresh missed. A feed that has never answered simply carries its own latest failure. `staleFeeds()` returns `[{ name, reason }]` for both cases, which is what a chrome bar's "N feeds unavailable" chip draws from.
- **`state.pending`**: how many reads are in flight — a refresh is visible while it happens and the page under it keeps showing the data it already has.

## Verts (`verts.js`) — adblock-safe ad engine

- **Class**: `Verts` (+ `VertUnit` per mounted house unit)
- **Key Methods**: `render($el, options)` (the full ladder), `renderHouse($el, options)` (fallback lane directly — the desktop/extension lane), `mount($el, options?)` (lazy IntersectionObserver arm from `data-omega-vert*` attributes, idempotent), `bind(root?)` (auto-mount every `[data-omega-vert]`), `resolveSource(source?)`
- **The ladder** (docs/web/ads-system.md, monorepo): AdSense when `advertising.providers['google-adsense'].client` is configured and the type is a provider type — script-load failure of `adsbygoogle.js` IS the adblock detector (no bait divs, no poll); fill awaited via a MutationObserver on `data-ad-status` + timeout; `unfilled`/timeout/blocked → the `advertising.fallback` lane (`'inhouse'`) → no-fill collapse (`display: none` + `omega-vert:no-fill`)
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
