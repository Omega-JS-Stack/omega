# Sentry

Crash + error reporting for main, renderer, and preload contexts. Wraps `@sentry/electron` with desktop-specific config gating, dev-mode protection, and automatic user attribution from @omega.js/client auth state.

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

```
src/lib/sentry/
  index.js     # detects context (main/renderer) and re-exports the right module
  core.js      # shared: config gating, user normalization, release tagging
  main.js      # @sentry/electron/main + uncaughtException/unhandledRejection
  renderer.js  # @sentry/electron/renderer + window error/unhandledrejection
  preload.js   # minimal — preload is short-lived
```

Both main and renderer call `Sentry.init()` with the same DSN + release tag, so events from each process are attributed to the same release.

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

The user object is **normalized** before being sent — only `uid`/`id` and `email` are kept; everything else (display name, photo URL, OAuth provider data, etc.) is stripped to avoid accidentally leaking PII.

If you want to scrub email too, set `config.monitoring.scrubEmail: true`.

## Release tagging

Every event is tagged with `release: app.getVersion()` automatically. So you can filter Sentry events by app version to see which versions are still erroring out, which is critical for the auto-update flow (you want to verify a release ACTUALLY fixed an error, not just deployed without errors).

## Failure modes

- `@sentry/electron` not installed → silent no-op with one log line. Sentry isn't a hard dep, so dev environments without it work fine.
- DSN is wrong → SDK retries internally; events dropped silently. Check Sentry project's "Settings → Client Keys" if you're not seeing events.
- Sentry SDK throws during init → caught + logged; the rest of @omega.js/desktop continues to boot.

## Tests

`src/test/suites/build/sentry.test.js` — 11 tests covering config gating, dev mode protection, env-var overrides, user normalization, scrubbing, and main-process no-op behavior when SDK absent.
