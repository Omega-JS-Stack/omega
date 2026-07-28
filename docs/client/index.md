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

The singleton owns twelve feature modules under `src/modules/`: `storage`, `auth`, `bindings`, `firestore`, `notifications`, `service-worker`, `sentry`, `dom`, `utilities` (the untrusted-text surface — `escapeHTML`, `sanitizeURL`, and the escape-first `renderMarkdown` that composes them, plus clipboard/notification/platform helpers), `device` (local install/session stats — binds the `device` key), `request` (harmonized API fetch — `omega.request()`; also consumed standalone by desktop main + the extension service worker via `createRequest`), `verts` (the fallback-ladder ad engine, adblock-safe naming — AdSense provider lane + in-house/company units, shared by web/desktop/extension). Firebase modules are dynamically imported to keep the bundle small. Alongside them live the transport-free standalone modules (`icon-core`, `icon-renderer`, `motion`, `live-page`) that embedding frameworks import by subpath and boot themselves — `motion` is the shared animation engine behind the `data-omega-*` attributes (classy v2), and `live-page` is the self-refreshing-page kit (`swap` writes a section only when its markup changed, `loading` is the first-paint spinner, `createFeedPoller` owns the declared feed table with its in-flight count and keep-last-good-on-failure rule, taking an `omega.request`-shaped fetcher as an argument). See [docs/architecture.md](../../packages/client/docs/architecture.md) for the directory structure and module dependency graph, and [docs/modules.md](../../packages/client/docs/modules.md) for the API reference of each module.

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
- [docs/shared/testing.md](../../packages/client/docs/testing.md) — Mocha test setup
- [docs/cdp-debugging.md](../../packages/client/docs/cdp-debugging.md) — driving a live browser (per-session isolated Chrome via the `chrome-devtools` MCP) to verify @omega.js/client inside a consuming site
- [docs/common-tasks.md](../../packages/client/docs/common-tasks.md) — adding a utility, adding a module, modifying config defaults, payment config (OMEGA SSOT shape), adding a binding action
- [docs/dependencies.md](../../packages/client/docs/dependencies.md) — dependencies table + important notes (no TypeScript, prefer fs-jetpack, no backwards-compat requirement, etc.)
