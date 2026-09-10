# Analytics

GA4 Measurement Protocol with cross-platform identity. The same human gets unified events across desktop (@omega.js/desktop), web (UJM/@omega.js/client), and backend (@omega.js/backend) — provided all four reference the same Firebase project ID.

## How identity works

Every event ships with two GA4 fields:

- **`client_id`** — uniquely identifies a *desktop install*. Stable per-install, anonymous.
- **`user_id`** — uniquely identifies a *human*. Set when the user is signed in via Firebase Auth. It rides **alongside** the `client_id`, never in place of it: GA stitches sessions by the client id.

@omega.js/desktop derives both via `uuidv5(input, namespace)` where:

- `namespace = uuidv5(cloud.config.projectId, uuidv5.URL)` — same projectId in @omega.js/backend/UJM/@omega.js/client → same namespace everywhere.
- `client_id = uuidv5(deviceId, namespace)` — the `deviceId` comes from the ONE shared derivation, `@omega.js/analytics`' `deriveDeviceId` ([#396](https://github.com/Omega-JS-Stack/omega/issues/396)), with desktop injecting its storage and its MAC seed ([context.md](context.md)).
- `user_id = uuidv5(firebaseUid, namespace)` — set automatically when `omega.onAuthChange` fires with a uid; cleared on logout.

Why this matters: the same Firebase user signing into the desktop app, the web app, and triggering backend events produces **identical `user_id` values** in every Measurement Protocol call. GA4 stitches the events into one user journey across all surfaces.

What does NOT cross surfaces is the machine. The desktop app's deviceId lives in electron-store and a browser's lives in that browser's localStorage, so one machine is two `client_id`s — the human is the link, and always was.

## Config

```jsonc
analytics: {
  enabled: true,                                      // default true
  providers: {
    google: {
      id: 'G-XXXXXXXXXX',                             // Measurement ID — REQUIRED
    },
  },
}
```

The API secret is read from `process.env.GOOGLE_ANALYTICS_SECRET` — never committed. Mirrors @omega.js/backend's convention.

### Local dev

Add to `.env`:

```bash
GOOGLE_ANALYTICS_SECRET=your_secret_here
```

Mint the secret in GA4 Admin → Data Streams → your stream → **Measurement Protocol API secrets**.

### Production builds

The `bundle` task's esbuild `define` bakes `process.env.GOOGLE_ANALYTICS_SECRET` into the bundled main process at build time, so packaged apps don't need `.env` at runtime. The build runs with the secret set (CI does this via the GitHub Actions secret pushed by `mgr push-secrets`).

## API

```js
manager.analytics.event('button_click', { button_id: 'cta' });
manager.analytics.pageview('/settings');
manager.analytics.screenview('SettingsScreen');
manager.analytics.setUserProperties({ plan: 'premium', trial: false });
manager.analytics.setUserId('firebase-uid-abc');   // usually wired automatically
```

Same surface in renderer:

```js
window.desktop.analytics.event('button_click', { button_id: 'cta' });
window.desktop.analytics.pageview('/settings');
window.desktop.analytics.setUserProperties({ plan: 'premium' });
const status = await window.desktop.analytics.getStatus();   // { enabled, measurementId, clientId, userId, queueLength }
```

The renderer surface is fire-and-forget IPC (`ipcRenderer.send`) for events; only `getStatus` round-trips via `invoke`.

## The renderer NEVER sends — it forwards ([#411](https://github.com/Omega-JS-Stack/omega/issues/411))

A renderer's own `omega.analytics().event(...)` — the embedded @omega.js/client, the surface a vert click or a permission prompt fires through — routes to the bridge above and is delivered by the MAIN process's sender. There is exactly one sender per install:

```
renderer: omega.analytics().event('vert_click', { … })
  → @omega.js/client reads config.analyticsBridge (src/renderer.js injects the
    preload's window.desktop.analytics when it boots the client)
  → ipcRenderer.send('desktop:analytics:event', { name, params })
  → main: analytics.event(name, params) → catalog → Measurement Protocol
```

The bridge is **injected, never sniffed**: the client reads that one config key and no global, so a page that merely carries a `window.desktop` can never route a brand's analytics into a void.

Main owns identity end to end: the device id from electron-store, the session id minted once per launch, the real engagement time, and the app's `page_location` / `page_title` (a renderer's `file://` href is not GA's business). Only the canonical name and the caller's params cross.

What does NOT cross the bridge:

- **The fire's `options`** (`{ eventId, providers }`) — they exist to deduplicate a browser pixel against its server-side half, and GA4 through main is the one lane a desktop window has.
- **The page data** the web path merges in (`page_path` / `page_title` / `page_location`) — main supplies the app's own.

What the bridged client does NOT do: mint a `client_id` of its own (no `localStorage._omega_device_id` in a desktop renderer), hold an api_secret, or fire `login` / `logout` — main's auth bridge already fires those off the same Firebase user, and a second pair would double-count every sign-in.

An uncatalogued event name never leaves the renderer: the catalog check runs before the forward, so a typo throws at the call site in development (and is logged-and-skipped in a packaged app) instead of surfacing as an unattributable warning in main's `runtime.log`. A forward that IPC cannot carry (a non-cloneable param) is warned about, never thrown at the user mid-action.

> 🚫 **Never inject `GOOGLE_ANALYTICS_SECRET` into a renderer's config.** Desktop's config carries the measurement id alone. A renderer with its own secret would become a second Measurement Protocol sender with its own device id and its own session id — one install counted as two GA clients ([#396](https://github.com/Omega-JS-Stack/omega/issues/396) class). The client backs the rule with a guard: a bridged renderer drops any secret handed to it.

## Auto-fired events

| Event | When | Notes |
|---|---|---|
| `app_launch` | At end of `analytics.initialize()` (main process) | Fires once per launch |
| `login` | On `omega.onAuthChange({uid: ...})` transition from null → uid | `params.method = providerId` |
| `logout` | On `omega.onAuthChange({uid: null})` after a previous uid | — |

## Queueing

Calls before init complete are queued (up to 200 events). On init, the queue is drained. After init, calls send immediately.

## Disabled paths

`analytics._enabled = false` whenever:

- `config.analytics.enabled === false`
- No measurement ID configured
- No `GOOGLE_ANALYTICS_SECRET` env var

In all three cases, `event()` is a silent no-op (no throws, no warns past init).

## Event names come from the catalog

`event(name, params)` takes a CANONICAL name from `@omega.js/analytics`' shared
catalog — the same vocabulary the web pages, the extension and the Cloud
Functions speak ([docs/shared/analytics.md](../../../docs/shared/analytics.md)).
The catalog's GA4 mapping decides the native name and payload; this module keeps
only what is desktop's: the Measurement Protocol transport, the pre-init queue,
the session/engagement enrichment, and the IPC bridge (unchanged — the preload
API is byte-compatible).

A name no catalog entry declares is a programmer error: it throws in development
and is logged-and-skipped in a packaged app, where a throw would take the user's
action with it. Adding an event is one catalog entry plus its test, never a
free-typed string here.

## Tests

- `src/test/suites/main/analytics.test.js` — disabled paths, uuidv5 stability, the catalog contract (canonical name in, GA4 descriptor out; unknown names never post), queueing, auth-bridge wiring, IPC handlers, secret-not-leaked guard.
- `src/test/suites/renderer/analytics-bridge.test.js` — renderer-side surface shape, `getStatus` round-trip, and the #411 pin: a renderer-originated `omega.analytics().event(...)` reaches main's sender exactly once, and the payload GA would receive carries main's `client_id` and main's session id, while the bridged client holds no secret and no device id of its own (the harness hands it credentials on purpose). The harness taps main's transport (`harness/main-entry.js`) so a renderer suite can read back what the sender was handed — a test run never reaches a real GA property. Harness fidelity, stated plainly: it drives the real client and the real IPC channel into the real main-process sender, but the client runs in the preload world holding the bridge object directly, not the contextBridge proxy a page bundle gets — the proxy hop is the one link this pin does not exercise.
- `packages/client/test/analytics.test.js` — the client half: the bridge is the injected config value alone (a planted `window.desktop` bridges nothing), a bridged client drops credentials and mints no device id, an uncatalogued name never leaves the renderer, and a forward that throws never reaches the caller.
