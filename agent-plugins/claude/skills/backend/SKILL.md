---
name: backend
description: Router for @omega.js/backend — the Firebase Cloud Functions framework: schema-validated routes, usage tracking, payments, email, auth hooks, the MCP server, and the emulator test harness. - Use when working on a brand's backend app or on the backend framework itself. Triggers on "@omega.js/backend", "omega backend", "backend app", "apps/backend", "functions/", "route", "schema", "endpoint", "omega_api", "Manager.init", "RouteContext", "ctx.respond", "Cloud Function", "Firebase function", "Firestore", "firestore rules", "firestore index", "emulator", "omega emulator", "omega serve", "omega test", "usage", "rate limit", "quota", "payment", "Stripe", "PayPal", "resolveSubscription", "auth hook", "before-create", "before-signin", "cron job", "marketing campaign", "consent", "email template", "MJML", "MCP server", "logs:read", "logs:tail", "firestore:get", "auth:token", "getApiUrl", "targets.backend", or any work in src/routes/, src/schemas/, src/hooks/, or packages/backend/.
user-invocable: true
---

# OMEGA Backend (@omega.js/backend)

`@omega.js/backend` builds Firebase Cloud Functions backends: one `Manager.init(exports, {...})` bootstrap wires the built-in functions (`omega_api`, auth events, cron jobs), the helper classes (RouteContext, User, Analytics, Usage, Middleware, Settings, Utilities), the payment processors, Firestore-trigger pipelines, marketing campaigns, an MCP server, and the CLI for emulator, deploy, logs, auth, and Firestore work. Consumer apps are src-first: `src/index.js` plus optional `src/routes/`, `src/schemas/`, `src/hooks/`, staged into `dist/` by `omega build`.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/backend/index.md` is the guide (identity, architecture, the CLI table, file conventions). The per-subsystem meat lives in `packages/backend/docs/*.md`: routes, schemas, firestore, test-framework, common-mistakes, environment-detection, logging, payment-system, email-system, usage-rate-limiting, auth-hooks, mcp, verts. Cross-framework contracts live in `docs/shared/`.
- **Working in a consumer project** — read `docs/backend/index.md` in the framework monorepo (the local era links `node_modules/@omega.js/backend` straight into it; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

## Non-negotiables

- **Read the guide before editing.** The route/schema contract, the usage helper, and the Firestore conventions each have footguns documented and nowhere else.
- **🚫 Never start the user's long-running processes** (`omega emulator`, `omega serve`) — assume they are running and read the `dist/*.log` files for output. `omega test` is fine; it starts its own emulator.
- **Never mock — test against the real emulator.** Every feature ships tests at every surface it exposes.
- **Secrets never enter `config/omega.json5`** — `.env` only; the config validator hard-fails secret-shaped keys.
- **Deploys are deliberate** — only `omega deploy` publishes; a commit never does (`docs/shared/deploys.md`).
