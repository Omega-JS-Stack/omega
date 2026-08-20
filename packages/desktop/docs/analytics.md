# Analytics

GA4 Measurement Protocol with cross-platform identity. The same human gets unified events across desktop (@omega.js/desktop), web (UJM/@omega.js/client), and backend (@omega.js/backend) — provided all four reference the same Firebase project ID.

## How identity works

Every event ships with two GA4 fields:

- **`client_id`** — uniquely identifies a *device install*. Stable per-install, anonymous.
- **`user_id`** — uniquely identifies a *human*. Set when the user is signed in via Firebase Auth.

@omega.js/desktop derives both via `uuidv5(input, namespace)` where:

- `namespace = uuidv5(cloud.config.projectId, uuidv5.URL)` — same projectId in @omega.js/backend/UJM/@omega.js/client → same namespace everywhere.
- `client_id = uuidv5(deviceId, namespace)` — `deviceId` is the first non-internal MAC from `os.networkInterfaces()`, falling back to a persisted `crypto.randomUUID()`.
- `user_id = uuidv5(firebaseUid, namespace)` — set automatically when `omega.onAuthChange` fires with a uid; cleared on logout.

Why this matters: the same Firebase user signing into the desktop app, the web app, and triggering backend events produces **identical `user_id` values** in every Measurement Protocol call. GA4 stitches the events into one user journey across all surfaces.

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

Webpack's DefinePlugin bakes `process.env.GOOGLE_ANALYTICS_SECRET` into the bundled main process at build time, so packaged apps don't need `.env` at runtime. The build runs with the secret set (CI does this via the GitHub Actions secret pushed by `mgr push-secrets`).

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
- `src/test/suites/renderer/analytics-bridge.test.js` — renderer-side surface shape + `getStatus` round-trip.
