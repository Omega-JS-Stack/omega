# Sentry

Crash + error reporting for main, renderer, and preload contexts. Wraps `@sentry/electron` with
config gating, dev-mode protection, and automatic user attribution from @omega.js/client auth state.

The policy is NOT desktop's own: it lives in `@omega.js/monitoring`, the shared error-reporting
contract every OMEGA target runs on ([docs/shared/monitoring.md](shared/monitoring.md)). Desktop
requires the package directly (`require('@omega.js/monitoring')` in `src/main.js`, vendored into
`dist/vendor/monitoring/` at prepare) — there is no `src/lib/sentry/` any more.

## Config (`config/omega.json5`)

```jsonc
monitoring: {
  provider:         'sentry',
  dsn:              'https://...@sentry.io/0',
  environment:      null,                    // null = auto-detect ('production' if OMEGA_BUILD_MODE=true, else 'development')
  tracesSampleRate: 0.1,
  attachScreenshot: false,
}
```

Presence-driven: a non-empty `dsn` enables sentry — no separate `enabled` flag (matches the
@omega.js/backend convention). The `provider` discriminator is stripped before the rest of the
block feeds `Sentry.init`.

## Enable / disable rules

Sentry is **disabled** in any of these cases:
- `config.monitoring.dsn` is empty
- `OMEGA_SENTRY_ENABLED=false` env var
- Running in development mode (`OMEGA_BUILD_MODE` is not `'true'`) **AND** `OMEGA_SENTRY_FORCE` is not `'true'`

This means dev builds don't pollute your Sentry project with spurious errors. Override with `OMEGA_SENTRY_FORCE=true npm start` if you want to test sentry locally.

## Per-context architecture

The split moved WHOLE into the shared package (#380) — same files, same shapes:

```
@omega.js/monitoring
  .            # detects context (main/renderer) and re-exports the right module
  ./core       # shared policy: config gating, user normalization, release tagging (pure)
  ./env        # the process.env switches
  ./main       # @sentry/electron/main + uncaughtException/unhandledRejection
  ./renderer   # @sentry/electron/renderer + window error/unhandledrejection
  ./preload    # minimal — preload is short-lived
```

Both main and renderer call `Sentry.init()` with the same DSN + release tag, so events from each process are attributed to the same release.

Uncaught exceptions and unhandled rejections in main are captured by the SDK itself — its
`OnUncaughtException` integration and node's `onUnhandledRejection` integration are both in the
default set. Desktop's own `process.on('uncaughtException'|'unhandledRejection')` handlers in
`src/main.js` write to `runtime.log` and are ADDITIVE; nothing here adds a second capture.

## Public API

Same surface in main and renderer:

```js
manager.sentry.captureException(error, { extra: { ...context } })
manager.sentry.captureMessage('explicit log', 'info' | 'warning' | 'error')
manager.sentry.setUser({ id, email })   // or null to clear
```

In renderer (via preload bridge): `window.desktop.sentry` would expose the same surface — currently not wired (preload doesn't yet bridge sentry; renderer code can call `@sentry/electron/renderer` directly if it needs to).

## Auth attribution

When the user signs in via `client-bridge`, @omega.js/desktop automatically calls `manager.sentry.setUser({ id, email })`. On sign-out, `setUser(null)` clears the context. So every error report is attributed to whoever was signed in at the time.

The user object is **normalized** before being sent — only `uid`/`id` is kept, and everything else (display name, photo URL, OAuth provider data, etc.) is stripped to avoid accidentally leaking PII.

The email is **scrubbed by default** (#380). Set `config.monitoring.scrubEmail: false` to opt in to sending it.

## Release tagging

Every event is tagged with `release: <brand.id>@<app.getVersion()>` automatically — the ONE release format every OMEGA target uses ([docs/shared/monitoring.md](shared/monitoring.md)). So you can filter Sentry events by app version to see which versions are still erroring out, which is critical for the auto-update flow (you want to verify a release ACTUALLY fixed an error, not just deployed without errors).

## Failure modes

- `@sentry/electron` not installed → silent no-op with one log line. Sentry isn't a hard dep, so dev environments without it work fine.
- DSN is wrong → SDK retries internally; events dropped silently. Check Sentry project's "Settings → Client Keys" if you're not seeing events.
- Sentry SDK throws during init → caught + logged; the rest of @omega.js/desktop continues to boot.

## Tests

- `packages/monitoring/test/` — the policy: config off-when-unset (with the SDK never loaded), the
  env switches, release formats, the scrub default, the browser bundle filter.
- `src/test/suites/build/sentry.test.js` — the desktop WIRING: the package entry resolves to the
  main-process module, a DSN-less config initializes to disabled, and every call on a disabled
  sentry is a silent no-op.
