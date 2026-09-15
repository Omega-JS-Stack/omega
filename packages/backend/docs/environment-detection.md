# Environment Detection

`getEnvironment()` returns exactly ONE of three mutually-exclusive, exhaustive values:

```javascript
Manager.getEnvironment()    // 'development' | 'testing' | 'production'

Manager.isDevelopment()     // true ONLY in development
Manager.isTesting()         // true ONLY in testing
Manager.isProduction()      // true ONLY in production
```

**ONE input, and no default** ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). `getEnvironment()` is `@omega.js/config`'s [environment.js](../../config/src/environment.js), the module @omega.js/desktop, @omega.js/extension, @omega.js/web and @omega.js/client all answer from. It reads the `OMEGA_ENVIRONMENT` variable and nothing else, and a process whose lane never named one **throws**, naming the variable. `Manager.init()` sets it ONCE, right after the `.env` cascade loads, from `envEnvironment()`, the AMBIENT answer, whose rules are the ones this file always described (below). Nothing re-sniffs a raw signal at read time. The three `is*()` checks **derive** from it live on every call, so they can never disagree with `getEnvironment()`.

**the route context (ctx) forwards to the Manager.** Request handlers receive an `ctx`, so the same methods are exposed there and return identical results — call whichever is in scope:

```javascript
ctx.getEnvironment()  // === Manager.getEnvironment() — a thin forward
ctx.isTesting()       // === Manager.isTesting()
```

(An ctx always has a Manager — `init()` throws without one. The `ctx.meta.environment` field is still populated for code that reads it, but the `is*()` checks no longer depend on that snapshot.)

**The three checks are mutually exclusive**: exactly one is true. `isDevelopment()` is **false** during testing, and `isProduction()` is a real positive check (it is NOT `!isDevelopment()`).

## Available helpers

| Helper | Returns |
|---|---|
| `getEnvironment()` | `'development' \| 'testing' \| 'production'`: the one reader of the one input; throws when it is absent. |
| `isDevelopment()` | `true` ONLY in development (local Firebase emulator / dev), and NOT testing. Derives from `getEnvironment()`. |
| `isTesting()` | `true` ONLY in testing. Derives from `getEnvironment()`. |
| `isProduction()` | `true` ONLY in production (deployed Cloud Functions). A **real positive check** — NOT `!isDevelopment()`. |

## Gating side effects — use the INTENTIONAL check

Because there are three environments, never gate a side effect on a two-value assumption. State what you mean:

```javascript
// Production-only (skip real emails/analytics/Sentry/webhooks in dev AND testing):
if (isProduction())  { /* do the real thing */ }
if (!isProduction()) { /* skip / use the safe local behavior */ }

// Local-or-test (anything that should run in BOTH dev and testing):
if (isDevelopment() || isTesting()) { /* localhost URL, console logging, etc. */ }
```

**Avoid** `if (!isDevelopment())` or `if (env !== 'development')` to gate production behavior — those wrongly include `testing` as production and leak real side effects (emails, analytics, Sentry) during test runs. This is the bug class that motivated the 3-value model.

## URL helpers

```javascript
Manager.getApiUrl()  // this brand's API URL — the SSOT for calling the @omega.js/backend API
```

**`Manager.getApiUrl()` is the one and only way to get the API URL.** It resolves to the **local** hosting emulator (`http://localhost:5002`) in development OR testing, and to production (`https://api.{domain}`) otherwise. Always call `getApiUrl()` directly — do NOT read the cached `Manager.project.apiUrl` property (it's a boot-time snapshot kept only for internal env-var export; the getter is the SSOT and always fresh). Build full endpoints by appending the path: `` `${Manager.getApiUrl()}/omega/admin/post` ``.

Resolving local in test mode is required because tests hit the local emulator — without it, internal @omega.js/backend→@omega.js/backend calls (and tests calling `getApiUrl()`) would leak to the live production server. Pass an explicit `env` arg (`getApiUrl('production')`) only to force a specific environment regardless of the current one — rarely needed, and mainly used by tests to pin a specific environment's mapping.

**Local scheme follows the https stack:** when this process runs behind the mkcert TLS proxy (`omega serve` / `omega emulator` set `OMEGA_HTTPS_PORT`), the local URLs carry `https` — `getApiUrl()` → `https://localhost:5002`, and `getWebsiteUrl()` follows the same signal for the website dev server (`https://localhost:4000`), since one mkcert install drives web and backend dev alike. Without the proxy (`--no-https` / no mkcert) both stay plain `http`. The **test runner** is the one child that never inherits `OMEGA_HTTPS_PORT`: it holds no mkcert CA, so `omega test` hands it hosting's internal plain-http port and every in-process getter answers `http://localhost:<hosting>` ([docs/test-framework.md](test-framework.md#the-stack-the-runner-child-resolves)).

> `getFunctionsUrl()` (raw Cloud Functions URL) exists for the ONE internal case that must name a specific deployed function by its raw address (`ctx.tryUrl()`). Application/route code should never need it — use `getApiUrl()`.

**Exception — parent helpers stay live:** `Manager.getParentApiUrl()` / `getParentUrl()` ALWAYS return the live production URL, even in dev/test. The parent @omega.js/backend is a real remote server with no localhost equivalent, so cross-brand parent calls are never redirected to localhost.

## Where they live

Source: `@omega.js/config`'s [environment.js](../../config/src/environment.js) for the four environment calls, assigned onto the Manager in [src/manager/index.js](../src/manager/index.js) beside the URL helpers (@omega.js/backend has a single Manager, no multi-context mixin). The env reader re-exports the same function as `env.getEnvironment()` for the provider libraries, which hold no Manager handle. The `ctx` exposes the same methods and forwards each to its Manager (`ctx.isTesting()` → `Manager.isTesting()`), so request handlers can call whichever object is in scope.

## How detection works

`getEnvironment()` reads ONE input, `process.env.OMEGA_ENVIRONMENT`, and throws
when it is absent ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
@omega.js/backend is the target whose deployed runtime legitimately arrives with
no lane above it, so `Manager.init()` resolves that input ONCE, from
`@omega.js/config`'s `envEnvironment()`: the AMBIENT answer, whose precedence is
unchanged:

1. **Testing** — `process.env.OMEGA_TEST_MODE === 'true'` (set by the test runner / emulator). A test run is a test run regardless of any other signal.
2. **Production** — `process.env.ENVIRONMENT === 'production'`.
3. **Development** — `process.env.ENVIRONMENT === 'development'`, or `FUNCTIONS_EMULATOR` is set, or `TERM_PROGRAM` is `Apple_Terminal` / `vscode` (running locally).
4. **Else**: production. A deployed Cloud Function has no `FUNCTIONS_EMULATOR` and often no `ENVIRONMENT`, so "no signal" IS the normal production state.

A deploy that named its own environment already set `OMEGA_ENVIRONMENT`, and the
boot leaves it exactly as it is. `envEnvironment()` is the PRODUCER of the input,
never a second reader of it, and it honors an already-set value first so the two
can never disagree inside one process. The whole table of who names what across
the frameworks lives in [docs/shared/config.md](../../../docs/shared/config.md).

## Adding a new helper

If you need a new environment-derived helper, add it next to the others on the Manager in [src/manager/index.js](../src/manager/index.js), and forward it from the route context (ctx) if request handlers need it. Don't read `process.env` ad-hoc elsewhere — derive from `getEnvironment()` so there is one source of truth and no chance of drift.

## Why this matters

**One signal, used everywhere.** The test runner sets `OMEGA_TEST_MODE=true`; every piece of code that calls `isTesting()` (framework or consumer) then sees `true` — no need to invent a per-module env var.

**Sub-modules check the same signal.** When framework code (an analytics flush, a webhook fan-out) needs to skip side effects in tests, it checks `isTesting()` — the same answer the consumer's own code gets. No drift.

**`is*()` can never disagree with `getEnvironment()`.** Because the checks derive from the single resolver instead of reading raw signals, there is exactly one definition of "what environment is this," and a wrong-but-confident gate (leaking real emails during a test run) is structurally impossible. Since #817 that holds ACROSS frameworks too: the resolver is one shared module, so no two OMEGA targets can answer differently from the same inputs.

## See also

- [test-framework.md](test-framework.md) — `OMEGA_TEST_MODE` is set automatically by the test runner; `TEST_EXTENDED_MODE` gates real external APIs.
