# N6 — Personas + lifecycle e2e (design)

> Status: **DESIGN (cp83)** — survey complete (Explore sweep, cp83; file:line pointers below are its findings). Spec source: core-changes inbox N6 — seeded emulator persona accounts (unauthed/free/paid/cancelled/refunded/…) usable by backend tests AND manual frontend signin (token mechanism); global lifecycle flows (signup, delete account, cancel, refund, data export, data deletion); boot-all-targets-and-wait harness generalized from the sandbox e2e; consumer-authorable brand tests; /account mock fixtures removed.

## What already exists (REUSE — do not rebuild)

- **Persona catalog + plan states**: `packages/backend/src/test/test-accounts.js` — `STATIC_ACCOUNTS` (:55) + `JOURNEY_ACCOUNTS` (:229) → `TEST_ACCOUNTS` (:578), ~55 personas with `subscription.product.id` basic/premium + status/expiry helpers. free=`basic` (:66), paid=`premium-active` (:76), cancelled=`premium-expired`/`premium-cancelling` (:85/:103), delete personas (:112/:121), cancel/refund validation personas (:383–:494).
- **Backend auth model**: personas authenticate with Firestore `api.privateKey` as Bearer — `http-client.js` `as('<persona>')` (:127), `_getAuthConfig` (:62). NOT Firebase tokens.
- **Seed orchestration**: `runner.js` `setupAccounts()` (:258): deleteTestUsers → ensureMetaStats → createTestAccounts → fetchPrivateKeys → consumer `test/_init.js` hooks (accounts + setup; consumer wins) → rules context. Emulator boot itself (`cli/commands/emulator.js`) seeds NOTHING.
- **Token signin, both halves**: mint via `POST /user/token` (`createCustomToken`, admin can mint for another uid) or admin SDK directly; web consumes `?authCustomToken=` (`packages/web/core/js/libs/auth.js` `handleCustomTokenSignin` :393 → redirect to `?authReturnUrl`/`/dashboard`); client has `signInWithCustomToken`/`getIdToken` (`modules/auth.js` :215/:202). Sandbox `window.__omega` does NOT expose it yet.
- **Lifecycle routes — all emulator-safe**: `user/delete.js` (self or admin; blocks active paid subs); `payments/cancel|refund` via `processors/test.js` (simulates the webhook by writing `payments-webhooks/{id}`; `isProduction()` guard); `user/data-request` GET/POST/DELETE (pure Firestore). Backend privateKey-driven tests already cover them.
- **Consumer authoring (backend)**: dual test roots + `project:` prefix (`runner.js` :103/:504); consumer `test/_init.js` `({ accounts, setup })` (core default + sandbox stub).
- **Harness building blocks**: sandbox `e2e/run.js` step()/log-capture/emulator-boot-and-wait/static-serve; app discovery ×2 — devkit `local.js` `discoverApps` (:147), manager `lib/brand.js` `discoverApps`+`loadBrand` (:67/:148 — target-typed).

## Build list (the actual N6 work)

**A. Personas** — add a first-class static `refunded` persona (end-state of the refund webhook: cancelled + refund recorded — model on `journey-payments-refund-webhook`'s final state). "Unauthed" = the existing `as('none')` mechanism; document it as the persona, no fake account.
**B. Known password** — seed every persona with a deterministic password (constant in test-accounts.js) so MANUAL dev signin is email+password on any dev site. (Verify `createAccount` :691 `createUser` sets one today; add if absent.)
**C. Token issuance at use time** — custom tokens expire (1h): mint on demand, never store. Harness/driver mints via admin SDK (no route dependency); browser signin = navigate `?authCustomToken=<token>`. Also expose `signInWithCustomToken` on sandbox `window.__omega`.
**D. Seeding on standalone emulator boot** — factor the seed routine out of runner.js into a shared module (`src/test/seed.js`-ish) called by BOTH the test runner and `mgr emulator` keep-alive mode (default ON outside production; skippable flag). This is the manual-dev DX: boot emulators → personas exist → sign in on the dev site.
**E. Generalized brand e2e harness** — boot-all-discovered-targets-and-wait: enumerate via manager `loadBrand` (target-typed), boot each present target (backend emulator, website build+serve; desktop/extension when present later), shared step()/logs; sandbox `run.js` becomes a consumer; consumers author their own brand-level steps. Home: devkit (runner-side, puppeteer stays in the brand's devDeps).
**F. Lifecycle flows as browser e2e** — signed-in persona drives: cancel (paid test-processor persona, `confirmed:true` → webhook doc → status reflects), refund, delete account (fresh persona), data-request create/status/cancel. Extends the sandbox e2e steps.
**G. /account mock removal** — delete `packages/web/core/js/pages/account/test-subscriptions/` (5 fixtures) + the `_dev_subscription` `@dev-only` block in `pages/account/index.js` (:89–:116); dev/account testing = emulator personas via B/C+D.
**H. Contract fix** — ~~normalize array-vs-object accounts~~ **ALREADY HANDLED**: `runner.js` `loadInitHooks` (:438) accepts array OR keyed object and normalizes on `id` before anything downstream sees it — the survey's note looked at `getAccountDefinitions` in isolation. No change needed.

## Checkpoint plan

- **cp83** (SHIPPED with A + B + C): refunded persona, deterministic `TEST_ACCOUNT_PASSWORD` on every seeded persona (manual dev signin = email + known password), sandbox `__omega` exposes `signInWithCustomToken`/`getIdToken`. **D moved to cp84** — standalone-boot seeding needs the emulator-env spawn machinery and its first consumer IS the harness; building them together avoids speculative design. Gate: corpus (seeding path exercises password + new persona on every boot), e2e.
- **cp84**: D + E — seed-on-standalone-emulator-boot + harness generalization + sandbox refactor onto it. Gate: e2e 11/11 via the new harness with harness-driven seeding.
- **cp85**: F — lifecycle browser flows. Gate: extended e2e (signup/cancel/refund/delete/data-request steps) green.
- **cp86**: G + docs sweep (backend test-framework doc, web README/account docs, sandbox README) + CHANGELOG. Gate: web suite; manual `?_dev_subscription` references gone.

Verification protocol per standing rules: backend `npm test` (parse audit) + sandbox corpus + cross-stack e2e, env-scrubbed, log-content verified.
