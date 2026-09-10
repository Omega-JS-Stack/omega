# Monitoring — the one error-reporting contract

`@omega.js/monitoring` is the ONE home of error-reporting policy across every OMEGA target
([#380](https://github.com/Omega-JS-Stack/omega/issues/380)). Private workspace package, CJS,
vendored into the frameworks at prepare time — the same deal `@omega.js/analytics` gets.

Before it, three surfaces each carried their own copy of "should we report, what release is this,
what may we send": @omega.js/client's `modules/sentry.js`, @omega.js/backend's hand-rolled
`Sentry.init`, and @omega.js/desktop's `lib/sentry/` split. They disagreed — on the release format,
on whether an email rides, on whether a dev build reports. Now they share one core and each host
supplies only what it alone can know.

## The doctrine (Ian, 2026-08-20)

- **Server and framework errors ALWAYS report.** Backend routes, cron, event triggers, desktop main,
  extension background: our code, our fault, no filter.
- **Client-side, only OUR framework code reports.** A web page shares its global with user-land
  scripts, ad and chat widgets, and whatever browser extension a visitor installed. None of it is
  ours to answer for, so a browser event reports only when an `@omega.js` bundle is on its stack.
- **Capture lives at SEAMS**, never in scattered try/catch: process hooks, the route error handler
  (`RouteContext.report()`), the event-trigger catch, the SDK's own global handlers.
- **PII is scrubbed by default.** The uid rides (it is the join key to the account); the email is
  OFF unless a config explicitly opts in.
- **Everything is OFF when the DSN is unset** — and when it is off, the SDK is never `require()`d
  or imported at all.

## Config

One block, `monitoring`, in omega.json5, with the monitor named as a KEY under `providers`
([#425](https://github.com/Omega-JS-Stack/omega/issues/425) — the same shape every role uses). DSN
presence IS the enable signal at runtime — there is no separate runtime `enabled` flag (the same
convention every other role section follows: a block's credentials are its switch); the role-level
`enabled: false` is the manager's skip switch for the provisioning service. Per-surface DSNs are
`targets.<type>.monitoring.providers.sentry.dsn` overrides.

```jsonc
monitoring: {
  enabled: true,                  // role-level, optional — false skips the monitoring service
  providers: {
    sentry: {                     // presence picks the monitor; no entry = none chosen
      org:              'acme',   // provisioning only (the manager's monitoring service writes it)
      dsn:              'https://…@o1.ingest.sentry.io/1',
      environment:      null,     // null = the host's gate names it ('production' / 'development')
      sampleRate:       1,        // error events kept, 0..1 — the sampling knob
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,  // browser only — session replay is opt-IN (0 = off, and off is the default)
      replaysOnErrorSampleRate: 0,  // browser only — replay of an ERRORING session; either rate above 0 loads the integration
      scrubEmail:       true,     // set false to opt IN to sending emails
      attachScreenshot: false,    // desktop only
      bundlePatterns:   ['/assets/js/'],  // browser only — the URLs that identify our bundles
    },
  },
}
```

Full schema: [config.md](config.md).

## The entries

| Entry | Who requires it | What it does |
|---|---|---|
| `./core` | everything | Pure policy: config resolution, release tag, user scrub, the bundle filter. No `process`, no SDK, no DOM — it is safe inside a page bundle. |
| `./env` | Node/Electron hosts | The `process.env` half of core's gate seam: the four switches below. |
| `./node` | `@omega.js/backend` | Boots `@sentry/node` and hands the module back (or `null`). |
| `./browser` | `@omega.js/client` | Builds the `@sentry/browser` init options — integrations plus the ONE `beforeSend` that decides what leaves a page. |
| `./main` `./renderer` `./preload` | `@omega.js/desktop` | The `@sentry/electron` per-context wrappers. |
| `.` | `@omega.js/desktop` | The Electron context delegator: `process.type === 'renderer'` picks the renderer module, anything else the main one. |

Core is pure ON PURPOSE. The browser bundle imports it, so an env read there would be a
ReferenceError on a live page — every environment signal is passed IN as a gate, and `env.js` is
where the reads live for hosts that have a process. A package test pins this.

## The switches

In the order they win:

| Env var | Effect |
|---|---|
| `OMEGA_SENTRY_ENABLED=false` | Kill switch. Nothing reports, ever. |
| `OMEGA_TEST_RUNNER` | A test run never pollutes a live project. |
| `OMEGA_SENTRY_FORCE=true` | Report from a non-production run (local proving). |
| `OMEGA_BUILD_MODE=true` | The default production signal, for a host with no runtime one. |

The production signal is the host's to supply. @omega.js/desktop has no runtime answer — "should we
ship telemetry" is a property of its BUILD — so it falls through to `OMEGA_BUILD_MODE`.
@omega.js/backend has one (`Manager.isProduction()`, env-derived and stable for the life of the
process) and passes it in, alongside its own `reportErrorsInDev` option.

## Release tags

**ONE format on every target (Ian, 2026-08-20): `<brand.id>@<version>`.** A Sentry release is only
comparable across the backend, the desktop app and the browser bundles when all three spell it the
same way, so `core.releaseTag({ id, version })` builds that shape and nothing else — miss either
half and there is NO tag (a bare version is not a second format). `brand.id` is required config, so
a missing id is a config hole, not a supported case.

Each host supplies its own version identity:

| Host | Version source |
|---|---|
| `@omega.js/backend` | the functions package version. The id is `brand.id`, falling back to the project id on a config missing one (which already warns at boot). |
| `@omega.js/desktop` (main + renderer) | `app.getVersion()` — the packaged app version, with `brand.id` read off the resolved config |
| `@omega.js/client` in `@omega.js/extension` | the extension target's package version, baked into the build blob as `config.version` |
| `@omega.js/client` in `@omega.js/web` | the website target's package version, read off the target root's package.json and emitted in the page `Configuration` block as `version` |
| `@omega.js/client` in the `@omega.js/desktop` renderer | the desktop target's package version, folded into `OMEGA_BUILD_JSON.config` at bake time (the renderer only ever sees `buildJson.config`) |

The client reads `config.version` and falls back to `config.buildTime`. Every host above bakes a
version now, so the fallback covers only a blob that carries none — a surface embedding the client
by hand. Nothing tags a build stamp by design.

## Where capture happens

| Surface | Seam |
|---|---|
| Backend routes | `RouteContext.report()` — 5xx captures automatically, 4xx never ([backend guide](../backend/index.md)) |
| Backend event triggers | `helpers/event-middleware.js` — a handler that throws, or a handler file that will not load, goes through the SAME `report()` door. A deliberate block (an `HttpsError`, or an explicit numeric 4xx code) is the trigger's 4xx and never captures — a string `.code` (`ENOENT`, `messaging/invalid-token`) is a system error, not a block, and reports. |
| Backend payment webhooks | the REFUSAL family's shared seam (`acknowledgeRefusal()` in `events/firestore/payments-webhooks/on-write.js`) captures ONE `warning` per refused event, tagged with the reason and the provider. A refusal is a decision, not a fault, so it never reports as an exception; a processed event reports nothing; and only IDS ride — the refusal stamp's own fields plus the event's ([#550](https://github.com/Omega-JS-Stack/omega/issues/550)). |
| Desktop main | `@sentry/electron/main`'s own `OnUncaughtException` + `onUnhandledRejection` integrations. Desktop's process handlers log to `runtime.log` and are ADDITIVE — never a second capture. |
| Desktop renderer | the SDK's window `error` / `unhandledrejection` handlers |
| Browser (web, extension) | the SDK's global handlers, filtered by `beforeSend` to our bundles |

## The browser filter

`core.createBundleFilter(patterns)` checks every stack-frame filename an event carries against the
configured URL fragments. Default: `/assets/js/`, which is where both @omega.js/web and
@omega.js/extension serve every framework bundle (the client runtime included).

An event with **no matching frame is dropped**, and that includes an event with no frames at all — a
cross-origin `Script error.` is exactly the third-party noise this exists to kill. Deliberate
`omega.sentry().captureException(…)` calls are unaffected: they are thrown from page bundles, which
ARE our bundles. The corollary: a deliberate capture must pass an Error CONSTRUCTED in framework
code — hand it a frameless one (a bare cross-browser `fetch` TypeError, say, which some engines
raise with no usable stack) and the filter drops it, by design.

What survives the filter is scrubbed of credential-bearing auth params: `browser.scrubAuthParams()`
strips `?authPrivateKey` and `?authCustomToken` from every navigation breadcrumb (`data.from`/`data.to`,
which the SDK records around `history.replaceState` — including the strip that removes the key) and
from `event.request.url` (which `httpContext` attaches at capture time). A module constant, not
config: a page never opts its own credentials back into an event ([#661](https://github.com/Omega-JS-Stack/omega/issues/661)).

## How the config reaches a browser

The client reads a `sentry: { enabled, config }` namespace on its init blob, and every framework
maps it from `monitoring.providers.sentry`:

| Framework | Where |
|---|---|
| `@omega.js/web` | the `Configuration` block in `core/_includes/core/foot.html` — `resolved.monitoring.providers.sentry` → `sentry`. A real DSN is emitted AFTER the `resolved.client` loop, so the canonical home outranks a stale `client.sentry` ([#485](https://github.com/Omega-JS-Stack/omega/issues/485)); with no DSN there, the off state rides before the loop, so a brand not yet migrated off `client.sentry` keeps reporting |
| `@omega.js/extension` | `src/gulp/tasks/bundle.js` (`composeBuildConfig`, baked into every bundle) |

The client's `sentry.config` is the PROVIDER block, flat — nothing role-level ever rides into
`Sentry.init`. Node/Electron hosts pass the whole `monitoring` section instead and core's
`providerOptions()` reaches in for them: one home for the nesting, on the runtime side.
