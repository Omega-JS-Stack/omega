# ========== Default Values ==========
# OMEGA Backend (@omega.js/backend) consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework
     consumer templates (src/defaults/AGENTS.md ×N; web's lives at scaffold/AGENTS.md) with the same
     sections in the same order (framework-specific extras may be inserted; canonical sections are
     never reordered/renamed). Edit every framework consumer template together. The mirroring rule
     lives in each framework guide's Doc-update parity section (docs/<framework>/index.md) -->

## Framework

This project consumes **OMEGA Backend** (@omega.js/backend), a comprehensive framework for building
modern Firebase Cloud Functions backends. A single `Manager.init(exports, {...})` bootstrap wires:

- built-in functions (`omega_api`, auth events, cron jobs)
- helper classes (RouteContext, User, Analytics, Usage, Middleware, Settings, Utilities, Metadata)
- payment processor integrations (Stripe / PayPal) and Firestore-trigger pipelines
- a deploy/emulator/watch tooling pipeline

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, the agent MUST read the framework documentation: that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`**: the OMEGA map, the one agent entry into the framework docs; follow it to `docs/backend/index.md` (the @omega.js/backend guide: identity, architecture, conventions)
- **`node_modules/@omega.js/backend/docs/`**: subsystem deep references (read the relevant ones for the task at hand)

## Quick start

All commands run from the **app root** (this directory). `dist/` is staged build output; never edit it.

```bash
npx omega setup             # validate config + scaffold defaults + stage dist/ + run checks
npx omega build             # stage src/ → dist/ (the tree firebase.json points at)
npx omega emulator          # start Firebase emulators (auth/firestore/functions/database/storage)
npx omega test              # run YOUR project's test suites (bare runs are project-only; mgr:/backend: → framework, full: → both)
npx omega test --extended   # opt into REAL external APIs (shorthand for the shared TEST_EXTENDED_MODE; default: skipped)
npx omega watch             # auto-reload functions on file change
npx omega deploy            # deploy to Firebase
npx omega logs:read         # read Cloud Functions logs (also: logs:tail to stream)
npx omega firestore:get     # read a doc from Firestore (also: firestore:set / :query / :delete)
npx omega auth:get          # read an Auth user (also: auth:list / :delete / :set-claims)
npx omega install dev       # use LOCAL @omega.js/backend source (to test framework edits)
npx omega install live      # restore the published @omega.js/backend from npm
```

`npx omega-backend <cmd>` works too (alias of `npx omega <cmd>`).

> Editing the @omega.js/backend framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/backend`). Run `npx omega install live` to switch back.

## Where things live

- `package.json`: THE app manifest, carrying scripts + runtime deps (`@omega.js/backend`, firebase-admin, firebase-functions). The staged `dist/package.json` derives from it.
- `src/index.js`: entry point. Must call `Manager.init(exports, { ... })` to register all built-in + custom endpoints.
- `src/routes/<verb>/<path>.js`: custom routes mounted at runtime (e.g. `src/routes/get/hello.js` → `GET /hello`).
- `src/schemas/<name>.js`: schema definitions for `Manager.Settings()` validation.
- `src/hooks/<area>/<event>.js`: auth/cron hooks.
- `src/public/`: OPTIONAL overrides for the hosting boilerplate (`index.html`, `404.html`); defaults are generated into `dist/public/`.
- `config/omega.json5`: STANDALONE apps only. In a brand monorepo the brand root's `config/omega.json5` is the config (`targets.backend` = this app's settings) and this app carries NO config file.
- `.env`: secrets (OMEGA_ADMIN_KEY, third-party API keys). Gitignored; staged into `dist/` for the deploy artifact.
- `service-account.json`: Firebase Admin credentials (STANDALONE apps; brand apps keep it in the brand's `.omega/secrets/`). Gitignored.
- `firebase.json`: Firebase config (hosting, rewrites, emulator ports). Points `functions.source` + `hosting.public` at `dist/`. Some fields managed by `npx omega setup`.
- `.firebaserc`: Firebase project ID alias.
- `firestore.rules`: YOUR security rules — the whole file, no managed block. `omega build` compiles it with @omega.js/backend's framework half into `dist/firestore.rules`, which the emulator and `firebase deploy` read (never edit that).
  - Your rules may call any framework helper: `is*` asks a question (`isUser`, `isOwner`, `isAdmin`, `isWritingAny`), `get*` hands back a value (`getAuthUid`, `getExistingData`).
  - A match block of yours whose path names a framework block's MERGES into it (your condition ANDs onto the framework's) — that is how you TIGHTEN. Ops pair by NAME: `match /users/{uid} { allow create, update: if !isWritingAny(['xp']); }`.
- `database.rules.json`: Realtime Database security rules. @omega.js/backend owns a `// ========== OMEGA Rules ==========` block inside it; everything outside is yours.
- `dist/`: GENERATED staged output (`omega build`) carrying the src copy, derived manifest, composed config, and hosting boilerplate. Never edit; gitignored.

## Per-context imports

```js
// src/index.js: the entire backend bootstrap
const Manager = require('@omega.js/backend');
Manager.init(exports, {
  projectType: 'firebase',
  // ...your config
});

// In a custom route (src/routes/get/hello.js):
module.exports = async function(Manager, ctx) {
  // ctx.req, ctx.res, ctx.user, etc.
};
```

## Available APIs at runtime

After `Manager.init()`, the Manager instance exposes factory methods:
- `Manager.RouteContext({ req, res })`: request handler with user + analytics + utility access
- `Manager.User(data)`: user property structure + schema
- `Manager.Analytics({ ctx })`: GA4 event tracking
- `Manager.Usage()`: rate-limiting
- `Manager.Middleware(req, res)`: request pipeline
- `Manager.Settings()`: schema validation against `src/schemas/*`
- `Manager.Utilities()`: batch operations + helpers
- `Manager.Metadata(doc)`: timestamps + tag helpers
- `Manager.storage({ name })`: local JSON storage (lowdb)

Auth events, payment-webhook transitions, and cron jobs are wired automatically; hook into them by exporting from `src/hooks/<area>/<event>.js`.

## Dependency resolution

- **`Manager.require(name)`** resolves from @omega.js/backend's module context. Consumer code (routes, schemas) can use it to access @omega.js/backend's bundled dependencies without installing them directly.
- **@omega.js/client owns Firebase on the client side.** Frontend consumer code (UJM pages, BXM extensions, EM renderers) NEVER imports Firebase directly. @omega.js/backend backend code uses `firebase-admin` directly (server-side is different).

## Testing

Every feature ships with tests at every surface it exposes:

- **logic** — `test/routes/`, `test/events/`: handler suites against the real emulator
- **wiring** — route round-trips over `http.as(...)`: registration, auth gates, schema validation
- **rules** — `test/rules/`, when Firestore rules change

Skip a surface only when the feature genuinely doesn't have one; "the handler test covers it" does
not excuse the route round-trip. See `test/README.md` and
`node_modules/@omega.js/backend/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten on every `npx omega setup`. Add your project-specific notes below — they are preserved across setups. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across `npx omega setup` runs.
