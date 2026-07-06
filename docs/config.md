# omega.json5 — the single OMEGA config

One config file, identical shape, for every OMEGA project type. Owned by `@omegajs/config`
(`packages/config`); frameworks vendor it at prepare time and read **only** this format —
there is no dual-read of legacy files. Legacy brands migrate by converting their old config
once (mapping tables below) and deleting the old file.

## Location

| Project | File |
|---|---|
| Every project type (default) | `config/omega.json5` |
| Standalone backend repo | `functions/config/omega.json5` |
| Brand monorepo — brand level | `{brand}/config/omega.json5` |
| Brand monorepo — app level | `{brand}/apps/{app}/config/omega.json5` |

JSON5: comments, trailing commas, unquoted keys, single quotes all allowed.

## Shape

```json5
{
  // SHARED sections — identical spelling in every project type.
  // (`SHARED_SECTIONS` in @omegajs/config is the authoritative list.)
  brand:          { id, name, url, description, tagline, contact: { email }, address: {…}, images: {…} },
  firebaseConfig: { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId },
  analytics:      { providers: { google: { id }, meta: { id }, tiktok: { id } } },
  payment:        { processors: { stripe: { publishableKey }, paypal: { clientId }, chargebee: { site }, coinbase: { enabled } }, products: […] },
  sentry:         { dsn },
  oauth2:         { /* public client IDs only */ },
  theme:          { id, appearance },            // project-owned; seeded at onboarding

  // TARGET-scoped config. KEY PRESENCE = "this brand enables this target"
  // (replaces the legacy brand-config targets ARRAY). `extension: {}` means
  // enabled-with-defaults. Unknown keys are validation errors.
  targets: {
    web:       { /* @omegajs/web settings — defined in Phase 2 */ },
    backend:   { parent, github, reviews, marketing, blog, dataRequest },
    desktop:   { app, platforms: { mac, win, linux }, autoUpdate, startup,
                 releases, downloads, remoteConfig, restartManager },
    extension: { /* near-empty at launch */ },
    mobile:    { /* RESERVED — MAM parked */ },
  },
}
```

## Resolution

`loadConfig(projectDir, target, { defaults })` produces ONE resolved object per target:

```
framework defaults ← brand shared ← brand targets[target] ← app shared ← app targets[target]
```

- "shared" = the file minus its `targets` key. In a standalone repo only the app layers exist.
- **Target sections overlay the TOP LEVEL**: `targets.desktop.platforms` resolves to
  `config.platforms`; frameworks never read through `config.targets.<type>.…`.
- **Any shared key inside a target entry overrides it for that surface** — a desktop-only
  Sentry DSN is just `targets.desktop.sentry.dsn`; disabling any integration per-surface is
  uniformly `<key>: { enabled: false }`. One agnostic deep merge everywhere (objects merge,
  arrays/scalars replace, `null` replaces, `undefined` is skipped).
- The merged `targets` map rides along on the resolved config so enabled-target enumeration
  survives (`getEnabledTargets()`); the `enabled` flag on the result says whether the
  requested target is listed.
- No target argument → whole-file merge (the shape omega-manager's disperse works with).

## Hard rules

- **Secrets NEVER live in omega.json5** — they live in `.env`. `loadConfig` throws on any
  key matching `/(secret|privateKey|apiSecret)$/i` in any section of a raw file, before any
  merge. Public credentials (`publishableKey`, `clientId`, `firebaseConfig.apiKey`) pass by
  design.
- **The legacy `targets` ARRAY form throws** — `targets` is an object keyed by target name.
- Schema findings (required/type/match/enum) come back as `errors`, not throws — build-time
  audit throws on them, boot warns/fails per framework policy.

## Validation

`validateConfig(config, { target })` = shared schema + that target's refinements
(`TARGET_SCHEMAS[target]`), run against the RESOLVED config. `brand.id` (URL-scheme-safe
slug) and `brand.name` are the only universally required fields.

## Consumer access

Each framework exposes the vendored loader — e.g. EM: `require('electron-manager/config')`
→ `{ loadConfig, validateConfig, … }`. Consumer workflows use this instead of raw JSON5
reads so brand-monorepo resolution always applies.

## Migration — legacy configs → omega.json5

No framework reads the legacy files anymore. Convert once, delete the old file. General
recipe: shared-looking sections (brand, firebaseConfig, analytics, payment, sentry, theme,
oauth2) move to the TOP LEVEL verbatim; everything framework-specific moves under
`targets.<type>`.

### electron-manager (`config/electron-manager.json` → `config/omega.json5`) — DONE (checkpoint 18)

| Legacy | New |
|---|---|
| `brand`, `sentry`, `analytics`, `payment`, `firebaseConfig`, `theme` | top level, unchanged |
| `app` | `targets.desktop.app` |
| `targets.mac` / `targets.win` / `targets.linux` (per-OS) | `targets.desktop.platforms.mac` / `.win` / `.linux` |
| `autoUpdate`, `startup`, `releases`, `downloads`, `remoteConfig`, `restartManager` | `targets.desktop.<same key>` |
| `electronBuilder` overrides | `targets.desktop.electronBuilder` |
| `cdp` | `targets.desktop.cdp` |
| `windows` (optional) | `targets.desktop.windows` |
| `fileAssociations`, `protocols` | `targets.desktop.<same key>` |

### backend-manager (`functions/backend-manager-config.json` → `functions/config/omega.json5`) — at BEM's flip

| Legacy | New |
|---|---|
| `brand`, `firebaseConfig`, `analytics`, `payment`, `sentry`, `oauth2` | top level, unchanged |
| `parent`, `github`, `reviews`, `marketing`, `blog`, `dataRequest` | `targets.backend.<same key>` |

### ultimate-jekyll-manager (`_config.yml` + `ultimate-jekyll-manager.json`) — via `omega migrate` (Phase 2/4)

Handled by the `@omegajs/web` migration codemod, not by hand.

### omega-manager brand configs (`.brands/{id}/config.json`)

The brand-config `targets` ARRAY's role is absorbed by key presence in the omega.json5
`targets` object. omega-manager's disperse writes omega.json5 from brand config + state at
its Phase-3 cutover (enumerating `SHARED_SECTIONS`, per-surface values into
`targets.<type>` overrides).

## Package API (quick reference)

```js
const {
  loadConfig,          // (projectDir, target?, { defaults }?) → { config, errors, enabled, files }
  hasOmegaConfig,      // (projectDir) → boolean — "is this project migrated?"
  resolveConfigPath,   // (projectDir) → abs path | null
  getEnabledTargets,   // (config) → ['web', 'backend', …]
  validateConfig,      // (config, { target }?) → { errors }
  runSchema,           // low-level rule walker (EM's proven engine)
  formatErrors,        // errors → numbered block
  findSecretKeys,      // (object) → dot-paths of secret-shaped keys
  deepMerge,           // agnostic layer merge
  TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS,
} = require('@omegajs/config');
```
