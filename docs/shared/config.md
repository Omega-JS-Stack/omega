# omega.json5 — the single OMEGA config

One config file, identical shape, for every OMEGA project type. Owned by `@omega.js/config`
(`packages/config`); frameworks vendor it at prepare time and read **only** this format —
there is no dual-read of legacy files. Legacy brands migrate by converting their old config
once (mapping tables below) and deleting the old file.

Consistency between this file and what pages actually say — brand facts read from config instead of typed,
one brand hex, the merge chain, secrets out of config — is the plugin's `omega:brandcheck` skill,
[agent-plugins/claude/skills/brandcheck/SKILL.md](../../agent-plugins/claude/skills/brandcheck/SKILL.md);
its quality hook fires on every `omega.json5` edit.

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
  brand:          { id, name, url, description, tagline, company, contact: { email, person: {…}, carbonCopy: […] }, address: {…}, images: {…} },   // contact.person = the human who signs "personal" email (name, firstName, image, url, urlText); contact.carbonCopy = audit BCCs; images.companyWordmark = parent wordmark in email footers
  cloud:          { provider: 'firebase', config: { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId }, messaging: { vapidKey }, shared, supportEmail, apiSubdomain, organizationId, billingAccount },   // ONE cloud home (#23): the app config PLUS the provisioning fields; projectId lives only at cloud.config.projectId. vapidKey: web-push public key (console → Cloud Messaging), public by design
  repo:           { providers: { github: { org, repo, shared, private } } },
  edge:           { providers: { cloudflare: { zone, dns, settings, rules, cacheRules, speedTest, workers } } },
  captcha:        { providers: { recaptcha: { project, siteKey } } },
  search:         { providers: { searchConsole: { submitSitemap, sitemapPaths } } },
  forms:          { providers: { slapform: { enabled, formId, templateFormId, updateFormInfo, plan } } },
  inbound:        { chat:  { providers: { chatsy:   { enabled, agentId, templateAgentId, updateAgentInfo, plan, sponsorshipsUrl, settings } } },
                    email: { providers: { replyify: { enabled, agentId, templateAgentId, updateAgentInfo, plan, discount } } } },
  analytics:      { providers: { google: { id }, meta: { id }, tiktok: { id } } },
  advertising:    { providers: { adsense: { client, displaySlot, inArticleSlot, inFeedSlot, multiplexSlot }, inhouse: { source } } },   // C4 cp105; inhouse source: 'self' | 'company' | full URL (ads spec)
  payment:        { processors: { stripe: { publishableKey }, paypal: { clientId }, chargebee: { site }, coinbase: { enabled } }, products: […] },
  monitoring:     { provider: 'sentry', dsn },
  oauth2:         { /* public client IDs only */ },
  theme:          { id, appearance },            // project-owned; seeded at onboarding
  translation:    { enabled, default, languages: [], provider: 'claude'|'chatgpt', model, exclude: [] }, // docs/shared/translation.md

  // TARGET-scoped config. KEY PRESENCE = "this brand enables this target"
  // (replaces the legacy brand-config targets ARRAY). `extension: {}` means
  // enabled-with-defaults. Unknown keys are validation errors. A value may
  // also be an ARRAY of id'd instances (see Multi-instance targets below).
  targets: {
    web:       { /* @omega.js/web settings — defined in Phase 2 */ },
    backend:   { parent, github, auth: { signup: { maxPerIpPerDay } }, reviews, marketing, blog, dataRequest },   // auth.signup.maxPerIpPerDay: signups allowed per client IP per day, positive integer, default 2. Raise it for audiences behind shared egress (NAT/CGNAT, VPNs, offices)
    desktop:   { app, platforms: { mac, win, linux }, autoUpdate, startup,
                 releases, downloads, remoteConfig, remoteScripts, restartManager },
    extension: { /* near-empty at launch */ },
    mobile:    { /* RESERVED — MAM parked */ },
  },
}
```

## Resolution

`loadConfig(projectDir, target, { defaults })` produces ONE resolved object per target:

```
framework defaults ← company ← brand shared ← brand targets[target] ← app shared ← app targets[target]
```

- "shared" = the file minus its `targets` key. In a standalone repo only the app layers exist.
- **The company layer** is the company workspace's own `config/omega.json5`, found through the
  brand's `.omega/company.json` stamp (the same marker the `.env` cascade and owner hooks read —
  see below). It layers exactly like the brand file (company shared ← company `targets[target]`)
  minus its `brands` key, which is company plumbing and never inherits. An unstamped brand has no
  company layer; the resolved result reports the file it used as `files.company`.
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

## Multi-instance targets

One brand can run N instances of the SAME target type (the legacy `brand.subdomains` need:
admin/cdn/app sites of one brand) — `targets.<type>` takes an **object OR an array of id'd
instances** ([_attic/plans/multi-instance-targets.md](../../_attic/plans/multi-instance-targets.md), ratified
2026-07-20):

```json5
targets: {
  backend: { /* single instance — today's shape, unchanged */ },
  web: [
    { id: 'main' },                                     // the primary — apps/website
    { id: 'admin', url: 'https://admin.acme.com',       // apps/website-admin
      brand: { name: 'Acme Admin' } },                  // overrides brand shared for admin ONLY
  ],
}
```

- **Normalization is the whole mechanism** (`normalizeTargetInstances`): a single object is
  `[{ id: 'main', ...entry }]` internally — every consumer iterates instances and the
  single-instance world is just length 1. Zero breaking change for existing brands.
- **App-dir mapping**: `main` → `apps/<canonical dir>` (unchanged); any other id →
  `apps/<canonical dir>-<id>`. The inverse walk names the instance from the dir
  (`website-admin` → web/admin), and `loadConfig`/`composeTargetConfig` slot THAT instance's
  entry into the merge chain: `defaults ← brand shared ← instance entry ← app shared ← app
  targets.<type>`. The instance `id` key is bookkeeping — stripped, never config. The result
  carries `instance` (the resolved id).
- **Validator rules**: array entries MUST carry a dir-safe `id`, unique per type; an empty
  array is an error; **>1 backend instance is a WARNING** (`warnings` on the result) — backend
  stays single-instance in practice (one Cloud Functions surface per brand).
- **Scoping rules**: the single-object form applies to EVERY app of the type (today's
  behavior, suffixed dirs included); the array form is exact-id — an app dir with no matching
  id rides shared config alone. The workspace structure op expects every instance's exact dir
  (missing = the same create-this-dir error as today).
- **Per-instance surfaces**: dev ports offset by array position (docs/shared/local-dev.md), deploy
  records key per app (docs/shared/deploys.md), the manager's live-URL checks use each instance's
  `url` (instance entry `url` → instance `brand.url` → brand shared `brand.url`).
- **Legacy `brand.subdomains` conversion rule**: each subdomain becomes a web instance —
  `["admin", "cdn"]` → `web: [{ id: 'main' }, { id: 'admin', url: 'https://admin.<domain>' },
  { id: 'cdn', url: 'https://cdn.<domain>' }]` (no migration tooling yet — this mapping is
  the recorded recipe).
- Non-goals (v1): no cross-instance shared builds, no per-instance Firebase projects.

## Hard rules

- **Secrets NEVER live in omega.json5** — they live in `.env`. `loadConfig` throws on any
  key matching `/(secret|privateKey|apiSecret)$/i` in any section of a raw file, before any
  merge. Public credentials (`publishableKey`, `clientId`, `cloud.config.apiKey`) pass by
  design.
- **The legacy `targets` ARRAY form throws** — `targets` is an object keyed by target name.
- Schema findings (required/type/min/match/enum) come back as `errors`, not throws — build-time
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
  `https://localhost:5002` serve assumption when no map was provided. Dev mode
  resolves the LOCAL stack for every source, including `source: 'company'` —
  `company.url` is a production concept, and dev deliberately makes no live server
  hits (ratified, Ian 2026-08-03, [#34](https://github.com/Omega-JS-Stack/omega/issues/34)).
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

Design + slice plan: [_attic/plans/archive/n7-port-allocation.md](../../_attic/plans/archive/n7-port-allocation.md).

## Validation

`validateConfig(config, { target })` = shared schema + that target's refinements
(`TARGET_SCHEMAS[target]`), run against the RESOLVED config. `brand.id` (URL-scheme-safe
slug) and `brand.name` are the only universally required fields.

**authDomain is the brand's own host** (cp268): when `cloud.config.authDomain` is set it
must equal the resolved brand host: the instance's own `url` when it has one, else
`brand.url`. A `*.firebaseapp.com` value hard-fails (self-hosted `/__/auth/*` on the brand
host is what keeps redirect sign-in working under browser storage partitioning; the web
build emits those helper files), and any other mismatch fails naming both values. Absent
passes, and `demo-*` (emulator-only) projects are exempt.

## Tri-state provisioning values (#33)

Provisioning-flow keys (org, billing account, service/agent ids — anything a manage
flow can set up interactively) follow ONE contract, enforced by the manager's
config-flow engine (`packages/manager/src/lib/config-flow.js`):

| Value | Meaning |
|-------|---------|
| missing / `null` | ASK in an interactive run — the answer lands in omega.json5; without a TTY: warn + skip, aggregated in the run summary |
| `false` | The user opted OUT — silent skip, never prompt or warn again. `false` on an ancestor section (`inbound.chat.providers.chatsy: false`) opts out every key under it |
| anything else | Use it |

Every ask offers the opt-out (the gate's "Disable" and, in selection flows, an inline
"No …" choice), so `false` is always reachable; delete the line to be asked again.
First consumers: `cloud.organizationId` (asked at project creation — pick an org or
create standalone) and `cloud.billingAccount` (pick/create a billing account or stay
on Spark). ONE cloud home (#23, reversing the old `gcp`-vs-`firebase` split): the
platform-level org and billing account, the provisioning switches (`cloud.shared`,
`cloud.supportEmail`, `cloud.apiSubdomain`) and the app config (`cloud.provider`,
`cloud.config`) are all `cloud.*`, and the project id has exactly one address —
`cloud.config.projectId`. `cloud.supportEmail`'s null auto-derives the authorizing
user's email instead of asking.

## The site global: curated targets + derived page maps (#85)

`toSiteGlobal()` (the web build's `site.*`) strips the raw `targets` machinery and
replaces it with a CURATED `site.targets` — an allow-list of display-safe facts per
declared target, never a spread of the raw config: every entry carries `enabled: true`,
desktop adds a derived `releasesUrl` once releases are opted in, extension adds its
store `listings`.

- **The desktop derivation is OPT-IN (#124)**: `releasesUrl` and the derived
  `site.download` appear only when `targets.desktop.releases` is present (its
  `enabled` defaults true when the block exists); `releases.enabled: false` always
  suppresses, and a bare desktop target with no `releases` block derives nothing —
  declaring the target does not mean a release exists yet. `releases.enabled` is ONE
  switch for the whole release surface: the desktop build also reads it
  (electron-builder publish config), so `false` turns off desktop publishing too — and
  there it defaults true even with no `releases` block.
- **Desktop releases URL**: `https://github.com/<repo.providers.github.org>/<repo>/releases/latest`,
  where repo is `targets.desktop.releases.repo` (where built artifacts live) →
  `repo.providers.github.repo` → `brand.id`. No `repo.providers.github.org` → no URL.
- **Extension listings**: `targets.extension.listings.<store>.{url,state}` for the six
  stores the theme renders (chrome, firefox, edge, opera, safari, brave) —
  schema-declared; url must be http(s). Entries with neither url nor state stay absent.
- **Idempotent by contract**: the web build applies `toSiteGlobal` twice (loadSiteData,
  then configureOmega) — a curated `releasesUrl` survives the second pass unchanged.
- **Array-form (multi-instance) targets derive nothing** — presence only: which
  instance's facts belong on the site is ambiguous, so instance-form brands supply
  explicit page maps.

The download and extension pages populate from these with no hand-supplied links:
when the config has no explicit `download`/`extension` page map, `site.download`
derives from an opted-in desktop target (every desktop platform → the releases URL,
the exact shape brands used to hand-write) and `site.extension[browser]` derives from
the listings' urls. An explicit map in config always wins over the derivation.

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

**Retired keys fail loudly** ([#142](https://github.com/Omega-JS-Stack/omega/issues/142)):
a name that was renamed OUTRIGHT is a validation error wherever it sits — shared level,
inside a `targets.<type>` entry, inside an instance array — naming its replacement and
pointing back here. Today that is `web_manager` → `client` and `firebaseConfig` → `cloud`
(`src/retired-keys.js` is the list). Without the guard the old key validated clean and
everything under it vanished, since nothing dual-reads it. Names that live on as legitimate
keys elsewhere (`sentry`, which survives as `client.sentry`; `google`/`meta` under
`analytics.providers`) stay out of the list — the rows below are their only guide.

The de-branding rekey ([#23](https://github.com/Omega-JS-Stack/omega/issues/23)) adds a
second, PATH-based half in the same file (`RETIRED_PATHS`): keys whose provider keeps its
own name one level down inside the new home, so a name test would false-positive. Each
entry matches ONE exact path from the root:

| Retired path | New home |
|---|---|
| `slapform` | **`forms.providers.slapform`** |
| `chatsy` | **`inbound.chat.providers.chatsy`** (the widget `settings` moved here too — one home) |
| `replyify` | **`inbound.email.providers.replyify`** |
| `cloudflare` | **`edge.providers.cloudflare`** |
| `recaptcha` | **`captcha.providers.recaptcha`** (`site-key` → `siteKey`) |
| `searchConsole` | **`search.providers.searchConsole`** (`seo` already means the parasite-SEO content feature) |
| `gcp` | **`cloud`** (`cloud.organizationId`, `cloud.billingAccount`) |
| `firebase` | **`cloud`** (`cloud.shared`, `cloud.supportEmail`, `cloud.apiSubdomain`; projectId only at `cloud.config.projectId`) |
| `advertising.providers.google-adsense` | **`advertising.providers.adsense`** + camelCase slots |
| `github` | **`repo.providers.github`** — the ONE row with no guard: rules run against the RESOLVED config, where `targets.backend.github` (content identity, unchanged) is overlaid at the top level and would false-positive. This table is its only guide |

The
`omega migrate` converter is unaffected: it READS legacy files as input and emits the new
names, and only its output is validated.

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
| `web_manager.firebase.app.config` | **`cloud: { provider: 'firebase', config: {…} }`** (top level); the engine composes `cloud.config` back into `client.firebase.app.config` at build |
| `web_manager.payment` | **`payment`** (top level); composed back into `client.payment` (pricing layouts + the client read it there); credential keys set to `false` (legacy "disabled") are dropped |
| `web_manager` (rest: auth, sentry, cookieConsent, exitPopup, …) | **`targets.web.client`** — the client-runtime settings blob, whole, under its new name (#1: `web_manager` → `client`, since it configures `@omega.js/client`; WebManager is not an OMEGA concept). No dual-read: the old key name is not honored anywhere |
| `web_manager.chatsy` (agentId + widget settings) | **`inbound.chat.providers.chatsy`** — the chat widget left the client blob for the one chat home the manager also provisions (#23) |
| `meta`, `socials`, `download`, `extension`, `favicon`, `manifest`, `icons`, `translation` | `targets.web.<same key>` (target overlay puts them back at the top level for web loads) |
| `recaptcha` (incl. `site-key`) | **`captcha.providers.recaptcha`** (`siteKey` — every key is camelCase, #23) |
| `cloudflare` (the purge `zone`) | **`edge.providers.cloudflare`** — one cloudflare home, shared with the manager's zone reconciliation (#23) |
| `advertising.google-adsense` (flat or under `providers`) | **`advertising.providers.adsense`** with camelCase slots (`displaySlot`, `inArticleSlot`, `inFeedSlot`, `multiplexSlot`) — provider ids drop the vendor prefix (#23) |
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
  loadConfig,          // (projectDir, target?, { defaults }?) → { config, errors, warnings, enabled, instance, files }
  composeTargetConfig, // (projectDir, target) → { config, files } — company+brand+app frozen into ONE self-contained file (deploy upload boundary, #31)
  hasOmegaConfig,      // (projectDir) → boolean — "is this project migrated?"
  resolveConfigPath,   // (projectDir) → abs path | null
  getEnabledTargets,   // (config) → ['web', 'backend', …]
  findBrandRoot,       // (projectDir) → brand root | null — CLASSIFIES one app dir (THE hierarchy rule)
  resolveBrandRoot,    // (startDir) → brand root | null — SEARCHES upward from anywhere (standalone → itself), bounded at the nearest .git
  loadEnv,             // (startDir) → { chain, loaded } — resolve + load the .env cascade
  resolveEnvChain,     // (startDir) → { app, brand, company } .env paths (no loading)
  loadEnvChain,        // (paths) → loaded[] — dotenv strongest-first, nulls/missing skip
  readCompanyRoot,     // (brandRoot) → company root | null (.omega/company.json)
  COMPANY_MARKER,      // '.omega/company.json'
  resolveHook,         // (startRoot, 'account/password') → hook file | null (brand → company)
  loadHook,            // (startRoot, hookPath) → { fn, file } | null — broken hooks THROW
  validateConfig,      // (config, { target }?) → { errors, warnings }
  runSchema,           // low-level rule walker (EM's proven engine)
  formatErrors,        // errors → numbered block
  findSecretKeys,      // (object) → dot-paths of secret-shaped keys
  findRetiredKeys,     // (object) → [{ path, key, replacement, why }] — renamed-outright keys (#142)
  applyConfigEdits,    // (source, edits) → edited source — comment-preserving (see Writeback)
  writeConfigValues,   // (projectDir, edits, { dryRun }?) → { path, changed, applied }
  deepMerge,           // agnostic layer merge
  // Multi-instance targets (instances.js — the ONE iteration mechanism)
  normalizeTargetInstances, // (targets.<type> value) → [{ id, … }] (object form = [{ id: 'main', …entry }])
  instanceIdFromDirName,    // ('website-admin', 'web') → 'admin'; canonical/unconventional dirs → 'main'
  instanceAppDir,           // ('web', 'admin') → 'website-admin'; main → the canonical dir
  appInstance,              // (projectDir, target) → this app dir's instance id (brand apps only; standalone → 'main')
  resolveInstanceEntry,     // (entry, id) → the instance's merge layer (id stripped) | null
  instancePortOffset,       // (entry, id) → position in the instances array (dev-port offsets)
  resolveInstanceUrl,       // (entry, id, config) → instance url → instance brand.url → brand.url | null
  APP_DIR_TARGETS, TARGET_APP_DIRS, MAIN_INSTANCE, // the app-dir mapping SSOT (manager re-exports)
  TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS,
} = require('@omega.js/config');
```
