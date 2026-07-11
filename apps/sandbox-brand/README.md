# Sandbox Brand

The Omega monorepo's **permanent dogfood consumer** — a brand monorepo in the
day-one target format (`package.json` with `apps/*` workspaces, one app per
target type). It exists so every framework/devkit/account/config change can be
verified against a REAL consumer inside this repo, and so the scaffolding path
is continuously dogfooded.

**Rules of this sandbox:**

- **Fresh by construction.** Nothing in here is copied from an existing brand.
  Files come from the frameworks' own scaffolding sources (e.g.
  `packages/backend/templates/` + `src/defaults/` — the same files `mgr setup`
  writes into consumers).
- **Emulator-only, demo everything.** The Firebase project is
  `demo-sandbox-brand` (the `demo-` prefix means the emulator suite runs with
  no real credentials). Every key, secret, and service account in here is a
  fake demo value by design — which is why files a real consumer gitignores
  (`.env`, `service-account.json`, `.firebaserc`, the root-proxy
  `package.json`) are deliberately committed here (re-included in
  `.gitignore`'s Custom Values section).
- **Frameworks link to the monorepo.** `apps/backend/functions` depends on
  `@omega.js/backend` via `file:../../../../../packages/backend`, so the sandbox
  always exercises HEAD.

## Apps

| App | Framework | Notes |
|-----|-----------|-------|
| `apps/backend` | `packages/backend` (@omega.js/backend) | Real @omega.js/backend consumer: full framework corpus (routes/events/rules/…) runs against the emulator, not just the self-test boot smoke |
| `apps/website` | `packages/client` (@omega.js/client) | Minimal static site whose esbuild bundle embeds @omega.js/client, pointed at the emulator suite (environment=development auto-connects — zero flags, N5). Gets replaced by an `@omega.js/web` consumer in Phase 2 — the brand-monorepo slot and the e2e contract stay the same |

## Cross-stack e2e (`npm test` at the brand root)

`e2e/run.js` is a consumer of the **shared brand e2e harness**
(`@omega.js/devkit/test/e2e-harness`), which owns the infrastructure: target
discovery (`apps/backend` + `apps/website`), website build + static serve,
emulator boot **with persona seeding** (the harness waits for the post-seed
ready marker so browser steps never race the seed wipe), step/teardown/log
plumbing. This file authors only the brand-specific browser steps — a real
Chromium (puppeteer) driven through the frontend↔backend contract: signup →
@omega.js/backend `auth onCreate` creates the Firestore user doc → signout →
signin via @omega.js/client → session persistence across reload → subscription
resolution. Nothing is mocked; this is the brand-monorepo `npm test` contract
from the redesign plan.

Failure logs land in `e2e/.logs/` (emulator output + page console).

## Running

```bash
# Cross-stack e2e (builds the site, boots the emulator, drives the browser)
npm test

# Backend: install (functions/ owns the deps), then run the full @omega.js/backend corpus
cd apps/backend/functions && npm install
npx omega test            # boots the emulator (demo project) + runs the corpus
npm run test:backend    # same thing, proxied from the brand root

# apps/website needs NO install inside the monorepo — its deps (esbuild,
# @omega.js/client, firebase, puppeteer) resolve from the workspace root via
# Node's directory climb. The declared deps make it installable standalone.
```
