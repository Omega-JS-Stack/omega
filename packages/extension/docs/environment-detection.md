# Environment Detection

`getEnvironment()` returns exactly ONE of three mutually-exclusive, exhaustive values:

```javascript
omega.getEnvironment()    // 'development' | 'testing' | 'production'

omega.isDevelopment()     // true ONLY in development
omega.isTesting()         // true ONLY in testing
omega.isProduction()      // true ONLY in production
```

**ONE input, and no default** ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). `getEnvironment()` reads the `OMEGA_ENVIRONMENT` variable in build-time Node, and the baked `OMEGA_BUILD_JSON.config.environment` in an extension context (which has no `process.env`). Nothing else is consulted: the `chrome.runtime.getManifest().update_url`, `OMEGA_BUILD_MODE` and `NODE_ENV` sniffs are gone, and a context with neither input **throws**, naming the variable. What an artifact WAS BUILT AS is what it answers, wherever it is loaded from.

**One implementation, shared with every sibling framework.** The four calls are `@omega.js/config`'s [environment.js](../../config/src/environment.js), the module @omega.js/desktop, @omega.js/web, @omega.js/backend and @omega.js/client all answer from. @omega.js/extension has eight entry points (build / background / popup / options / content / sidepanel / page / offscreen); [src/utils/mode-helpers.js](../src/utils/mode-helpers.js) re-exports the shared four beside the extension's own `getVersion()`. The build module exports them as plain functions, and every context's `omega` carries them as methods.

```javascript
omega.getEnvironment()                                   // same answer in every extension context
require('@omega.js/extension/build').isTesting()         // the build module, for build-time scripts
```

**The three checks are mutually exclusive**: exactly one is true. `isDevelopment()` is **false** during testing, and `isProduction()` is a real positive check (it is NOT `!isDevelopment()`).

## Available helpers

| Helper | Returns |
|---|---|
| `getEnvironment()` | `'development' \| 'testing' \| 'production'`: the one reader of the one input; throws when it is absent. |
| `isDevelopment()` | `true` ONLY in development (a dev BUILD), and NOT testing. Derives from `getEnvironment()`. |
| `isTesting()` | `true` ONLY in testing (a testing build, or a Node lane naming it). Derives from `getEnvironment()`. |
| `isProduction()` | `true` ONLY in production (a production BUILD). A **real positive check**, NOT `!isDevelopment()`. |

## Gating side effects — use the INTENTIONAL check

Because there are three environments, never gate a side effect on a two-value assumption. State what you mean:

```javascript
// Production-only (skip real telemetry / production behavior in dev AND testing):
if (isProduction())  { /* do the real thing */ }
if (!isProduction()) { /* skip / use the safe local behavior */ }

// Local-or-test (anything that should run in BOTH dev and testing):
if (isDevelopment() || isTesting()) { /* DevTools menu items, verbose logging */ }
```

**Avoid** `if (!isDevelopment())` or `if (env !== 'development')` to gate production behavior — those wrongly include `testing` as production and leak real side effects during test runs. This is the bug class that motivated the 3-value model. (A genuinely dev-only feature like live-reload is the exception: `env !== 'development'` correctly skips it in both testing and production.)

## URL helpers

@omega.js/extension owns ONE backend URL helper, `getApiUrl()` in [src/utils/url-helpers.js](../src/utils/url-helpers.js), a method of every context's `omega` beside the mode helpers. It follows the same local-in-dev/testing, production-otherwise convention as @omega.js/client's `getApiUrl`. The local port comes from whichever channel the context has: the `OMEGA_HTTPS_PORT` / `OMEGA_HOSTING_PORT` env vars (build-time Node and the test harness), then the `dev.ports` map the build baked into `OMEGA_BUILD_JSON` (a browser context has no `process.env`, so a bumped emulator port reaches it this way, [#744](https://github.com/Omega-JS-Stack/omega/issues/744)). There is no third step: the classic number used to be hand-typed under them and it is gone ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)). The classics still reach the helper, from the ONE place they are defined: the bundle task bakes `CLASSIC_PORTS` (`@omega.js/config`) as the FLOOR of the `dev` map, with the live stack's resolved numbers over them, so a dev artifact always carries a complete map and a read that finds none throws, naming the fact and the build step that writes it. The background worker's auth-emulator port walks the same chain. The rule "call the getter, never hardcode" applies everywhere; the page contexts' other backend URLs come from the `@omega.js/client` base class they extend.

## Where they live

Source: [src/utils/mode-helpers.js](../src/utils/mode-helpers.js) for `getEnvironment()` + `is*()` + `getVersion()`, plain functions. [src/build.js](../src/build.js) exports them as they are; the base class ([src/omega.js](../src/omega.js), which background, content and offscreen extend) calls them as methods, and the page contexts ([src/page-context.js](../src/page-context.js): popup, options, sidepanel, page) inherit the same shared four from `@omega.js/client`'s base class, so every extension context resolves the environment identically.

## How detection works

`getEnvironment()` reads ONE input, and there is no precedence ladder under it
([#817](https://github.com/Omega-JS-Stack/omega/issues/817)):

1. **`process.env.OMEGA_ENVIRONMENT`**, wherever this context has a `process` (build-time Node, the test harness).
2. **The baked `config.environment`** off the `omega` the call is made on, for every extension context. It is the build fact every OMEGA surface spells the same way ([#896](https://github.com/Omega-JS-Stack/omega/issues/896)), written into every bundle by the bundle task.
3. **Neither** is a loud error naming `OMEGA_ENVIRONMENT`. There is no default, because the four framework copies this replaced each had one and they disagreed: this one answered `development` with no signal while @omega.js/desktop's answered `production`.

[src/build.js](../src/build.js) names the input at LOAD, from the lane: `OMEGA_BUILD_MODE` (the `omega build` flag) is `production` and WINS over an inherited value, the `test` verb names `testing`, and a bare dev boot is `development`. That word is baked into every bundle, which is what the browser contexts read. The whole table of who names what lives in [docs/shared/config.md](../../../docs/shared/config.md).

## Adding a new helper

Write the function in [src/utils/mode-helpers.js](../src/utils/mode-helpers.js) (or a new `src/utils/<topic>-helpers.js` module), export it from [src/build.js](../src/build.js), and add the method to the base class ([src/omega.js](../src/omega.js)); the page contexts take it from `@omega.js/client`'s base class, so an environment helper the client lacks lands there too. Don't define a helper on one context alone: that leads to duplicated semantics. For anything environment-derived, derive from `getEnvironment()` rather than reading `chrome.runtime` / `process.env` directly, so there is one source of truth and no chance of drift.

## Why this matters

**One signal, used everywhere.** The `test` verb names `OMEGA_ENVIRONMENT=testing`, and the bundles that run names it too; every piece of code that calls `isTesting()` (framework or consumer) then sees `true`, no need to invent a per-module env var.

**Sub-modules check the same signal.** When framework code (an auto-update probe, an analytics flush) needs to skip side effects in tests, it checks `isTesting()` — the same answer the consumer's own code gets. No drift.

**`is*()` can never disagree with `getEnvironment()`.** Because the checks derive from the single resolver instead of reading raw signals, there is exactly one definition of "what environment is this," and a wrong-but-confident gate is structurally impossible. Since #817 that holds ACROSS frameworks too: the resolver is one shared module, so this framework and @omega.js/desktop can no longer answer differently from the same inputs.

## See also

- [test-framework.md](test-framework.md) — `OMEGA_TEST_MODE` is set automatically by the test runners; extended mode (`--extended` / `TEST_EXTENDED_MODE=true`) gates real external APIs.
