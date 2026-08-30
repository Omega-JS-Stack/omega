# OMEGA Client (@omega.js/client)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/client` — identity, top-level conventions, and a map to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** (module APIs, patterns, behavior tables) lives in the package's own [`docs/<topic>.md`](../../packages/client/docs) files. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one.

## Identity

OMEGA Client is a modern JavaScript utility library for web applications with Firebase integration. It runs in the browser, in Electron's renderer process, and inside browser extensions (content scripts, popups, background pages). Provides:

- A singleton `Manager` instance exposing authentication, reactive DOM data binding, Firestore, storage, push notifications, error tracking (Sentry), service-worker helpers, DOM/utility functions, and `omega.request()` — the harmonized API-fetch layer (fresh Bearer token, automatic `omega-properties` processing with server usage synced into bindings)
- Lazy Firebase imports to keep consumer bundles small
- Reactive `data-omega-bind` DOM directives wired to auth + usage state
- A `resolveSubscription()` helper unified with @omega.js/backend's `User.resolveSubscription()` so subscription-state logic is identical across frontend and backend

### Consumed by the frontend Manager family

OMEGA Client is the runtime singleton powering **@omega.js/web**, **@omega.js/extension**, and **@omega.js/desktop**. Each framework initializes the singleton once and exposes it as `manager.omega`. Any consumer of those frameworks gets a fully-wired @omega.js/client via `import omega from '@omega.js/client'`.

## Recommended skills

- **`omega:client`** — the router skill from the omega Claude plugin. The inject hook loads it automatically when the session works inside `packages/client` (own-name match only — a dependency on the runtime says nothing about the session); it points back to this guide + `docs/` (the SSOT).
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## Quick Start

### For Consuming Projects

OMEGA Client is consumed indirectly through @omega.js/web, @omega.js/extension, or @omega.js/desktop — those frameworks initialize the singleton for you. Inside any consuming code:

```javascript
import omega from '@omega.js/client';

omega.auth().listen({ once: true }, async () => { /* auth settled */ });
omega.utilities().escapeHTML(untrustedText);
omega.firestore().doc('users/abc').get();
```

### For Framework Development (This Repository)

1. `npm install` — install OMEGA Client's own deps
2. `npm run prepare` — build once: copies `src/` → `dist/` via prepare-package (ES5 transpile)
3. `npm start` — watch mode (rebuild on change)
4. `npm test` — run Mocha tests

> **Important:** OMEGA Client is a library, not an app. There is no `npm run build` / `npm run serve` here. Consume it from inside an @omega.js/web / @omega.js/extension / @omega.js/desktop project for end-to-end behavior.

## Architecture

OMEGA Client exports a singleton `Manager` instance from `src/index.js`. Every `import omega from '@omega.js/client'` returns the same already-initialized object — do NOT call `new Manager()`, and do NOT pass `omega` through function params or module-level variables.

The singleton owns thirteen feature modules under `src/modules/`: `storage`, `auth`, `bindings`, `firestore`, `notifications`, `service-worker`, `sentry`, `dom`, `utilities` (the untrusted-text surface — `escapeHTML`, `sanitizeURL`, and the escape-first `renderMarkdown` that composes them, plus clipboard/notification/platform helpers), `device` (local install/session stats — binds the `device` key), `request` (harmonized API fetch — `omega.request()`; also consumed standalone by desktop main + the extension service worker via `createRequest`), `verts` (the fallback-ladder ad engine, adblock-safe naming — AdSense provider lane + in-house/company units, shared by web/desktop/extension), and `analytics` (runtime event tracking on every runtime, built on the shared `@omega.js/analytics` core — the one home of GA4 event-name and Measurement Protocol semantics; the extension posts through the Measurement Protocol, web hands the event to the page's own `gtag` so the api_secret never reaches a page, and desktop's renderer forwards over the preload's IPC bridge so the main process is the one sender ([#411](https://github.com/Omega-JS-Stack/omega/issues/411))). Firebase modules are dynamically imported to keep the bundle small. Alongside them live the transport-free standalone modules (`icon-core`, `icon-renderer`, `motion`, `live-page`, `vert-document` — the ONE vert unit document renderer, consumed by the verts module's promo lane and by `@omega.js/backend`'s serve route ([docs/web/ads-system.md](../web/ads-system.md)), `triggers` — the click-trigger registry below, `form-manager` — lightweight form state: initializing → ready ⇄ submitting) that embedding frameworks import by subpath and boot themselves — `motion` is the shared animation engine behind the `data-omega-*` attributes (classy v2), and `live-page` is the self-refreshing-page kit (`swap` writes a section only when its markup changed, `loading` is the first-paint spinner, `createFeedPoller` owns the declared feed table with its in-flight count and keep-last-good-on-failure rule, taking an `omega.request`-shaped fetcher as an argument). See [docs/architecture.md](../../packages/client/docs/architecture.md) for the directory structure and module dependency graph, and [docs/modules.md](../../packages/client/docs/modules.md) for the API reference of each module.

Pages built on this runtime follow the **page paint contract** ([docs/web/page-contract.md](../web/page-contract.md)): the client fills the `auth`, `usage`, `config` and `device` binding roots at auth settle so page code never hides its DOM waiting for a user, `bindings.update()` filters by root key so a spot that must wait for a server answer lives under a root the early paint does not publish, and `FormManager`'s `addGate()` / `resolveGate()` hold a form's submit controls disabled until every async answer it depends on has landed.

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
| @omega.js/web | `/oauth2` | `/omega/user/oauth2` |
| @omega.js/web | `/feedback` | `/omega/user/feedback` |
| @omega.js/web | `/portal/email-preferences` | `/omega/marketing/email-preferences` |
| @omega.js/web | `/download`, only where the notify-me form renders | `/omega/general/email` |
| @omega.js/web | the `newsletter-cta` band — on first FOCUS, not on load | `/omega/marketing/contact` |
| @omega.js/desktop | the renderer's auth bridge (`_wireAuthBridge`) | `/omega/user/token`, via main's sync-request |
| @omega.js/extension | every surface's `syncWithBackground()` | `/omega/user/token`, via background's sync |

The newsletter band is the one that waits for an interaction: it rides most pages, so a load-time ping would warm a function for every passive visitor scrolling past. A focus is the intent.

Deliberately NOT pinging: the payment confirmation page (its check is a Firestore read, not a backend call), the contact form (it posts to Slapform, a third party), and the admin dashboard (internal tooling, whose seven load-time fetches are their own warm-up).

### Click triggers (`modules/triggers.js`)

The ONE click-trigger registry every surface shares ([#16](https://github.com/Omega-JS-Stack/omega/issues/16)). A trigger is markup wiring — a class means "clicking this runs that action", with no per-page JS — and the client owns the single delegated `document` click listener behind all of them.

```javascript
import { registerTrigger } from '@omega.js/client/modules/triggers.js';

registerTrigger('signout', async (event, element) => { /* ... */ });
```

- **The class is always `omega-<name>`** — `registerTrigger('signout', …)` answers `.omega-signout`. Callers never spell the class, so the naming can never drift (this replaced three conventions: `.auth-signout-btn`, `.auth-signin-btn`, `.uj-password-toggle`, with no aliases kept).
- **A click anywhere inside a trigger element counts** (`closest()`), which is what makes icon-only and label-wrapped buttons work. The INNERMOST trigger wins when triggers nest.
- **A trigger class means the framework owns the click**: the registry calls `preventDefault()` + `stopPropagation()` before the handler, so no default navigation and no page-level handler fires behind it.
- **Registration arms the listener**, so a surface may register before or after `omega.initialize()` — order never matters. Re-registering a name REPLACES the handler with a warning; it never stacks, so a double boot cannot double-fire.
- **Who registers what**: the client registers the GENERIC actions (`omega-signout` — confirm, sign out, notify — from `auth.setupEventListeners()`), and each surface registers its own. Today: @omega.js/extension registers `omega-signin` (opens the website's `/token` page in a tab) and `omega-account` (opens the website's `/account` page in a tab) from `setupAuthEventListeners()`; @omega.js/web registers `omega-password-toggle` (the password eye) from its global module.
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

- [docs/architecture.md](../../packages/client/docs/architecture.md) — singleton pattern, directory structure, module dependency graph
- [docs/code-patterns.md](../../packages/client/docs/code-patterns.md) — early returns, `$`-prefixed DOM vars, logical operator placement, Firestore path syntax, dynamic imports, config deep-merge, event delegation
- [docs/modules.md](../../packages/client/docs/modules.md) — full module quick reference (Storage, Auth + `resolveSubscription` + Settler Pattern, Bindings, Firestore, Notifications, ServiceWorker, Sentry, DOM, Utilities)
- [docs/bindings.md](../../packages/client/docs/bindings.md) — `data-omega-bind` deep reference: actions, comma syntax, condition operators, state paths, skeleton loaders, root-key update filtering
- [docs/build-system.md](../../packages/client/docs/build-system.md) — `prepare-package` ES5 transpile, build commands, package exports
- [docs/testing.md](../../packages/client/docs/testing.md) — Mocha test setup
- [docs/cdp-debugging.md](../../packages/client/docs/cdp-debugging.md) — driving a live browser (per-session isolated Chrome via the `chrome-devtools` MCP) to verify @omega.js/client inside a consuming site
- [docs/common-tasks.md](../../packages/client/docs/common-tasks.md) — adding a utility, adding a module, modifying config defaults, payment config (OMEGA SSOT shape), adding a binding action
- [docs/dependencies.md](../../packages/client/docs/dependencies.md) — dependencies table + important notes (no TypeScript, prefer fs-jetpack, no backwards-compat requirement, etc.)
