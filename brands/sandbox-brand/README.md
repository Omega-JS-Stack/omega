# Sandbox Brand

The Omega monorepo's **permanent dogfood consumer** — a brand monorepo in the
day-one target format (`package.json` with `targets/*` workspaces, one app per
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
- **Frameworks link to the monorepo.** `targets/backend` depends on
  `@omega.js/backend` via `file:../../../../packages/backend`, so the sandbox
  always exercises HEAD.

## Apps

| App | Framework | Notes |
|-----|-----------|-------|
| `targets/backend` | `packages/backend` (@omega.js/backend) | Real @omega.js/backend consumer: full framework corpus (routes/events/rules/…) runs against the emulator, not just the self-test boot smoke |
| `targets/website` | `packages/web` (@omega.js/web) | Real @omega.js/web consumer since [#775](https://github.com/Omega-JS-Stack/omega/issues/775) (it was a hand-rolled esbuild page until then, which meant the lane could only ever drive a fixture). Two pages on the bare `core/root` layout: `/` says what this brand is, and `/e2e` is what the lane opens. The `window.__omega` hooks live in that page's own module, `src/assets/js/pages/e2e/index.js`, bound to the URL by the page-asset key with nothing declared, and they hang off the client the FRAMEWORK boots (`omega dev` in development connects it to the emulator suite with zero flags, N5) |

## Cross-stack e2e (`npm test` at the brand root)

`test/e2e/run.js` is a consumer of the **shared brand e2e harness**
(`@omega.js/devkit/test/e2e-harness`), which owns the infrastructure: target
discovery (`targets/backend` + `targets/website`), the classic-port hold that
lets the stack boot beside a live dev session, emulator boot **with persona
seeding** (the harness waits for the post-seed ready marker so browser steps
never race the seed wipe), the website's REAL `omega dev`, the browser, and the
step/teardown/log plumbing. Nothing static is built or served
([#775](https://github.com/Omega-JS-Stack/omega/issues/775)), and nothing here
installs puppeteer: the harness resolves it from this brand root, where
`@omega.js/manager` carries it. This file authors only the brand-specific
browser steps against `/e2e`, driven through the frontend↔backend contract: seeded
persona signs in with the known password → signup → @omega.js/backend
`auth onCreate` creates the Firestore user doc → signout → signin →
session persistence across reload → subscription resolution → **the full
lifecycle** (subscribe via test-provider intent → cancel → refund →
data-request create/status/cancel → delete account), every backend call
authenticated with the signed-in user's ID token (`window.__omega.api`)
and every state change landed by the REAL `payments-webhooks` trigger.
Nothing is mocked; this is the brand-monorepo `npm test` contract from
the redesign plan.

Ports self-allocate (N7): the run needs NO free classic ports — the emulator
CLI bumps taken ports, the harness reads the resolved map from the backend's
ports file and injects it into every page (`window.__OMEGA_DEV_PORTS__`, via
`preparePage`), and the site port bumps too. Proven by running the full e2e
with auth/firestore/hosting/site classics all squatted.

Failure logs land in `e2e/.logs/` (emulator output + page console).

## Running

```bash
# Cross-stack e2e (builds the site, boots the emulator, drives the browser)
npm test

# Backend: install (functions/ owns the deps), then run the full @omega.js/backend corpus
cd targets/backend/functions && npm install
npx omega test            # boots the emulator (demo project) + runs the corpus
npm run test:backend    # same thing, proxied from the brand root

# targets/website needs NO install inside the monorepo — its deps (esbuild,
# @omega.js/client, firebase, puppeteer) resolve from the workspace root via
# Node's directory climb. The declared deps make it installable standalone.
```
