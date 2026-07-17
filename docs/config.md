# omega.json5 — the single OMEGA config

One config file, identical shape, for every OMEGA project type. Owned by `@omega.js/config`
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
  // (`SHARED_SECTIONS` in @omega.js/config is the authoritative list.)
  brand:          { id, name, url, description, tagline, contact: { email }, address: {…}, images: {…} },
  cloud:          { provider: 'firebase', config: { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId } },
  analytics:      { providers: { google: { id }, meta: { id }, tiktok: { id } } },
  advertising:    { providers: { 'google-adsense': { client, 'display-slot', 'in-article-slot', 'in-feed-slot', 'multiplex-slot' }, inhouse: { serverUrl } } }, // C4 cp105
  payment:        { processors: { stripe: { publishableKey }, paypal: { clientId }, chargebee: { site }, coinbase: { enabled } }, products: […] },
  monitoring:     { provider: 'sentry', dsn },
  oauth2:         { /* public client IDs only */ },
  theme:          { id, appearance },            // project-owned; seeded at onboarding
  translation:    { enabled, default, languages: [], provider: 'claude'|'chatgpt', model, exclude: [] }, // docs/translation.md

  // TARGET-scoped config. KEY PRESENCE = "this brand enables this target"
  // (replaces the legacy brand-config targets ARRAY). `extension: {}` means
  // enabled-with-defaults. Unknown keys are validation errors.
  targets: {
    web:       { /* @omega.js/web settings — defined in Phase 2 */ },
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
- **`projectDir` may be a backend's `functions/` dir** (@omega.js/backend's runtime cwd): the brand
  walk-up treats the app root as one level up, so `loadConfig(functionsDir, 'backend')`
  and `loadConfig(appRoot, 'backend')` resolve identically.
- **Target sections overlay the TOP LEVEL**: `targets.desktop.platforms` resolves to
  `config.platforms`; frameworks never read through `config.targets.<type>.…`.
- **Any shared key inside a target entry overrides it for that surface** — a desktop-only
  Sentry DSN is just `targets.desktop.monitoring.dsn`; disabling any integration per-surface is
  uniformly `<key>: { enabled: false }`. One agnostic deep merge everywhere (objects merge,
  arrays/scalars replace, `null` replaces, `undefined` is skipped).
- The merged `targets` map rides along on the resolved config so enabled-target enumeration
  survives (`getEnabledTargets()`); the `enabled` flag on the result says whether the
  requested target is listed.
- No target argument → whole-file merge (the shape omega-manager's disperse works with).

## Hard rules

- **Secrets NEVER live in omega.json5** — they live in `.env`. `loadConfig` throws on any
  key matching `/(secret|privateKey|apiSecret)$/i` in any section of a raw file, before any
  merge. Public credentials (`publishableKey`, `clientId`, `cloud.config.apiKey`) pass by
  design.
- **The legacy `targets` ARRAY form throws** — `targets` is an object keyed by target name.
- Schema findings (required/type/match/enum) come back as `errors`, not throws — build-time
  audit throws on them, boot warns/fails per framework policy.

## The .env cascade (secrets) — D15

Secrets mirror the config hierarchy (`src/env.js`), weakest → strongest:

```
company .env ← brand .env ← app .env ← shell env
```

- **Same walk as the config cascade**: `{brand}/apps/{app}` layers the brand root's `.env`
  under the app's; a brand stamped with `.omega/company.json` (written idempotently by
  company manage runs) layers its company root's `.env` underneath that. `findBrandRoot`
  in `load.js` is the ONE definition of the walk — both cascades use it.
- **Precedence via dotenv's no-override semantics**: files load strongest-first and never
  overwrite keys already set, so the shell always wins and app beats brand beats company.
- **Empty file values never claim a key (cp95a, friction #20)**: `KEY=` / `KEY=""` in any
  `.env` FILE means "documented here, value supplied by another layer" — a scaffolded app
  file full of placeholders can't shadow the brand root's real values. Only the shell can
  deliberately set a key to empty. The framework `_.env` templates ship `# KEY=` commented
  placeholders (the merge protocol keeps set values on their line, converges empties to
  the placeholder, and disperse uncomments a placeholder in place when composing a value).
- **Defined at the source, resolved at runtime/build**: a brand-wide `GH_TOKEN` lives once
  in the brand `.env`; every framework CLI/build resolves the chain at boot
  (`loadEnv(process.cwd())` in the web/desktop/extension CLIs + gulp pipelines,
  `loadEnv(functionsDir)` in the @omega.js/backend CLI and runtime). Nothing is copied
  between `.env` files just to be visible.
- **Backend's app layer is `functions/.env`** — it physically rides the Firebase deploy
  artifact (the cloud can't walk up), so omega-manager's disperse composes that ONE file
  from the resolved chain. In the cloud the walk finds no brand/company and behavior is
  identical to plain dotenv.
- Missing files and unreadable/stale markers skip silently — `loadEnv` never throws for
  an absent layer.

## Owner hooks (`config/hooks/`) — cp91

`src/hooks.js` — owner-supplied code the frameworks call at named hook points, so
company-specific logic lives in the OWNER'S tree, never in framework source. Layout is
**nested, mirroring the call site** (Ian's directive): the account service's password
step loads `config/hooks/account/password.js`; a future onboarding hook would live under
`config/hooks/onboard/…` — one file per hook point, path = the invoking structure.

- **Home = `config/`, versioned by default** (Ian 2026-07-11): hooks are AUTHORED code
  and sit with the other owner-authored omega inputs (omega.json5, seo.json5, chatsy.md,
  …) — never under machine-owned, gitignored `.omega/`, where a hook lost on a fresh
  clone would silently change behavior (passwords falling back to the seed channel and
  rotating). Secrets still belong in `.env` — a hook that needs one reads `process.env`;
  to keep a hook out of git anyway, add your own `config/hooks/` ignore line.
- **Resolution order**: the brand root's own `config/hooks/<point>.js`, else the company
  root's (via the `.omega/company.json` stamp) — a company-wide hook covers every brand,
  a single brand can still override it.
- **Contract**: plain CJS, `module.exports = ({ … }) => …` (async fine). Each call site
  documents its hook's signature/return. Absent hook → `loadHook` returns null and the
  caller uses its default behavior; a hook that EXISTS but is broken (unloadable,
  non-function export, bad return) throws — an owner who wrote a hook never gets silent
  fallback.
- **First (and so far only) hook point**: `account/password` —
  `({ email, domain, apex, brand }) => password` (string ≥ 6 chars), letting a company
  formula generate per-brand passwords without ever living in a repo the framework ships.

## Port auto-allocation (N7)

`src/ports.js` — classic defaults, probe at boot, per-port +1 bump only when taken, so
multiple brands run dev stacks concurrently. Single-brand dev with free defaults is
byte-identical to the pre-N7 behavior (no bumping, no artifacts).

- **`CLASSIC_PORTS`** — the historical defaults (functions 5001, hosting 5002, firestore
  8080, auth 9099, database 9000, storage 9199, pubsub 8085, ui 4050, website 4000,
  livereload 35729, cdp 9222).
- **`resolvePorts({ wanted, pins, claimed })`** — each wanted port keeps its value when
  free, bumps +1 until free when taken (shared `claimed` set prevents two names landing
  on one port). `pins` (the config `ports` section) never bump — a busy pin throws.
  The free-check is a TRIPLE bind-probe (127.0.0.1, ::1 when the host has IPv6, and
  the wildcard) — on macOS/BSD, wildcard and specific-address listeners COEXIST on one
  port, so any single-surface probe false-positives against a sibling brand's stack
  and the real bind crashes later (found live at cp186: the playground's https proxy
  holds IPv6 `*:5002`; a 127.0.0.1-only probe handed 5002 to the second brand's
  functions emulator).
- **Ports file** — `writePortsFile/readPortsFile/clearPortsFile(projectDir)`:
  `<projectDir>/.temp/ports.json` (pid-stamped; readers ignore dead-pid leftovers). The
  allocator (the backend emulator boot) writes it; siblings of the same brand
  (`omega test` against a running emulator, the e2e harness) read it; cleared on clean
  shutdown.
- **Env channel** — `portsToEnv(ports)` → `OMEGA_<NAME>_PORT` vars injected into spawned
  children; `envPort(name)` reads them. URL getters resolve env → classic default.
- **Browser channel (cp89)** — browser code can read neither env nor files, so it gets
  two channels, runtime winning: `omega dev` bakes `dev: { ports }` into the
  Configuration chrome (its resolved website port + a live sibling backend's map read
  from that app's ports file — boot the backend first for a complete map; a page built
  before the backend booted picks it up on the next rebuild). Drivers that learn the
  map only after the chrome was baked set `window.__OMEGA_DEV_PORTS__` instead (the
  devkit e2e harness — the site builds BEFORE the emulator boots). `@omega.js/client`
  resolves runtime global → chrome `dev.ports` → classic defaults; its dev `getApiUrl`
  speaks plain http to a mapped `hosting` (the emulator serves http), https to a mapped
  `https` (`mgr serve`'s mkcert proxy), and keeps the classic
  `https://localhost:5002` serve assumption when no map was provided.
- **Website port (cp89)** — `omega dev` allocates through the same model: classic
  **4000** (pre-N7 it defaulted to 8080, colliding with the SAME brand's firestore
  emulator), bump when taken, `--port` flag or config `ports.website` pins; publishes
  its own ports file in the website app dir.
- **Serve + per-target ports (cp90)** — `mgr serve` allocates through the same model
  (`--port` pins, taken bumps — the old kill-the-incumbent check is gone) and PUBLISHES
  its map: `https` (the mkcert proxy) + `hosting` (the internal plain-http
  firebase-serve port), so `omega dev` bakes even a bumped serve into the chrome and
  Stripe webhook forwarding targets the port that actually speaks http (it used to aim
  plain http at the TLS proxy). Desktop + extension `serve` allocate `livereload` — two
  targets of one brand land on distinct ports — and desktop allocates `cdp` when
  requested (`OMEGA_CDP_PORT` set); desktop URL getters mirror the backend's
  env-channel reads (`https` → mkcert, `hosting` → plain http, classic otherwise).
  The manager's Google-OAuth loopback binds an EPHEMERAL port (`listen(0)`, RFC 8252)
  instead of pinning 9876. `getWebsiteUrl` (backend + desktop) now returns
  `http://localhost:4000` — the https form was a browsersync-era assumption no current
  dev server speaks. Packaged extension/desktop artifacts keep BUILD-TIME-BAKED ports
  by design (a shipped extension can't probe); the extension manifest's dev-website
  origin documents that inline.
- **Config `ports` section** (schema, optional object) — explicit pins for any port name;
  unset = auto-allocate.
- When a boot bumps emulator ports, the backend CLI materializes
  `firebase.resolved.json` next to firebase.json (same dir, so relative paths keep
  resolving) and boots firebase-tools with `--config`; the committed firebase.json never
  changes. Gitignored; removed on shutdown.

Design + slice plan: [plans/n7-port-allocation.md](../plans/n7-port-allocation.md).

## Validation

`validateConfig(config, { target })` = shared schema + that target's refinements
(`TARGET_SCHEMAS[target]`), run against the RESOLVED config. `brand.id` (URL-scheme-safe
slug) and `brand.name` are the only universally required fields.

## Tri-state provisioning values (#33)

Provisioning-flow keys (org, billing account, service/agent ids — anything a manage
flow can set up interactively) follow ONE contract, enforced by the manager's
config-flow engine (`packages/manager/src/lib/config-flow.js`):

| Value | Meaning |
|-------|---------|
| missing / `null` | ASK in an interactive run — the answer lands in omega.json5; without a TTY: warn + skip, aggregated in the run summary |
| `false` | The user opted OUT — silent skip, never prompt or warn again. `false` on an ancestor section (`chatsy: false`) opts out every key under it |
| anything else | Use it |

Every ask offers the opt-out (the gate's "Disable" and, in selection flows, an inline
"No …" choice), so `false` is always reachable; delete the line to be asked again.
First consumers: `gcp.organizationId` (asked at project creation — pick an org or
create standalone) and `gcp.billingAccount` (pick/create a billing account or stay
on Spark) — GCP-level resources live under `gcp`, not `firebase`. `firebase.supportEmail`'s
null auto-derives the authorizing user's email instead of asking.

## Consumer access

Each framework exposes the vendored loader — desktop: `require('@omega.js/desktop/config')`,
extension: `require('@omega.js/extension/config')` → `{ loadConfig, validateConfig, … }`.
Consumer workflows use this instead of raw JSON5 reads so brand-monorepo resolution
always applies.

## Writeback (comment-preserving edits)

omega.json5 is hand-edited — comments, key order, and quote style carry meaning — so
programmatic writes are surgical text edits, not a re-stringify (omega-manager's
serializer rewrote the whole file in canonical order and lost comments; this replaces
it). The manager's services use it to land resolved IDs in config: the SendGrid list,
the Beehiiv publication, Stripe/PayPal product IDs, the Firebase SDK config.

`applyConfigEdits(source, edits)` applies `{ 'dot.path': value }` edits to JSON5 text:
existing leaves get their value span replaced; missing branches insert as one property
before the containing object's closing brace (matching indent; house style: unquoted
keys, JSON.stringify strings, trailing commas). Every byte outside the edited spans
survives. Paths take dots, numeric array indexes, and `[key=value]` matchers that select
an array element by its own key — `payment.products[id=plus].stripe.productId` — so
writes self-locate in the file being edited instead of trusting an index computed from a
merged config. Array elements are never created.

Guarantees: edits whose value already matches are skipped entirely (reruns are
byte-identical); after every edit the result must JSON5-parse and hold the requested
value at the requested path, or the call throws and nothing is returned — a corrupted
config can't land on disk.

`writeConfigValues(projectDir, edits, { dryRun }?)` is the file-level form: resolves the
standard locations, skips the write when nothing changes, and returns
`{ path, changed, applied }` (`applied` = the paths that actually differed). The manager
wraps it in `lib/config-write.js` (`writeBrandConfig(context, edits)`) for the uniform
dry-run gate + logging.

## Migration — legacy configs → omega.json5

No framework reads the legacy files anymore. Convert once, delete the old file. General
recipe: shared-looking sections move to the TOP LEVEL (brand, analytics, payment, theme,
oauth2 verbatim; `firebaseConfig` becomes `cloud: { provider: 'firebase', config: {…} }` and
`sentry` becomes `monitoring: { provider: 'sentry', … }` — D12 provider-discriminated role
keys); everything framework-specific moves under `targets.<type>`.

### electron-manager (`config/electron-manager.json` → `config/omega.json5`) — DONE (checkpoint 18)

| Legacy | New |
|---|---|
| `brand`, `analytics`, `payment`, `theme` | top level, unchanged |
| `firebaseConfig` | **`cloud: { provider: 'firebase', config: {…} }`** (D12) |
| `sentry` | **`monitoring: { provider: 'sentry', dsn }`** (D12) |
| `app` | `targets.desktop.app` |
| `targets.mac` / `targets.win` / `targets.linux` (per-OS) | `targets.desktop.platforms.mac` / `.win` / `.linux` |
| `autoUpdate`, `startup`, `releases`, `downloads`, `remoteConfig`, `restartManager` | `targets.desktop.<same key>` |
| `electronBuilder` overrides | `targets.desktop.electronBuilder` |
| `cdp` | `targets.desktop.cdp` |
| `windows` (optional) | `targets.desktop.windows` |
| `fileAssociations`, `protocols` | `targets.desktop.<same key>` |

### backend-manager (`functions/backend-manager-config.json` → `functions/config/omega.json5`) — DONE (checkpoint 19)

| Legacy | New |
|---|---|
| `brand`, `analytics`, `payment`, `oauth2` | top level, unchanged |
| `firebaseConfig` | **`cloud: { provider: 'firebase', config: {…} }`** (D12) |
| `sentry` | **`monitoring: { provider: 'sentry', dsn }`** (D12) |
| custom keys (`omega`, `mcp`, …) | top level, unchanged |
| `parent`, `github`, `reviews`, `marketing`, `blog`, `dataRequest` | `targets.backend.<same key>` |

Notes: @omega.js/backend's framework-defaults layer is `templates/config/omega.json5` resolved through
the same loader and passed as `options.defaults`; `Manager.init()`'s
`backendManagerConfigPath` option is gone (the loader discovers the file); boot warns on
schema findings, `npx omega setup` is the hard audit. The sandbox brand dogfoods the full
hierarchy: shared sections live in `apps/sandbox-brand/config/omega.json5` (brand level),
the backend app file carries only `targets.backend`.

### browser-extension-manager (`config/browser-extension-manager.json` → `config/omega.json5`) — DONE (checkpoint 20)

| Legacy | New |
|---|---|
| `brand`, `analytics`, `theme` | top level, unchanged |
| `firebaseConfig` | **`cloud: { provider: 'firebase', config: {…} }`** (D12) |
| `sentry` | **`monitoring: { provider: 'sentry', dsn }`** (D12) |
| custom keys (`liveReloadPort`, …) | top level, unchanged |
| `analytics.providers.google.secret` | **`.env` → `GOOGLE_ANALYTICS_SECRET`** (secrets never in omega.json5; loader hard-fails) |
| *(no extension-specific keys yet)* | `targets.extension: {}` — presence = enabled; extension-specific settings land here |

Notes: `Manager.getConfig()` returns the RESOLVED config (missing file → `{}`; schema
findings warn once per process — BXM has no separate audit surface). The build snapshot
(`build.json` / `OMEGA_BUILD_JSON`) bakes `GOOGLE_ANALYTICS_SECRET` from the environment at
build time, same value flow as before. `bxm setup` scaffolds + merges `config/omega.json5`
(the defaults merge now preserves consumer-only keys at every level — it previously
dropped them).

### ultimate-jekyll-manager (`src/_config.yml` + `config/ultimate-jekyll-manager.json`) — `omega migrate` (B4, checkpoint 32)

One command converts the consumer in place (and `--check` previews without
writing). The converted file is validated through `loadConfig(root, 'web')`
before the report prints.

| Legacy | New |
|---|---|
| `url` | `brand.url` (site.url derives; empty `baseurl` dropped) |
| `brand`, `theme`, `oauth2` | top level, verbatim |
| `analytics.{google,meta,tiktok}` (flat scalars) | `analytics.providers.<p>.id` — the unified spelling; the web chrome emits the client's flat shape from it |
| `web_manager.firebase.app.config` | **`cloud: { provider: 'firebase', config: {…} }`** (top level); the engine composes `cloud.config` back into `web_manager.firebase.app.config` at build |
| `web_manager.payment` | **`payment`** (top level); composed back into `web_manager.payment` (pricing layouts + the client read it there); credential keys set to `false` (legacy "disabled") are dropped |
| `web_manager` (rest: auth, chatsy, sentry, cookieConsent, exitPopup, …) | `targets.web.web_manager` — the client-runtime settings blob, whole |
| `meta`, `socials`, `download`, `extension`, `favicon`, `manifest`, `icons`, `recaptcha`, `cloudflare`, `translation` | `targets.web.<same key>` (target overlay puts them back at the top level for web loads) |
| `permalink`, `pagination`, `collections`, `defaults`, `generators` | `targets.web.<same key>` (codemod rule 8's home — engine consumption of custom collections rides the consumer-theme waves) |
| UJM-json `distribute`, `sass.purgecss`, `imagemin`, `github.workflows` | `targets.web.{distribute,purgecss,imagemin,workflows}` — `imagemin` is LIVE (schema-known; `enabled: false` ships images verbatim, otherwise the build-time 320/640/1024 + webp matrix runs) |
| UJM-json `webpack`, `gems`; `_config.yml` Jekyll machinery (`plugins`, `exclude`, …) | dropped, noted in the report |
| secret-shaped keys anywhere | dropped + warned — move to `.env` |

Beyond config: the codemod rule table runs over `src/**` templates, the seed
`src/assets/js/main.js` is deleted (core main + boot runtime replace it;
customized ones are flagged with the port recipe), `main.scss`'s
`@use 'ultimate-jekyll-manager' with (…)` becomes `@use 'omega:main' with (…)`,
page-css self-`@use` lines are dropped, and Gemfile/Gemfile.lock/the legacy
configs are removed.

### omega-manager brand configs (`.brands/{id}/config.json`)

The brand-config `targets` ARRAY's role is absorbed by key presence in the omega.json5
`targets` object. omega-manager's disperse writes omega.json5 from brand config + state at
its Phase-3 cutover (enumerating `SHARED_SECTIONS`, per-surface values into
`targets.<type>` overrides).

## Package API (quick reference)

```js
const {
  loadConfig,          // (projectDir, target?, { defaults }?) → { config, errors, enabled, files }
  composeTargetConfig, // (projectDir, target) → { config, files } — brand+app frozen into ONE self-contained file (deploy upload boundary, #31)
  hasOmegaConfig,      // (projectDir) → boolean — "is this project migrated?"
  resolveConfigPath,   // (projectDir) → abs path | null
  getEnabledTargets,   // (config) → ['web', 'backend', …]
  findBrandRoot,       // (projectDir) → brand root | null — CLASSIFIES one app dir (THE hierarchy rule)
  resolveBrandRoot,    // (startDir) → brand root | null — SEARCHES upward from anywhere (standalone → itself)
  loadEnv,             // (startDir) → { chain, loaded } — resolve + load the .env cascade
  resolveEnvChain,     // (startDir) → { app, brand, company } .env paths (no loading)
  loadEnvChain,        // (paths) → loaded[] — dotenv strongest-first, nulls/missing skip
  readCompanyRoot,     // (brandRoot) → company root | null (.omega/company.json)
  COMPANY_MARKER,      // '.omega/company.json'
  resolveHook,         // (startRoot, 'account/password') → hook file | null (brand → company)
  loadHook,            // (startRoot, hookPath) → { fn, file } | null — broken hooks THROW
  validateConfig,      // (config, { target }?) → { errors }
  runSchema,           // low-level rule walker (EM's proven engine)
  formatErrors,        // errors → numbered block
  findSecretKeys,      // (object) → dot-paths of secret-shaped keys
  applyConfigEdits,    // (source, edits) → edited source — comment-preserving (see Writeback)
  writeConfigValues,   // (projectDir, edits, { dryRun }?) → { path, changed, applied }
  deepMerge,           // agnostic layer merge
  TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS,
} = require('@omega.js/config');
```
