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
- **HTML Attr**: `data-wm-bind`
- **Actions**: `@text`, `@value`, `@show`, `@hide`, `@attr`, `@style`
- **Deep reference**: [bindings.md](bindings.md) — comma syntax, condition operators, state paths, skeleton loaders, root-key filtering

## Firestore (`firestore.js`)

- **Class**: `Firestore`
- **Key Methods**: `doc(path)`, `collection(path)`
- **Doc Methods**: `.get()`, `.set()`, `.update()`, `.delete()`
- **Query Methods**: `.where()`, `.orderBy()`, `.limit()`, `.startAt()`, `.endAt()`

## Notifications (`notifications.js`)

- **Class**: `Notifications`
- **Key Methods**: `isSupported()`, `isSubscribed()`, `subscribe()`, `unsubscribe()`, `getToken()`, `onMessage()`
- **Storage**: Saves to localStorage and Firestore

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

## Motion (`motion.js`)

- **Exports**: `createMotion()`, `parseCountTarget(text)`, `formatCount(target, value)`
- **Pattern**: transport-free factory like icon-renderer — not a singleton module; each embedding framework boots it (`@omega.js/web` does in `core/js/core/motion.js`)
- **Engine surface**: `start(doc?)` (idempotent scan + IntersectionObserver + MutationObserver + scroll watcher), `stop()`, `scan(root)` for manually rendered roots
- **Attribute contract** (styled by the embedding framework's motion stylesheet): `data-omega-reveal[="up|fade|left|right|scale"]`, `data-omega-reveal-stagger`, `data-omega-countup`, `data-omega-rotate`, `data-omega-marquee` (+ `.omega-marquee__track` — the set is cloned until half the track covers the container; attr value = px/s), `data-omega-scroll-watch`, `data-omega-segmented` (gliding `.omega-segmented__thumb` under the checked/`.active` segment), `data-omega-dotfield` (canvas dot grid: traveling wave + accent tint + pointer glow; attr value = px spacing)
- **Resilience**: no-JS pages render visible (the hiding styles are gated on an inline `html[data-omega-motion]` stamp); `prefers-reduced-motion` renders final states with no animation; missing observers (exotic embeds) degrade to instant reveal
