# Config schema

@omegajs/desktop validates `config/omega.json5` against the canonical OMEGA schema in **`@omegajs/config`** (vendored into `dist/vendor/config/` at prepare time; also exposed to consumers as `require('@omegajs/desktop/config')`). The shared schema covers the cross-framework sections (brand, firebaseConfig, analytics, payment, sentry, oauth2, theme, targets); the desktop-specific refinements (app.category, platforms.win.signing.strategy, startup.mode, restartManager.*, …) live in the same package's `TARGET_SCHEMAS.desktop` and apply when validating with `{ target: 'desktop' }`. Validation always runs against the RESOLVED config — `targets.desktop` contents land at the top level (see the monorepo's `docs/config.md` for the format).

Validation runs in two places:

1. **`Manager.initialize()` (boot)** — hard-fails the app at boot if any required field is missing or any present field is invalid. So a misconfigured app never reaches the "white window of confusion" phase — it tells you exactly which field is broken.
2. **`gulp audit` (build)** — same schema, plus build-pipeline-specific extras (file-existence for icons, `releases.repo` in publish mode, etc.).

## Schema entry shape

```js
{
  path:        'brand.id',                     // dot-path into the config
  type:        'string' | 'boolean' | 'number' | 'array' | 'object',
  required:    true | false | (config) => bool,
  match:       /^[a-z][a-z0-9+\-.]*$/,         // string-value regex
  enum:        ['normal', 'hidden'],           // value-must-be-in-this-list
  description: 'Used for the deep-link scheme + default appId.',
}
```

## The `required` flag

@omegajs/desktop keeps validation simple: **`required` is either `true`, `false`, or a function**.

```js
required: true                    // hard-fail if missing
required: false                   // OK to omit (but if present, match/enum/type still run)
required: (cfg) => bool           // conditional — predicate gets the full config
```

The function form is for "this field is mandatory only when another part of config is set." Illustrative shape (no current entry uses it — every present-day field is `true` or `false`):

```js
{
  path:     'analytics.providers.google.id',
  required: (cfg) => Boolean(cfg?.analytics?.providers?.google?.secret),  // id mandatory only when a secret is configured
  match:    /^G-[A-Z0-9]+$/,
}
```

This is identical strictness in dev and production. There's no separate `'publish-only'` tier — if a field truly matters only for builds, validate it inside `gulp/audit.js` (next to `fileMustExist` calls for icons, etc.) rather than the schema.

## How `match` / `enum` / `type` interact with absence

They **only run when the value is present**. A missing field with `required: false` is silent. A missing field with `required: true` fires the "missing" error and nothing else — so consumers don't see a confusing flood of "missing AND wrong type AND doesn't match" for the same field.

## Presence-driven feature flags (@omegajs/backend convention)

A non-empty credential value enables a feature — there is no separate `enabled: true/false` flag for credential-gated features:

| Feature | Enable signal | Disable signal |
|---|---|---|
| Sentry | `sentry.dsn = 'https://...'` | `sentry.dsn = ''` |
| GA4 analytics | `analytics.providers.google.id = 'G-XXXXX'` | `analytics.providers.google.id = ''` |
| Firebase Auth (renderer) | `firebaseConfig.projectId = '...'` (etc.) | empty `firebaseConfig` |

**Exceptions where an explicit `enabled` flag exists:** `remoteConfig.enabled`, `autoUpdate.enabled`, `releases.enabled`, `downloads.enabled`, `restartManager.enabled`, `startup.openAtLogin.enabled`, `platforms.linux.snap.enabled`. These toggle BEHAVIOR, not credentials — you can have `releases.repo` set but still want releases off in a fork, for example.

## Adding a new field

When you add a new config knob anywhere in @omegajs/desktop:

1. Add an entry to `TARGET_SCHEMAS.desktop` in `@omegajs/config` (`packages/config/src/schema.js` in the Omega monorepo) — or to `SHARED_SCHEMA` if the field is genuinely cross-framework.
2. If it has a default, set it in [`src/defaults/config/omega.json5`](../src/defaults/config/omega.json5) (under `targets.desktop` for desktop-scoped fields).
3. That's it. No separate validation logic to add elsewhere — the schema entry is the validation.

## What's NOT in the schema

These checks live in [`gulp/tasks/audit.js`](../src/gulp/tasks/audit.js) instead, because they depend on build-pipeline state rather than the config shape:

- **`src/main.js` / `src/preload.js` existence** — webpack will fail without them but the schema doesn't know about consumer entry points.
- **`brand.images.icon` file existence** — only enforced when packaging (`isBuildMode()` / `isPublishMode()`); dev runs with the default Electron icon.
- **`releases.repo` presence** — only enforced in publish mode.

These are kept in `audit.js` so the schema stays a pure description of the config shape, callable from any context without dragging in build state.

## Examples

Required field missing:

```
@omegajs/desktop: config validation failed — fix the following in config/omega.json5:
  1. config.brand.id is required — URL-scheme-safe slug. Used as deep-link scheme + default appId. Must be lowercase, start with a letter, alnum/+/-/.
```

Field present but invalid:

```
  1. config.startup.mode "tray-only" is not allowed — must be one of [normal, hidden]
  2. config.brand.id "My App!" does not match expected pattern /^[a-z][a-z0-9+\-.]*$/ — URL-scheme-safe slug. Used as deep-link scheme + default appId. Must be lowercase, start with a letter, alnum/+/-/.
```

Errors are numbered so you can fix everything in one pass instead of fix-rebuild-fix-rebuild.

## Adding payment fields (@omegajs/backend-shaped)

@omegajs/desktop's schema mirrors [@omegajs/backend's `manager-config.example.json`](https://github.com/itw-creative-works/backend-manager) shape for payment so the same product catalog reads identically on backend, web, and desktop:

```js
{
  payment: {
    processors: {
      stripe: { publishableKey: 'pk_live_...' },     // schema: match /^pk_(test|live)_/
      paypal: { clientId: '...' },
    },
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { credits: 100 } },
    ],
  },
}
```

The schema only enforces shape for the few well-defined publishable keys — the product catalog itself is freeform so @omegajs/backend can extend it without @omegajs/desktop caring.

## Source

- Schema definitions + validator engine: `@omegajs/config` (`packages/config/src/{schema,validate}.js` in the Omega monorepo; vendored copy at `dist/vendor/config/`)
- @omegajs/desktop integration tests: [`src/test/suites/build/validate-config.test.js`](../src/test/suites/build/validate-config.test.js)
