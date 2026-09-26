# Architecture

## The Base Class and Its Hosts

`src/index.js` exports the base class `Omega` (by name and as the default export) and no instance. Each browser framework subclasses it and exports the ONE instance a consumer uses:

| Host | The instance |
|---|---|
| @omega.js/web | `@omega.js/web/runtime` (adds `appearance`, `shell`, `motion`, `exitPopup`) |
| @omega.js/extension | `@omega.js/extension/{popup,sidepanel,options,page}` (one subclass with a context name) |
| @omega.js/desktop | `@omega.js/desktop/renderer` (adds `desktop`, the preload's bridge to main) |

```javascript
// A web page module: the host hands the instance in
export default async ({ omega, options }) => {
  omega.auth.listen({ once: true }, ({ user }) => { /* ... */ });
  omega.utilities.escapeHTML(untrustedText);
  omega.config.environment; // 'development' | 'testing' | 'production'
};
```

**A consumer never writes `new`**: the host builds the instance, `initialize(configuration)` returns it, and `omega.ready` is the same promise. Every module is a plain property the constructor builds (`omega.auth`, never `omega.auth()`), and each module that needs the instance receives it in its constructor (`new Auth(omega)`), so no module imports a singleton.

## Directory Structure

```
@omega.js/client/
├── src/                       # Source code (ES6+)
│   ├── index.js               # The Omega base class, initialization, Firebase setup
│   └── modules/               # Feature modules
│       ├── analytics.js       # Runtime event tracking (@omega.js/analytics core)
│       ├── auth.js            # Firebase Auth wrapper: auth.user, listen, reload
│       ├── bindings.js        # Reactive DOM data binding
│       ├── device.js          # Local device stats
│       ├── dom.js             # loadScript, ready utilities
│       ├── firestore.js       # Firestore wrapper with chainable queries
│       ├── form-manager.js    # FormManager, constructed per form with the instance
│       ├── icons.js           # omega.icons: the Font Awesome auto-render
│       ├── notifications.js   # FCM push notifications
│       ├── request.js         # omega.request() and createRequest()
│       ├── sentry.js          # Error tracking integration
│       ├── service-worker.js  # SW registration and messaging
│       ├── storage.js         # localStorage/sessionStorage wrapper
│       ├── triggers.js        # omega.triggers: the click-trigger registry
│       ├── utilities.js       # Helper functions (clipboard, escape, etc.)
│       ├── verts.js           # The fallback-ladder ad engine
│       ├── motion.js          # createMotion(), the factory behind omega.motion
│       └── …                  # Plain helpers: live-page, vert-document, path-prefix,
│                              #   logger, icon-core, icon-renderer, features
├── dist/                      # Transpiled ES5 output (generated)
└── test/                      # Tests
```

## Module Dependencies

```
Omega (index.js)
├── Storage (standalone, no deps)
├── Auth → Omega (bindings, storage, Firebase), User from @omega.js/account
├── Bindings → Omega
├── Firestore → Omega (lazy Firebase import)
├── Notifications → Omega (storage, firestore)
├── ServiceWorker → Omega
├── Sentry → Omega (dynamic import)
├── Triggers, Icons, Motion (standalone services, built once)
├── DOM utilities (standalone)
└── Utilities → Omega
```

## Firebase Initialization

`initialize(config)` boots Firebase only when a usable web SDK config resolves:

- `_resolveFirebaseConfig()` checks `cloud.config` first (the omega.json5 role shape — desktop passes its resolved config through), then the nested `firebase.app.config` (the web/extension bridge contract shape). A blob only counts when **at least one value is non-empty** — framework config merges (e.g. UJM's Jekyll chain) inject all-empty-string blobs into Firebase-less sites, and those resolve to `null` (no init, no URL derivation).
- Initialization additionally requires a **non-empty `apiKey`** — the SDK cannot boot without one (it crashes the page with `auth/invalid-api-key`). Configs carrying only `projectId` still resolve so `getFunctionsUrl()` can derive its URL (`getApiUrl()` derives from `brand.url`, not the Firebase blob), but Firebase itself stays uninitialized and the console logs `[Firebase] Skipped: config has no apiKey ...` (same idiom as `[Analytics] Skipped:`).
