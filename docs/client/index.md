# OMEGA Client (@omega.js/client)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/client` — identity, top-level conventions, and a map to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** (module APIs, patterns, behavior tables) lives in the package's own [`docs/<topic>.md`](../../packages/client/docs) files. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one.

## Identity

OMEGA Client is the browser runtime of the OMEGA stack, with Firebase integration. It runs in the browser, in Electron's renderer process, and inside browser extensions (popups, side panels, option and page contexts). It exports ONE thing: the base class `Omega`, and no instance. Each browser framework subclasses it and exports the one ready-made instance, `omega`. The class provides:

- Authentication, reactive DOM data binding, Firestore, storage, push notifications, error tracking (Sentry), service-worker helpers, DOM/utility functions, and `omega.request()`, the harmonized API-fetch layer (fresh Bearer token, automatic `omega-properties` processing with server usage synced into bindings), each a plain property of the instance
- `omega.auth.user`, always a `User` from `@omega.js/account`, the same class @omega.js/backend builds as `ctx.user`: the stored account as own fields, `authenticated`, `uid`, `email`, `plan`, `active`, `trialing`, `cancelling` and `everPaid` as getters, and `user.profile` (`displayName`, `photoURL`, `emailVerified`) from the sign-in. Signed out, it is a `User` with `authenticated` false and `plan` basic, never null
- Lazy Firebase imports to keep consumer bundles small
- Reactive `data-omega-bind` DOM directives on one auth root, `auth.user`, beside the `usage`, `config` and `device` roots

### Consumed by the browser frameworks

OMEGA Client is the base of **@omega.js/web**, **@omega.js/extension** and **@omega.js/desktop**. Each host subclasses `Omega`, adds its own surface, and exports the one instance a consumer imports:

| Host | The instance | The consumer shape |
|---|---|---|
| @omega.js/web | `@omega.js/web/runtime` | The framework boots it; a page, layout, section or global module is `export default async ({ omega, options }) => { }`, and a theme's `_theme.js` exports the same shape. The web page chrome rides on it: `omega.appearance`, `omega.shell`, `omega.motion`, `omega.exitPopup` |
| @omega.js/extension | `@omega.js/extension/{popup,sidepanel,options,page}` | `import omega from '@omega.js/extension/popup'; await omega.initialize();`. The four page contexts are one subclass with a context name; background carries its own `auth` with `.user`, and auth sync rides `omega.messenger` |
| @omega.js/desktop | `@omega.js/desktop/renderer` | `import omega from '@omega.js/desktop/renderer'; omega.initialize().then(() => { });`. `omega.desktop` is the preload's bridge to the main process (`ipc`, `storage`, `theme`, ...) |

## Recommended skills

- **`omega:client`**: the router skill from the omega Claude plugin. The inject hook loads it automatically when the session works inside `packages/client` (own-name match only: a dependency on the runtime says nothing about the session); it points back to this guide + `docs/` (the SSOT).
- **`js:patterns`**: JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## Quick Start

### For Consuming Projects

OMEGA Client is consumed through @omega.js/web, @omega.js/extension, or @omega.js/desktop: those frameworks build and initialize the instance for you. Inside any consuming code, `omega` is that instance (a web page module receives it; an extension or desktop view imports its context entry):

```javascript
export default async ({ omega, options }) => {
  omega.auth.listen({ once: true }, ({ user }) => {
    if (user.authenticated) { /* signed in: user.plan, user.profile.displayName */ }
  });

  omega.utilities.escapeHTML(untrustedText);
  omega.firestore.doc('users/abc').get();
};
```

### For Framework Development (This Repository)

1. `npm install`: install OMEGA Client's own deps
2. `npm run prepare`: build once, copies `src/` to `dist/` via prepare-package (ES5 transpile)
3. `npm start`: watch mode (rebuild on change)
4. `npm test`: run the tests

> **Important:** OMEGA Client is a library, not an app. There is no `npm run build` / `npm run serve` here. Consume it from inside an @omega.js/web / @omega.js/extension / @omega.js/desktop project for end-to-end behavior.

## Architecture

OMEGA Client exports the base class `Omega` from `src/index.js`, by name and as the default export, and no instance. A consumer never writes `new`: the host framework builds the one instance, and `initialize(configuration)` returns it. `omega.ready` is the same promise `initialize()` settles, so a module that did not boot the instance can still await it.

Every module is a plain property the constructor builds, never a zero-arg method: `storage`, `auth`, `bindings`, `firestore`, `notifications`, `serviceWorker`, `sentry`, `dom`, `utilities` (the untrusted-text surface: `escapeHTML`, `sanitizeURL`, and the escape-first `renderMarkdown` that composes them, plus clipboard/notification/platform helpers), `device` (local install/session stats, binding the `device` key), `verts` (the fallback-ladder ad engine, adblock-safe naming: AdSense provider lane + in-house/company units, shared by web/desktop/extension), and `analytics` (runtime event tracking on every runtime, built on the shared `@omega.js/analytics` core, the one home of GA4 event-name and Measurement Protocol semantics; the extension posts through the Measurement Protocol, web hands the event to the page's own `gtag` so the api_secret never reaches a page, and desktop's renderer forwards over the preload's IPC bridge so the main process is the one sender). `omega.request()` is the harmonized API fetch (the extension background and desktop main each carry one of their own, built once through `createRequest` on their session, and their token sync fetches through it). Firebase modules are dynamically imported to keep the bundle small. Each module that needs the instance receives it in its constructor (`new Auth(omega)`), so nothing imports a singleton.

The rest of `src/modules/` follows one rule:

- **A service the framework builds once is a property**: `omega.triggers` (the click-trigger registry below), `omega.icons` (the Font Awesome auto-render, bound to the surface's icon transport by `omega.icons.start({ resolve })`), `omega.motion` (the shared animation engine behind the `data-omega-*` attributes, classy v2).
- **`FormManager` is a class constructed per form**, and receives the instance first: `new FormManager(omega, '#my-form', options)` (lightweight form state: initializing, ready, submitting).
- **A pure helper stays a plain import by subpath**: `live-page` (the self-refreshing-page kit: `swap` writes a section only when its markup changed, `loading` is the first-paint spinner, `createFeedPoller` owns the declared feed table with its in-flight count and keep-last-good-on-failure rule, taking an `omega.request`-shaped fetcher as an argument), `vert-document` (the ONE vert unit document renderer, consumed by the verts module's promo lane and by `@omega.js/backend`'s serve route, [docs/web/ads-system.md](../web/ads-system.md)), `path-prefix`, `logger`, `icon-core`, `icon-renderer`.

See [docs/architecture.md](../../packages/client/docs/architecture.md) for the directory structure and module dependency graph, and [docs/modules.md](../../packages/client/docs/modules.md) for the API reference of each module.

Pages built on this runtime follow the **page paint contract** ([docs/web/page-contract.md](../web/page-contract.md)): the client fills the `auth`, `usage`, `config` and `device` binding roots at auth settle so page code never hides its DOM waiting for a user, `bindings.update()` filters by root key so a spot that must wait for a server answer lives under a root the early paint does not publish, and `FormManager`'s `addGate()` / `resolveGate()` hold a form's submit controls disabled until every async answer it depends on has landed.

### The auth state: one `User`, one state per change

Each auth state change builds ONE state, `{ user, denied }`, before anything reads it: one account fetch, one `User`. `omega.auth.user` is that `User`, every listener receives that state, and the bindings publish it as `auth.user`. `denied` is true only when Firestore rules refused the account read; a document not written yet is the normal state right after signup and reads as an empty account.

- `omega.auth.listen({ once: true }, (state) => { })` waits for the first landed state (`omega.auth.settled`), then fires once with the newest one.
- `omega.auth.listen((state) => { })` fires on every landed state and returns the unsubscribe; registered after a state landed, it catches up with that state once.
- `omega.auth.reload()` re-reads the account for the current Firebase user, lands it as a new state, and resolves with it.
- Bindings read the live `User`, so `auth.user.plan`, `auth.user.active` and `auth.user.authenticated` resolve through its getters, and `auth.user.profile.displayName` reads the sign-in's profile. The full path list: [docs/bindings.md](../../packages/client/docs/bindings.md).

### The init contract: one call, one blob, one mapping

Every surface initializes its instance with the SAME thing: the browser subset of its brand's resolved omega.json5, delivered to every artifact the same way: the ONE `build.js` at its web root that each shell loads with its first script tag and each worker with one `importScripts` line ([docs/shared/config.md](../shared/config.md), "The browser subset"). `self.OMEGA_BUILD_JSON` is there before any bundle runs.

| Surface | The call |
|---|---|
| web | `runtime/boot.js`: `const configuration = window.OMEGA_BUILD_JSON?.config; await omega.initialize(configuration);` |
| extension | the page contexts' shared subclass (`page-context.js`, behind `popup`, `options`, `sidepanel`, `page`): `super.initialize(window.OMEGA_BUILD_JSON?.config)`; the service worker `importScripts('/build.js')` on its first line and reads `serviceWorker.OMEGA_BUILD_JSON.config` |
| desktop | `renderer.js`: `window.OMEGA_BUILD_JSON.config` merged with the runtime overrides, plus the preload's `analyticsBridge` |

The `runtime` fact rides IN that blob, so `omega.utilities.getRuntime()` answers
`'electron'` in a packaged renderer instead of falling through its sniff to `'web'`.

`_processConfiguration()` is the ONE place the canonical config shape becomes this
runtime's contract, so no framework composes a bridge of its own:

- the `client` section IS this contract's top level (`auth`, `consent`, `exitPopup`,
  `serviceWorker`, `env`, …), so `omega.config.consent.config` reads what the brand wrote
  under `client.consent`
- `cloud.config` is the Firebase home it boots from (`_resolveFirebaseConfig()`; the
  nested `firebase.app.config` answers too)
- `monitoring.providers.sentry` is the one error-reporting switch: a DSN there turns
  reporting ON and outranks a `client.sentry` blob

Defaults fill everything a brand left unsaid (the whole `defaults` object in
`src/index.js`), so an absent section is a default and never a crash. With ONE
exception, and it is deliberate: **`environment` has no default**. A page whose build
forgot to bake the fact would otherwise read as some environment and talk to the wrong
stack. Every OMEGA build bakes it, so its absence is a broken artifact. Pinned by
`test/config.test.js`.

### The environment (`getEnvironment()` + the three checks)

The instance answers the same four calls every other OMEGA target answers, from
the same module: `@omega.js/config`'s `environment.js`, vendored into this
package at prepare time the way `@omega.js/account` and `@omega.js/monitoring`
are (the contract in full: [docs/shared/config.md](../shared/config.md)).

- `omega.getEnvironment()`: `'development' | 'testing' | 'production'`, exactly one
- `omega.isDevelopment()` / `omega.isProduction()` / `omega.isTesting()`: each DERIVES
  from it, so they can never disagree and `isProduction()` is a real positive check,
  never `!isDevelopment()`

The ONE input in a browser is `config.environment`, the build fact `OMEGA_BUILD_JSON`
carries, and a config without it throws by name rather than reading as "not
development". Every host's instance inherits the four from this base class, so nothing
on a page carries a second copy.

### The wakeup ping (`omega.request(url, { wakeup: true })`)

A fire-and-forget GET that warms a cold backend and nothing else. @omega.js/backend's middleware sees `wakeup` in the request data and answers it BEFORE it loads a route or authenticates ([docs/backend/index.md](../backend/index.md)), so any route warms the same function at the same cost and none of them runs. The call mints no ID token, reads no response body, and resolves rather than throwing when the network is down, so a caller can fire it and move on:

```javascript
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';

omega.request(WAKEUP_ROUTE, { wakeup: true });
```

**One route, every surface.** `WAKEUP_ROUTE` (`/omega/health`) is exported by `modules/request.js` and named by every caller instead of "the route I am about to need": a wakeup never runs a route, so a per-caller route would be a dozen spellings of one warm function — and desktop main and the extension cannot reach a web-side constant anyway ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).

**Where it fires.** Every entry point whose first user action is a backend call warms it on load, never awaited:

| Surface | Site | The call it is warming for |
|---|---|---|
| @omega.js/web | `/pricing` | the checkout the plan buttons lead to |
| @omega.js/web | `/payment/checkout` | `/omega/payments/intent` |
| @omega.js/web | `/signup` | `/omega/user/signup` — the 14-second cold start measured live 2026-08-27 |
| @omega.js/web | `/signin` | `/omega/user/signup` behind a first-time OAuth signin |
| @omega.js/web | `/account` | the billing portal, plan switch, cancel, refund, API key, data request, delete |
| @omega.js/web | `/token` | `/omega/user/token` (also where a desktop app and an extension sign in) |
| @omega.js/web | `/connections/callback` | `/omega/user/connections` |
| @omega.js/web | `/feedback` | `/omega/user/feedback` |
| @omega.js/web | `/portal/email-preferences` | `/omega/marketing/email-preferences` |
| @omega.js/web | `/download`, only where the notify-me form renders | `/omega/general/email` |
| @omega.js/web | the `newsletter-cta` band — on first FOCUS, not on load | `/omega/marketing/contact` |
| @omega.js/desktop | the renderer's auth bridge (`_wireAuthBridge`) | `/omega/user/token`, via main's sync-request |
| @omega.js/extension | every surface's `syncWithBackground()` | `/omega/user/token`, via background's sync |

The newsletter band is the one that waits for an interaction: it rides most pages, so a load-time ping would warm a function for every passive visitor scrolling past. A focus is the intent.

Deliberately NOT pinging: the payment confirmation page (its check is a Firestore read, not a backend call), the contact form (it posts to Slapform, a third party), and the admin dashboard (internal tooling, whose seven load-time fetches are their own warm-up).

### The session probe (`omega.auth.probeSession()`)

One forced token refresh at a moment of doubt, and nothing else ([#798](https://github.com/Omega-JS-Stack/omega/issues/798)). Firebase asks the Auth server about a persisted session at page load and at the hourly refresh and at no other moment, so a revoked, disabled or deleted account keeps an open tab signed in until a reload, and a dev stack whose auth emulator restarted leaves the page holding a session the server no longer has. The probe never asks OUR backend, so dev and production run the same code.

`probeSession()` exchanges the refresh token with the Auth server (`getIdToken(user, true)`) and classifies the answer:

| Result | When | What the client does |
|---|---|---|
| `signed-out` | no `currentUser` | nothing; a probe on a signed-out client is a no-op |
| `alive` | the refresh succeeded | nothing |
| `gone` | a DEFINITE `auth/*` verdict, meaning any `auth/*` code that is not one of the three transient ones below (`auth/user-token-expired`, `auth/user-disabled`, `auth/user-not-found`, `auth/invalid-refresh-token`, …) | `signOut()`, whose `onAuthStateChanged` emission drives each surface's own policy listener |
| `unknown` | the three TRANSIENT codes (`auth/network-request-failed`, `auth/too-many-requests`, `auth/internal-error`), or an error carrying no auth code | keeps the user: a bad connection, a throttle and a failing Auth server are no verdict on the session, and neither is the "Backend starting" window |

**Three moments, no timer.** The tab coming back into view (`visibilitychange` to visible) and the network coming back (`online`) are wired once per instance beside the auth state listener, guarded for a host with no `document` (the extension's background service worker). The third is a 401 on an authenticated `omega.request()`: the request layer calls its optional `onUnauthorized` dep WITHOUT awaiting it and throws the caller's error unchanged, so nothing waits on a token refresh and a failed probe is never the request's failure. Probes coalesce, one in flight per Auth instance, because focus, online and a 401 arrive together all the time and are all asking the same question. A periodic ping would be a request per open tab for nothing; page load and the hourly refresh stay Firebase's own.

Web, desktop and extension get every bit of this from the client, with no framework code of their own. Web's page auth policy is what redirects on the resulting signed-out state ([docs/web/page-contract.md](../web/page-contract.md)).

### Click triggers (`modules/triggers.js`)

The ONE click-trigger registry every surface shares, `omega.triggers`. A trigger is markup wiring: a class means "clicking this runs that action", with no per-page JS, and the instance owns the single delegated `document` click listener behind all of them.

```javascript
omega.triggers.register('signout', async (event, element) => { /* ... */ });
```

- **The class is always `omega-<name>`**: `omega.triggers.register('signout', …)` answers `.omega-signout`. Callers never spell the class, so the naming can never drift.
- **A click anywhere inside a trigger element counts** (`closest()`), which is what makes icon-only and label-wrapped buttons work. The INNERMOST trigger wins when triggers nest.
- **A trigger class means the framework owns the click**: the registry calls `preventDefault()` + `stopPropagation()` before the handler, so no default navigation and no page-level handler fires behind it.
- **Registration arms the listener**, so a surface may register before or after `omega.initialize()`: order never matters. Re-registering a name REPLACES the handler with a warning; it never stacks, so a double boot cannot double-fire.
- **Who registers what**: the client registers the GENERIC actions (`omega-signout`: confirm, sign out, notify, from `auth.setupEventListeners()`; the sign-out is the instance's own `omega.signOut()` where it carries one, desktop's renderer signing the whole app out through main, else `omega.auth.signOut()`), and each surface registers its own. @omega.js/extension registers `omega-signin` (`omega.auth.openPage()`, the website's `/token` page in a tab) and `omega-account` (the website's `/account` page in a tab) from `setupAuthEventListeners()`; @omega.js/web registers `omega-password-toggle` (the password eye) from its global module.
- Transport-free and DOM-only like `motion` / `icon-renderer`: inert where there is no document (desktop main, the extension service worker).

Web's `data-shell-toggle` / `data-shell-dismiss` are NOT triggers — they are @omega.js/web's attribute-driven app-shell contract and stay there.

## File Conventions

- **CommonJS-friendly ES6+** in `src/`. `prepare-package` transpiles to ES5 in `dist/`.
- **`fs-jetpack`** over `fs` / `fs-extra` for any file operations in tests/scripts.
- **No TypeScript** — pure JavaScript library.
- **Template strings** — use backticks for string interpolation.
- **DO NOT modify `_legacy/`** — reference only, frozen for historical context.
- **No backwards compatibility** unless explicitly requested — just change to the new way.
- **Early-return / short-circuit** style throughout — see [docs/code-patterns.md](../../packages/client/docs/code-patterns.md) for the full code-pattern checklist (`$`-prefixed DOM vars, operators at start of continuation lines, Firestore path syntax, dynamic imports, config deep-merge, event delegation).

## Doc-update parity

Whenever you make a behavioral change (new module, new method, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`docs/client/index.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

**The four framework guides are structurally MIRRORED** — this guide follows the library subset of that skeleton (the scaffolding frameworks [web](../web/index.md), [backend](../backend/index.md), [desktop](../desktop/index.md), and [extension](../extension/index.md) carry the full skeleton + a consumer template). Never add, rename, or reorder a section here without checking the sibling guides.

## Documentation

Deep references live in `docs/`. Treat docs as a first-class deliverable. **Whenever you make a behavioral change, update both this overview AND the relevant `docs/*.md` deep reference.**

- [docs/architecture.md](../../packages/client/docs/architecture.md): the base class and its hosts, directory structure, module dependency graph
- [docs/code-patterns.md](../../packages/client/docs/code-patterns.md) — early returns, `$`-prefixed DOM vars, logical operator placement, Firestore path syntax, dynamic imports, config deep-merge, event delegation
- [docs/modules.md](../../packages/client/docs/modules.md): full module quick reference (Storage, Auth + `auth.user` + one state per auth change, Bindings, Firestore, Notifications, ServiceWorker, Sentry, DOM, Utilities)
- [docs/bindings.md](../../packages/client/docs/bindings.md) — `data-omega-bind` deep reference: actions, comma syntax, condition operators, state paths, skeleton loaders, root-key update filtering
- [docs/build-system.md](../../packages/client/docs/build-system.md) — `prepare-package` ES5 transpile, build commands, package exports
- [docs/testing.md](../../packages/client/docs/testing.md) — Mocha test setup
- [docs/cdp-debugging.md](../../packages/client/docs/cdp-debugging.md) — driving a live browser (per-session isolated Chrome via the `chrome-devtools` MCP) to verify @omega.js/client inside a consuming site
- [docs/common-tasks.md](../../packages/client/docs/common-tasks.md) — adding a utility, adding a module, modifying config defaults, payment config (OMEGA SSOT shape), adding a binding action
- [docs/dependencies.md](../../packages/client/docs/dependencies.md) — dependencies table + important notes (no TypeScript, prefer fs-jetpack, no backwards-compat requirement, etc.)
