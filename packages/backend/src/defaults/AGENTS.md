# ========== Default Values ==========
# OMEGA Backend (@omega.js/backend) consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework
     consumer templates (src/defaults/AGENTS.md ×N; web's lives at scaffold/AGENTS.md) with the same
     sections in the same order (framework-specific extras may be inserted; canonical sections are
     never reordered/renamed). Edit every framework consumer template together. The mirroring rule
     lives in each framework guide's Doc-update parity section (docs/<framework>/index.md) -->

## Framework

This project consumes **OMEGA Backend** (@omega.js/backend), a comprehensive framework for building
modern Firebase Cloud Functions backends. Its main export is ONE ready-made instance, `omega`, and
`omega.initialize({...})` wires:

- built-in functions (`omega_api`, auth events, cron jobs) into `omega.functions`
- the request pipeline, and the `Context` (`ctx`) every route, event and cron job receives
- the services (User, Usage, Analytics, Settings, Utilities, Metadata, Storage, Email, AI)
- payment provider integrations (Stripe / PayPal) and Firestore-trigger pipelines
- a deploy/emulator/watch tooling pipeline

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, the agent MUST read the framework documentation: that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`**: the OMEGA map, the one agent entry into the framework docs; follow it to `docs/backend/index.md` (the @omega.js/backend guide: identity, architecture, conventions)
- **`node_modules/@omega.js/backend/docs/`**: subsystem deep references (read the relevant ones for the task at hand)

## Quick start

All commands run from the **target root** (this directory). `dist/` is staged build output; never edit it.

```bash
npx omega build             # stage src/ → dist/ (the tree firebase.json points at)
npx omega emulator          # start Firebase emulators (auth/firestore/functions/database/storage)
npx omega test              # target checks, then YOUR project's test suites (bare runs are project-only; mgr:/backend: → framework, full: → both)
npx omega test --extended   # opt into REAL external APIs (shorthand for the shared TEST_EXTENDED_MODE; default: skipped)
npx omega watch             # auto-reload functions on file change
npx omega deploy            # deploy to Firebase
npx omega logs:read         # read Cloud Functions logs (also: logs:tail to stream)
npx omega firestore:get     # read a doc from Firestore (also: firestore:set / :query / :delete)
npx omega auth:get          # read an Auth user (also: auth:list / :delete / :set-claims)
npx omega install dev       # use LOCAL @omega.js/backend source (to test framework edits)
npx omega install live      # restore the published @omega.js/backend from npm
```

> Editing the @omega.js/backend framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/backend`). Run `npx omega install live` to switch back.

## Where things live

- `package.json`: THE target manifest, carrying scripts + runtime deps (`@omega.js/backend`, firebase-admin, firebase-functions). The staged `dist/package.json` derives from it.
- `src/index.js`: entry point. Requires the `omega` instance from `@omega.js/backend`, calls `omega.initialize({ ... })` and exports `omega.functions` (the built-in functions plus any you add).
- `src/routes/<path>/<method>.js`: custom routes (e.g. `src/routes/hello/get.js` → `GET /hello` through your own `hello` function, `omega.routes.run('hello', { req, res })` in `src/index.js`, and its own hosting rewrite; `omega_api` and `/omega/*` serve only the framework's routes). `index.js` serves every method.
- `src/schemas/<path>/<method>.js`: the route's schema, a function of the request returning a plain field declaration (validated into the route's `data`).
- `src/hooks/auth/<event>.js`, `src/hooks/cron/<schedule>/<job>.js`: auth and cron hooks.
- `src/events/<name>.js`: OPTIONAL handlers your own triggers run through `omega.events.run('<name>', payload)`.
- `src/public/`: OPTIONAL overrides for the hosting boilerplate (`index.html`, `404.html`); defaults are generated into `dist/public/`.
- `config/omega.json5`: STANDALONE projects only. In a brand monorepo the brand root's `config/omega.json5` is the config (`targets.backend` = this target's settings) and this target carries NO config file.
- `.env`: OPTIONAL per-key overrides you write by hand. The brand root's `.env` is the one file to edit; every verb composes `dist/.env` from the cascade (company ← brand ← this file), filtered to the keys the env schema names for `backend`. Gitignored; no machine writes this file.
- `service-account.json`: Firebase Admin credentials (STANDALONE projects; brand targets keep it in the brand's `.omega/secrets/`). Gitignored.
- `firebase.json`: Firebase config (hosting, rewrites, emulator ports). Points `functions.source` + `hosting.public` at `dist/`. Some fields managed by the verbs' scaffold.
- `.firebaserc`: Firebase project ID alias.
- `firestore.rules`: YOUR security rules — the whole file, no managed block. `omega build` compiles it with @omega.js/backend's framework half into `dist/firestore.rules`, which the emulator and `firebase deploy` read (never edit that).
  - Your rules may call any framework helper: `is*` asks a question (`isUser`, `isOwner`, `isAdmin`, `isWritingAny`), `get*` hands back a value (`getAuthUid`, `getExistingData`).
  - A match block of yours whose path names a framework block's MERGES into it (your condition ANDs onto the framework's) — that is how you TIGHTEN. Ops pair by NAME: `match /users/{uid} { allow create, update: if !isWritingAny(['xp']); }`.
- `database.rules.json`: Realtime Database security rules. @omega.js/backend owns a `// ========== OMEGA Rules ==========` block inside it; everything outside is yours.
- `dist/`: GENERATED staged output (`omega build`) carrying the src copy, derived manifest, composed config, and hosting boilerplate. Never edit; gitignored.

## Per-context imports

```js
// src/index.js: the entire backend bootstrap (synchronous; never `new`)
const omega = require('@omega.js/backend');

omega.initialize({
  // ...your options. How this backend RUNS is config, not an option here:
  // targets.backend.projectType in config/omega.json5 ('firebase' | 'custom').
});

module.exports = omega.functions;

// A route (src/routes/hello/get.js): ONE object, destructured
module.exports = async ({ ctx, omega, user, data, usage, analytics }) => {
  return ctx.respond({ hello: user.authenticated ? user.email : 'world' });
};

// A schema (src/schemas/hello/get.js): a function of the request, returning a declaration
module.exports = ({ user, body, query, path, method, headers, geolocation }) => ({
  limit: { type: 'number', default: 10, min: 1, max: user.plan === 'basic' ? 100 : 1000 },
});

// An auth hook (src/hooks/auth/on-create.js) and a cron job (src/hooks/cron/daily/<job>.js)
module.exports = async ({ ctx, omega, user, context }) => { };
module.exports = async ({ ctx, omega, context }) => { };
```

## Available APIs at runtime

On the instance (`omega`), after `initialize()`:
- `omega.config`, `omega.env`, `omega.logger`, `omega.cwd`, `omega.project`: config, the env reader, the logger, the functions dir, the Firebase project
- `omega.firebase.admin`, `omega.firebase.functions`: the Firebase Admin and Functions SDKs; `omega.functions` is the exported map
- `omega.utilities`: batch operations + helpers (`randomId()`, `sanitize()`, `iterateCollection()`)
- `omega.email`, `omega.ai`: transactional/marketing email and OpenAI/Anthropic
- `omega.storage({ name })`: local JSON storage (lowdb)
- `omega.routes.run(name, { req, res }, options)`: run a request through the pipeline as the named route, from your own function
- `omega.events.run(name, payload)`: run an event handler through the framework
- `omega.getEnvironment()`, `omega.isDevelopment()`, `omega.isTesting()`, `omega.isProduction()`, `omega.getApiUrl()`

On the request's `ctx` (every key of a route's argument is also here):
- `ctx.user`: the caller, a `User` (`authenticated`, `uid`, `email`, `plan`, `active`, `roles`, the stored fields); never null
- `ctx.data`: the input validated against the route's schema; `ctx.request` is the raw request
- `ctx.usage`, `ctx.analytics`, `ctx.email`, `ctx.ai`, `ctx.metadata(metadata, doc)`: the request services, built on first read
- `ctx.respond()`, `ctx.redirect()`, `ctx.report()`, `ctx.log()` / `.warn()` / `.error()`

A route never constructs a service: it reads it off `ctx` or `omega`.

Auth events, payment-webhook transitions, and cron jobs are wired automatically; hook into them by exporting from `src/hooks/<area>/<event>.js`.

## Dependency resolution

- **`omega.require(name)`** resolves from @omega.js/backend's module context. Consumer code (routes, schemas) can use it to access @omega.js/backend's bundled dependencies without installing them directly.
- **@omega.js/client owns Firebase on the client side.** Frontend consumer code (web pages, extension contexts, desktop renderers) NEVER imports Firebase directly. @omega.js/backend backend code uses `firebase-admin` directly (server-side is different).

## Testing

**Two lanes.** `npm test` is the STATIC lane: `node --test` over `test/_unit/**/*.test.js` with `test/_helpers/connect-trap.js` preloaded, which turns any TCP connect or DNS lookup into a throw. `npm run test:emulator` (`npx omega test`) is the emulator lane. A test needing a real client goes there; in the static lane, pass a stub.

Every feature ships with tests at every surface it exposes:

- **logic** — `test/routes/`, `test/events/`: handler suites against the real emulator
- **wiring** — route round-trips over `http.as(...)`: registration, auth gates, schema validation
- **rules** — `test/rules/`, when Firestore rules change

Skip a surface only when the feature genuinely doesn't have one; "the handler test covers it" does
not excuse the route round-trip. See `test/README.md` and
`node_modules/@omega.js/backend/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten by every OMEGA verb. Add your project-specific notes below — they are preserved. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across runs.
