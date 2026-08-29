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
| Brand monorepo — local level | `{brand}/targets/{target}/config/omega.json5` |

JSON5: comments, trailing commas, unquoted keys, single quotes all allowed.

## Shape

```json5
{
  // SHARED sections — identical spelling in every project type.
  // (`SHARED_SECTIONS` in @omega.js/config is the authoritative list.)
  brand:          { id, name, url, description, tagline, company, type, font, color, contact: { email, phone, person: {…}, carbonCopy: […] }, address: {…}, images: {…} },   // #524: type = the schema.org type the JSON-LD stamps ('Organization' unset), font = the display face the assets service renders the wordmark from. contact.person = the human who signs "personal" email (name, firstName, image, url, urlText); contact.carbonCopy = audit BCCs; images.companyWordmark = parent wordmark in email footers
  cloud:          { provider: 'firebase', config: { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId }, messaging: { vapidKey }, shared, supportEmail, apiSubdomain, organizationId, billingAccount, oauthRedirectsConfigured },   // ONE cloud home (#23): the app config PLUS the provisioning fields; projectId lives only at cloud.config.projectId. vapidKey: web-push public key (console → Cloud Messaging), public by design
  meta:           { title, description, image, keywords, index, viewport, referrer, twitter_card, og_image_width, og_image_height },   // #607: the site's DEFAULT page meta (@omega.js/web's head). The one section a page may restate BARE in frontmatter (`pageBare: true`); unset title/description fall back to brand.name/brand.description
  repo:           { providers: { github: { enabled, org, repo, shared, private } } },
  edge:           { providers: { cloudflare: { enabled, zone, dns, settings, rules, cacheRules, speedTest, workers } } },
  captcha:        { providers: { recaptcha: { project, siteKey, domainsConfirmed: [] } } },   // domainsConfirmed: machine-written — the classic key's domain list has no API, so the captcha service records the owner's confirmation here and stops asking
  search:         { providers: { searchConsole: { enabled, submitSitemap, sitemapPaths, gaLinked } } },   // #546: each `enabled` is the service's own switch, default ON — false skips that whole service. gaLinked: machine-written — the Search Console ↔ GA association has no API, so the confirmation is the record
  forms:          { providers: { slapform: { enabled, formId, templateFormId, updateFormInfo, plan } } },
  inbound:        { chat:  { providers: { chatsy:   { enabled, agentId, accountId, templateAgentId, updateAgentInfo, plan, sponsorshipsUrl, settings } } },
                    email: { providers: { replyify: { enabled, agentId, templateAgentId, updateAgentInfo, plan, discount } } } },
  analytics:      { providers: { google: { id, propertyId, accountId }, meta: { id, accountId }, tiktok: { id, accountId, appId } } },   // #524: the pixel/measurement id is the RUNTIME value; propertyId/accountId are the platform ids the manager reconciles against (never secrets — tokens stay in .env). tiktok.appId: the DEVELOPER APP the token mint authorizes through (#448/#635) — public config; the app secret is pasted once and never saved
  advertising:    { providers: { adsense: { client, displaySlot, inArticleSlot, inFeedSlot, multiplexSlot }, inhouse: { source } }, fallback, tags: [] },   // C4 cp105; inhouse source: 'self' | 'company' | full URL (ads spec). #527: `client` is the ONE adsense switch — its presence drives the managed account, the ad units and the ads.txt record together (no `units`, no `enabled`). Role-level: `fallback: 'inhouse'` is the lane a provider miss falls through to (false/absent ends at the built-in promo), `tags` are the brand's contextual targeting tags
  payment:        { providers: { stripe: { publishableKey }, paypal: { clientId }, chargebee: { site } }, products: […], winback: { enabled, percent, amount, duration } },   // winback = the cancel-flow save offer (#268), on by default at 50% off the next cycle — see below
  monitoring:     { enabled, providers: { sentry: { org, dsn, environment, sampleRate, tracesSampleRate, replaysSessionSampleRate, replaysOnErrorSampleRate, scrubEmail, attachScreenshot, bundlePatterns: [] } } },   // #425: the monitor is a KEY under `providers`. dsn presence IS the runtime enable signal; environment unset = the host's gate names it; scrubEmail defaults true (email OFF), attachScreenshot is desktop-only, bundlePatterns + the two replay rates browser-only (replay defaults to 0 — opt-in, #485). docs/shared/monitoring.md
  oauth2:         { /* public client IDs only */ },
  theme:          { id, appearance },            // project-owned; seeded at onboarding
  translation:    { enabled, default, languages: [], providers: { claude: {} } | { chatgpt: {} }, model, exclude: [] }, // presence picks the engine; absent = claude. docs/shared/translation.md
  socials:        { twitter: 'somiibo', spotify: { handle, redirect } },   // platform → handle. The handle derives the profile URL every surface reads (JSON-LD sameAs, the footer row, omega_social) and @omega.js/web emits a shortlink redirect page at /<platform> per entry (#429); the object form adds a redirect target that WINS for the shortlink when it is not the profile URL. Blank handle = no entry, no page. Not a disperse-owned SHARED_SECTION — brand-level content, read by the web target

  // MANAGER-read brand-level sections (#277). Schema-known at the TOP level: the
  // manager loads the brand config unfolded, and a website-only brand has no
  // `targets.backend` to hold them (presence there would enable the target). A
  // `targets.backend.<same key>` block still overrides any of them.
  parent:         'self' | 'https://parent.example.com' | false,   // webhook parent topology; false = shared webhook account owned elsewhere
  domain:         { providers: { namecheap: {} }, email: { providers: { cloudflare: {} }, forwarding: [] } },   // TWO roles (#425): the REGISTRAR is the one key under `providers` (namecheap is the one the service drives by API; every other registrar gets manual instructions), the mailbox provider the one key under `email.providers`. Presence picks; no entry = nothing chosen, and the service skips
  certificates:   { enabled, providers: { apple: { bundleIdPrefix, capabilities: [], profiles: [], certificates: [] } } },   // Apple signing for desktop/mobile targets. bundleIdPrefix is the brand's own answer ('com.mycompany' + brand.id composes the bundle id); the credentials live in .env (APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_TEAM_ID)
  github:         { user, website },             // GitHub identity for the brand (content identity; repo.providers.github is the source-hosting home)
  reviews:        { enabled, sites: [] },
  marketing:      { campaigns: { enabled, providers: { sendgrid: { listId } } }, newsletter: { enabled, providers: { beehiiv: { publicationId } }, content: […] }, prune: { enabled } },   // #425: each role names its vendor as a KEY under `providers`; `enabled` and the newsletter `content` PIPELINE blob stay role-level. `prune` is ON by default (Ian 2026-08-22, #478) and per-brand disableable: packages/backend/docs/marketing-campaigns.md § Contact Pruning
  blog:           { /* AI blog-content settings (Ghostii pipeline) */ },
  devlog:         { enabled, providers: { ghostii: { orgs, lookbackDays, … } } },   // commit-digest devlog (#553): `enabled: true` PUBLISHES AI-written posts to the live site, so it is case 3 — the literal true is the only ON, absence is off, and no default is materialized
  dataRequest:    { /* GDPR/CCPA data-request query definitions */ },
  directory:      { enabled },                   // opt in to the manager's directory PUSH — this brand's entry into `parent`'s brands collection (#246); default off, public facts only. docs/manager/directory.md
  sponsorships:   { acceptable: [], unacceptable: [], prices: { 'guest-post': 70, 'link-insertion': 50 } },   // sponsorship terms — the first directory BLOCK; `prices` is an open placement→USD map, not an enum

  // TARGET-scoped config. KEY PRESENCE = "this brand enables this target"
  // (replaces the legacy brand-config targets ARRAY). `extension: {}` means
  // enabled-with-defaults. Unknown keys are validation errors UNLESS they
  // declare `type: 'custom'` (see Custom targets below). A value may
  // also be an ARRAY of id'd instances (see Multi-instance targets below).
  targets: {
    web:       { imagemin, collections, redirects, client: { consent, … }, dev: { limitCollections } },   // redirects: ORDERED [{ from, to, type }] path redirects (#442) — `from` may capture ONE `:name` segment ('/c/:id') that `to` references ('/code?id=:id'); type 301 (default), 302, 307, 308. Static hosting = the hop is CLIENT-side, materialized through the built 404 page (docs/web/index.md). client: the @omega.js/client runtime blob (auth, sentry, exitPopup, …) — a settings bag the client normalizes; only `consent` is schema-known, see "Consent" below. collections: the brand's OWN content collections — name → { field, size, title, description, permalink }; documents live in `_<name>/` and the engine generates the listing + one page per category of `field` (#207). dev.limitCollections: dev-only collection sampling — collection name → max documents ({ posts: 50 }) plus `randomize: true`; development builds only, production always ships the whole site (#190)
    backend:   { projectType, auth: { signup: { maxPerIpPerDay } } },   // projectType: 'firebase' (default — Cloud Functions) | 'custom' (the same backend as its own server on PORT, for a container host — no Functions deploy, no emulator lane; see "Backend project type" below). auth.signup.maxPerIpPerDay: signups allowed per client IP per day, positive integer, default 2. Raise it for audiences behind shared egress (NAT/CGNAT, VPNs, offices)
    desktop:   { app, platforms: { mac, win, linux }, autoUpdate, startup,
                 releases, downloads, remoteConfig, remoteScripts, restartManager },
    extension: { /* near-empty at launch */ },
    mobile:    { /* RESERVED — MAM parked */ },
    api:       { type: 'custom' },   // any OTHER key = a custom target (#603) — the manager drives it entirely through its own package.json scripts; see "Custom targets" below
  },
}
```

## Resolution

`loadConfig(projectDir, target, { defaults })` produces ONE resolved object per target:

```
schema defaults ← framework defaults ← company ← brand shared ← brand targets[target] ← local shared ← local targets[target]
```

- **The bottom layer is the SCHEMA's own defaults** ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)) —
  see [Defaults & self-healing](#defaults--self-healing) below. `options.defaults` sits directly
  above it and carries only what a framework does differently.
- "shared" = the file minus its `targets` key. In a standalone repo only the local layers exist.
- **The company layer** is the company workspace's own `config/omega.json5`, found through the
  brand's `.omega/company.json` stamp (the same marker the `.env` cascade and owner hooks read —
  see below). It layers exactly like the brand file (company shared ← company `targets[target]`)
  minus its `brands` key, which is company plumbing and never inherits. An unstamped brand has no
  company layer; the resolved result reports the file it used as `files.company`.
- **`projectDir` may be one of a target's SUBDIRS** — `functions/` (@omega.js/backend's runtime cwd)
  or `dist/` (its staged build output, the view `omega test` loads): every walk (brand root,
  company marker, local-layer fallback, instance id, compose, `resolveBrandRoot`) treats the target root
  as one level up, so `loadConfig(functionsDir, 'backend')`, `loadConfig(distDir, 'backend')` and
  `loadConfig(targetRoot, 'backend')` resolve identically. A staged `config/omega.json5` inside either
  subdir is the deployed runtime's own view, never an authored local layer.
- **Target sections overlay the TOP LEVEL**: `targets.desktop.platforms` resolves to
  `config.platforms`; frameworks never read through `config.targets.<type>.…`.
- **Any shared key inside a target entry overrides it for that surface** — a desktop-only
  Sentry DSN is just `targets.desktop.monitoring.providers.sentry.dsn`; disabling any integration per-surface is
  uniformly `<key>: { enabled: false }`. One agnostic deep merge everywhere (objects merge,
  arrays/scalars replace, `null` replaces, `undefined` is skipped).
- **@omega.js/web adds one MORE layer, per page** ([#607](https://github.com/Omega-JS-Stack/omega/issues/607)):
  a page's (or layout's) `config:` frontmatter block merges over the resolved config for that page
  alone, and templates read the result as `resolved.config.*`. It is the same deep merge, one
  layer higher — `… ← local targets[target] ← page config:`. Nothing else in the config chain
  knows about it, and a page restating a config section BARE is a build error
  ([docs/web/index.md](../web/index.md)).
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
    { id: 'main' },                                     // the primary — targets/website
    { id: 'admin', url: 'https://admin.acme.com',       // targets/website-admin
      brand: { name: 'Acme Admin' } },                  // overrides brand shared for admin ONLY
  ],
}
```

- **Normalization is the whole mechanism** (`normalizeTargetInstances`): a single object is
  `[{ id: 'main', ...entry }]` internally — every consumer iterates instances and the
  single-instance world is just length 1. Zero breaking change for existing brands.
- **Target-dir mapping**: `main` → `targets/<canonical dir>` (unchanged); any other id →
  `targets/<canonical dir>-<id>`. The inverse walk names the instance from the dir
  (`website-admin` → web/admin), and `loadConfig`/`composeTargetConfig` slot THAT instance's
  entry into the merge chain: `defaults ← brand shared ← instance entry ← local shared ← local
  targets.<type>`. The instance `id` key is bookkeeping — stripped, never config. The result
  carries `instance` (the resolved id).
- **Validator rules**: array entries MUST carry a dir-safe `id`, unique per type; an empty
  array is an error; **>1 backend instance is a WARNING** (`warnings` on the result) — backend
  stays single-instance in practice (one Cloud Functions surface per brand).
- **Scoping rules**: the single-object form applies to EVERY target of the type (today's
  behavior, suffixed dirs included); the array form is exact-id — a target dir with no matching
  id rides shared config alone. The workspace structure op expects every instance's exact dir
  (missing = the same create-this-dir error as today).
- **Per-instance surfaces**: dev ports offset by array position (docs/shared/local-dev.md), deploy
  records key per target (docs/shared/deploys.md), the manager's live-URL checks use each instance's
  `url` (instance entry `url` → instance `brand.url` → brand shared `brand.url`).
- **Legacy `brand.subdomains` conversion rule**: each subdomain becomes a web instance —
  `["admin", "cdn"]` → `web: [{ id: 'main' }, { id: 'admin', url: 'https://admin.<domain>' },
  { id: 'cdn', url: 'https://cdn.<domain>' }]` (no migration tooling yet — this mapping is
  the recorded recipe).
- Non-goals (v1): no cross-instance shared builds, no per-instance Firebase projects.

## Custom targets (#603)

A brand also runs targets no framework owns — a Render API, a worker, a script. They are
declared under **any key that is not a framework name**, and the entry must say what it is:

```json5
targets: {
  web: {},
  api:  { type: 'custom' },                                          // → targets/api
  jobs: [{ id: 'main', type: 'custom' }, { id: 'nightly', type: 'custom' }],  // → targets/jobs, targets/jobs-nightly
}
```

- **The type is the declaration.** An unknown key WITHOUT `type: 'custom'` is still a
  validation error (it is a typo'd framework name), and a framework key WITH it is an error
  too — a framework's verbs come from its framework, never from package scripts.
- **The array form works the same way**, and every instance must carry the type; the
  target-dir mapping is the shared one (`main` → the bare dir, any other id → `<name>-<id>`).
- **Its verbs are its own package.json scripts**: `start`, `build`, `test`, `deploy`, `clean`.
  The manager runs each through `npm run <verb>` when the script is present and skips it
  loudly when it is absent — nothing is inferred or defaulted.
- **No framework service reconciles it.** The only two manage ops that see a custom target are
  env disperse (it has no `@omega.js/config` to walk the cascade with, so the brand `.env` is
  composed into its own) and the workspace service (structure, agent docs, settings). Full
  contract: [docs/manager/index.md](../manager/index.md) § Custom targets.

## Backend project type (#584)

`targets.backend.projectType` says how the backend RUNS, and it is the only switch:

```json5
targets: {
  backend: { projectType: 'custom' },   // default is 'firebase'
}
```

- **`'firebase'` (default)** — the backend exports Cloud Functions, deploys with `firebase deploy`,
  and runs locally on the emulator suite. Everything OMEGA does today.
- **`'custom'`** — the SAME backend (same routes, same schemas, same auth middleware, same
  helpers, same `.env`) served by its Express app on `process.env.PORT`, for a container host
  (Render & co). `Manager.init()` reads the mode off this key, so a brand's `src/index.js` is
  unchanged; an explicit `init` option still wins.
- **What custom mode removes is the Firebase LANE, not Firebase**: no Functions deploy, no
  emulator, no emulator test run — those four verbs refuse loudly and name their replacement
  ([docs/backend/index.md](../backend/index.md)). `firebase-admin` still loads, so a custom
  server that reads Firestore or verifies an ID token works exactly as before.
- **Not to be confused with a custom TARGET** (above): that is a target no framework owns.
  This one IS the `@omega.js/backend` target, with a different artifact. Same-type duplicates
  are still the array (multi-instance) form.
- The brand-root behavior — deploy through the target's own `deploy` script, `omega dev` booting
  the server instead of the emulator: [docs/manager/index.md](../manager/index.md).

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
company .env ← brand .env ← local .env ← shell env
```

- **Same walk as the config cascade**: `{brand}/targets/{target}` layers the brand root's `.env`
  under the target's; a brand stamped with `.omega/company.json` (written idempotently by
  company manage runs) layers its company root's `.env` underneath that. `findBrandRoot`
  in `load.js` is the ONE definition of the walk — both cascades use it.
- **Precedence via dotenv's no-override semantics**: files load strongest-first and never
  overwrite keys already set, so the shell always wins and local beats brand beats company.
- **Empty file values never claim a key (cp95a, friction #20)**: `KEY=` / `KEY=""` in any
  `.env` FILE means "documented here, value supplied by another layer" — a scaffolded local
  file full of placeholders can't shadow the brand root's real values. Only the shell can
  deliberately set a key to empty. The framework `_.env` templates ship `# KEY=` commented
  placeholders (the merge protocol keeps set values on their line, converges empties to
  the placeholder, and disperse uncomments a placeholder in place when composing a value).
- **Defined at the source, resolved at runtime/build**: a brand-wide `GH_TOKEN` lives once
  in the brand `.env`; every framework CLI/build resolves the chain at boot
  (`loadEnv(process.cwd())` in the web/desktop/extension CLIs + gulp pipelines,
  `loadEnv(functionsDir)` in the @omega.js/backend CLI and runtime). Nothing is copied
  between `.env` files just to be visible.
- **Backend's local layer is `functions/.env`** — it physically rides the Firebase deploy
  artifact (the cloud can't walk up), so omega-manager's disperse composes that ONE file
  from the resolved chain. In the cloud the walk finds no brand/company and behavior is
  identical to plain dotenv.
- **The brand-generated keys are the manager's to mint** — `OMEGA_ADMIN_KEY`,
  `OMEGA_WEBHOOK_KEY`, `OMEGA_NAMESPACE` and `UNSUBSCRIBE_HMAC_KEY` have no dashboard
  behind them, so the onboard stub writes them for a fresh brand and the workspace
  service's `env-keys` step mints any the cascade doesn't serve on every manage
  ([#569](https://github.com/Omega-JS-Stack/omega/issues/569)). The env schema below is
  the one list feeding both, a company-served value is never shadowed by a brand-level
  one, and nothing prints a minted value.
- Missing files and unreadable/stale markers skip silently — `loadEnv` never throws for
  an absent layer.

## The env schema (`src/env-schema.js`) — #581

The omega.json5 schema's sibling: ONE inventory of the env keys OMEGA needs — who owns
each, which targets read it, whether OMEGA mints it or a human pastes it from a third
party, whether it is required, and what it does. Everything that used to hand-keep its
own list derives from it, so a new key is **one entry**, never four edits.

```js
{
  name:        'OMEGA_ADMIN_KEY',      // the env var (SCREAMING_SNAKE)
  match:       /^OAUTH2_.+$/,          // …or a pattern, for dynamic families
  owner:       'workspace',            // the manager service that owns it
                                       // ('backend' = the framework itself)
  targets:     ['backend'],            // the targets whose runtime READS it
  group:       'omega',                // its ENV_GROUPS bucket (.env file order)
  generated:   () => randomBytes(32)…, // the function that MINTS a value
  default:     'value',                // …or a static default, where one applies
  secret:      true,                   // never printed, never in omega.json5
  required:    true,                   // absent = the backend refuses to boot
  devOf:       'STRIPE_SECRET_KEY',    // …or: this key OVERRIDES that one outside production
  liveShape:   /^(sk|rk)_live_/,       // the pattern a LIVE credential matches
  description: 'What the key drives.',
}
```

- **`generated:` is the mint switch.** Those keys have no dashboard behind them, so the
  manager writes them into a brand `.env` — at onboard, and on every manage that finds
  one missing. Everything else is a credential a human provides.
- **Only a key OMEGA can produce may be `required`.** Refusing every boot over a secret
  nobody can mint would be a hostage note, not a guard — the config test pins it.
- **`targets:` is the composition domain.** Disperse composes `targets/backend/.env`
  (the only target .env that ships with a deploy artifact and so cannot walk up to the
  brand layer) from the entries naming `backend`. Other targets read brand values
  through the cascade above, so their `targets` entries are documentation.
- **Disperse CLEARS what it composes** ([#636](https://github.com/Omega-JS-Stack/omega/issues/636)):
  a composed key the brand root no longer sets is REMOVED from `targets/backend/.env` on
  the next run — every occurrence, and only lines carrying a VALUE (a `# KEY=` placeholder
  or an empty `KEY=""` is the key's documented home and stays). A credential the brand
  retired stops being served by the target it was composed into. Idempotent; a dry run
  reports the clear by key name, never by value.
- **`group:` picks the .env section**, and `ENV_GROUPS` owns the file order plus each
  section's comment. A group marked `file: false` (the `runtime` group) never reaches a
  brand `.env` at all — those keys resolve some other way (from config at boot, from
  disperse's per-target stream lane, from the developer's own shell), so they are
  neither rendered as placeholders nor composed.
- **Runtime/platform vars are NOT in the schema**: `FIREBASE_CONFIG`,
  `FUNCTIONS_EMULATOR`, `GCLOUD_PROJECT`, the `OMEGA_*_PORT` map, the test-mode
  switches. They are the runtime's facts about itself, not a brand's credentials, and
  the frameworks read them directly.

### Dev-suffixed payment secrets — #586

Public payment keys already split per machine (the merge chain's local layer overrides
`payment.providers.stripe.publishableKey`, so a dev machine carries `pk_test` while the
brand config carries `pk_live`). **Secrets did not**: one `.env`, one
`STRIPE_SECRET_KEY`, read by both the local emulator and the deploy — so a brand's
emulator ran with the live secret and a local test purchase could charge a real card.

The split is a `<KEY>_DEV` twin, declared as a normal schema entry carrying `devOf`:

| Key | Twin |
|---|---|
| `STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY_DEV` |
| `PAYPAL_CLIENT_SECRET` | `PAYPAL_CLIENT_SECRET_DEV` |
| `CHARGEBEE_API_KEY` | `CHARGEBEE_API_KEY_DEV` |

Every twin is optional, secret, owned by `payment`, and in the `payment` group — so it
renders as a `# KEY=` placeholder in a brand `.env` and composes into
`targets/backend/.env` like any other backend key, with no hand list anywhere.

- **Outside production the twin wins**: `env.get('STRIPE_SECRET_KEY')` returns
  `STRIPE_SECRET_KEY_DEV` whenever it is set. Every provider library gets this without
  knowing the twin exists.
- **In production the twin does not exist**: `env.get()` reads a `_DEV` key as absent
  whatever the cascade holds, and `omega deploy` strips those rows from the uploaded
  `.env` (`stageFunctions({ deploy: true })`, keyed off `devEnvKeys()`). Two latches, so
  a stale row can never redirect a real customer's payment.
- **`liveShape:` refuses a live credential outside production** with a named error
  (`LiveSecretOutsideProductionError`) that names the key and the fix and never the
  value. It is declared only where the provider stamps a shape — Stripe's
  `sk_live_`/`rk_live_`, Chargebee's `live_`. **PayPal's halves carry no live/sandbox
  marker**, so PayPal is protected by its twin alone.

### One key per AI provider — #639

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. There is no second name for either.

| Key | Owner | Read by | Asked at |
|---|---|---|---|
| `OPENAI_API_KEY` | `backend` | Contact inference, content + newsletter generation, the `chatgpt` translation provider | `manage` — the `ai` service's setup gate |
| `ANTHROPIC_API_KEY` | `backend` | The backend's Anthropic provider (SVG generation, tool loops) | `manage` — the `ai` service's setup gate |

- **The company-wide fallback is the COMPANY LAYER, never a second key** (Ian
  2026-08-27). The legacy pair (`BACKEND_MANAGER_OPENAI_API_KEY`, then
  `OMEGA_OPENAI_API_KEY`) existed so one company key could serve every brand; the
  `.env` cascade already does that — put the value in the company `.env` and every
  brand under it resolves it, with a brand `.env` overriding. The prefixed names are
  gone from the schema, the `_.env` templates and every reader; migration row in
  [breaking-changes.md](breaking-changes.md).
- **Both are optional and neither gates a run.** The `ai` service declares them
  `gates: false`, so preflight never blocks on them and a brand that calls one
  provider is never nagged about the other. `ai.enabled: false` (what the gate's
  Disable lands) stops the ask for good.

Who derives from it:

| Lane | What it takes |
|---|---|
| `@omega.js/manager` workspace `env-keys` + the onboard `.env` stub | `generatedEnvKeys()` — name → the function that mints a value |
| `@omega.js/manager` `lib/env-order.js` (canonical .env order) | `envFileGroups()` + `envKeysByGroup()` — the sections, their comments, their keys |
| `@omega.js/manager` disperse `write/env.js` | `envKeysForTarget('backend')` — the composition |
| `@omega.js/backend` `libraries/env.js` (the one reader) | `envSchemaEntry()` for every read, `requiredEnvKeys('backend')` for the boot guard, `devEnvKeyMap()` for the dev/live split ([docs/backend/index.md](../backend/index.md)) |
| `@omega.js/backend` `cli/utils/stage-functions.js` (the deploy stage) | `devEnvKeys()` — the rows the upload must never carry |

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
  The free-check is a QUADRUPLE bind-probe (127.0.0.1, ::1 when the host has IPv6,
  the IPv4 wildcard 0.0.0.0, and the `::` wildcard) — on macOS/BSD, wildcard and
  specific-address listeners COEXIST on one port, and the two wildcard FAMILIES
  coexist with each other, so any single-surface probe false-positives against a
  sibling brand's stack and the real bind crashes later (found live at cp186: the
  playground's https proxy holds IPv6 `*:5002`; a 127.0.0.1-only probe handed 5002
  to the second brand's functions emulator — and again at #345: a foreign `0.0.0.0`
  squatter read free to the `::` probe and the auth emulator died with no bump).
- **Ports file** — `writePortsFile(projectDir, ports, facts)` /
  `readPortsFile/clearPortsFile(projectDir)`: `<projectDir>/.temp/ports.json`
  (pid-stamped; readers ignore dead-pid leftovers). The allocator (the backend emulator
  boot) writes it; siblings of the same brand (`omega test` against a running emulator,
  the e2e harness) read it; cleared on clean shutdown. `facts` publishes the resolved
  NON-port facts beside the map — today `origin`, the website's dev origin
  ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)).
- **Sibling map** — `readSiblingPorts(targetDir)` merges every OTHER target's live ports file
  in the same brand (a running backend's emulator map) for the target that asks;
  `readSiblingOrigin(targetDir)` reads the published dev website origin the same way. Read
  at USE time, never cached: the file appears when the backend boots and changes when it
  restarts.
- **Env channel** — `portsToEnv(ports)` → `OMEGA_<NAME>_PORT` vars injected into spawned
  children; `envPort(name)` reads one, `envPorts(env)` reads the whole map back out.
  URL getters resolve env → classic default.
- **Browser channel (cp89, [#300](https://github.com/Omega-JS-Stack/omega/issues/300))** —
  browser code can read neither env nor files, so a surface BAKES the map into its
  client config: `omega dev` writes `dev: { ports }` into the Configuration chrome
  PER RENDER (its resolved website port with the sibling backend's map merged over it),
  and its auth-emulator proxy resolves the target port per REQUEST. The render-time
  bake is ADVISORY ([#346](https://github.com/Omega-JS-Stack/omega/issues/346)): the
  dev server REWRITES that chrome in every HTML response as it serves it, resolving the
  sibling maps per request, because the normal boot order builds the whole page fleet in
  under a second while the emulator suite seeds for minutes — nothing under `src/`
  changes when it lands, so no page would ever re-render onto it. Mid-session emulator
  restarts onto bumped numbers ride the same lane. Built `dist/` output is untouched on
  disk. Desktop (`OMEGA_BUILD_JSON.config.dev`) and
  extension (`build.js` + the page config blob) bake the same map at build time, from
  the sibling file plus the env channel; production builds bake none. Drivers serving a
  STATIC build set `window.__OMEGA_DEV_PORTS__` (the devkit e2e harness — the site
  builds before the emulator boots), which is a FALLBACK: it fills only what a page's
  chrome omits, so a side channel no real browser has can never hide a broken real one.
  The dev WEBSITE ORIGIN rides the same map as one more resolved fact
  ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)): `omega dev` publishes
  `dev.origin` (protocol AND port — the mkcert proxy fronts the public port by default,
  so a port number alone cannot say the scheme) into the chrome and into its ports file,
  and desktop/extension bake it from that file on their existing lanes. The extension
  manifest's `externally_connectable` dev entry resolves from it at package time —
  nothing hardcodes a dev origin any more. `@omega.js/client`'s `getDevWebsiteOrigin()`
  is the one getter that answers it, falling back to the classic `https://localhost:4000`
  with the same out-loud warning the ports take.
  `@omega.js/client` resolves chrome `dev.ports` → runtime global → classic defaults,
  and warns loudly (dev only) naming every port it had to assume; its dev `getApiUrl`
  speaks plain http to a mapped `hosting` (the emulator serves http), https to a mapped
  `https` (`mgr serve`'s mkcert proxy), and keeps the classic
  `https://localhost:5002` serve assumption when no map was provided. Dev mode
  resolves the LOCAL stack for every source, including `source: 'company'` —
  `company.url` is a production concept, and dev deliberately makes no live server
  hits (ratified, Ian 2026-08-03, [#34](https://github.com/Omega-JS-Stack/omega/issues/34)).
- **Website port (cp89)** — `omega dev` allocates through the same model: classic
  **4000** (pre-N7 it defaulted to 8080, colliding with the SAME brand's firestore
  emulator), bump when taken, `--port` flag or config `ports.website` pins; publishes
  its own ports file in the website target dir.
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
  instead of pinning 9876. `getWebsiteUrl` (backend + desktop, both Node-side) still
  returns `http://localhost:4000` — plain http on the public port 307s to https, so the
  link lands either way; the BROWSER-side answer is `getDevWebsiteOrigin()`, which needs
  the exact origin and takes it from the resolved map (#262). Packaged
  extension/desktop artifacts keep BUILD-TIME-BAKED ports by design (a shipped
  extension can't probe); the extension manifest's dev-website origin documents that
  inline.
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

**Undeclared keys WARN** ([#636](https://github.com/Omega-JS-Stack/omega/issues/636)):
every leaf path of the resolved config no rule declares comes back as ONE warning naming
them — never an error, because a brand config that outlives a framework version must still
build. A rule of type `object`/`array` declares its whole subtree (a brand's postal
address, an open provider map), and the `targets` namespace is exempt: those keys belong to
a framework, or to a custom target. A finding is a hole to fill — either the key is dead,
or the schema owes it a rule.

**authDomain is the brand's own host** (cp268): when `cloud.config.authDomain` is set it
must equal the resolved brand host: the instance's own `url` when it has one, else
`brand.url`. A `*.firebaseapp.com` value hard-fails (self-hosted `/__/auth/*` on the brand
host is what keeps redirect sign-in working under browser storage partitioning; the web
build emits those helper files), and any other mismatch fails naming both values. Absent
passes, and `demo-*` (emulator-only) projects are exempt.

## The cancel-flow save offer (`payment.winback`) — #268

When a customer starts cancelling a PAID subscription, the billing card pitches a
discount on the next cycle before it asks them why they are leaving. Accepting applies
the discount through the provider's own coupon plumbing, calls the cancel off, and
leaves the saving on the card (what comes off, and which bills it comes off — #325);
declining opens the cancellation questionnaire unchanged.

The pitch is made per cancel ATTEMPT, never once per session (#324): a customer who
declines, closes the questionnaire and comes back to cancel meets the offer again,
because nothing about their subscription changed. Only a CLAIM (the discount is applied,
and the backend refuses a second one) or a refusal no retry fixes ends it.

An accepted offer is recorded in TWO places, on purpose (#325). `payments-orders/{orderId}`
`.requests.winback` is the offer's MEMORY — what a second accept is refused against — and
the account carries the discount ITSELF at `subscription.discount`, shaped like every other
discount in the payment stack (`{ valid, code, percent | amount, duration }`) plus a
`source`. That is what the billing card renders on a later visit; without it the saving
disappeared on the next page load. `source` is the whole reason it is safe to read as a
claim: today only the winback claim writes this node, and `source` is what keeps the
read safe when checkout discounts start writing it too, because only
`source: 'winback'` says this customer already took the save offer.

**The claim ends with the subscription it was made on (#333).** The account's node also
carries `resourceId`, the subscription the discount was applied to, stamped at claim
time. The unified webhook write carries no discount key, so a merge would otherwise keep
the node forever: a customer who churned and resubscribed carried a spent claim into the
NEW subscription, where `source: 'winback'` reads as "already claimed" and the save offer
is silently never pitched again. Every subscription-resource webhook compares the stamp against
the subscription the event is about and CLEARS the node on a mismatch (a new subscription
is a clean slate), while same-subscription traffic (renewals, cancellations, plan
changes) leaves the saving exactly as claimed. A node with no stamp predates it and
nothing can prove it belongs to an older subscription, so it is read as riding the one it
is found on and stamped there: no live discount is taken away on a guess, and it clears
on the next resubscribe like any other. CONSUMPTION is not cleared: a spent `once` coupon
still reads as applied until the subscription changes, because no provider's unified
shape reports whether the coupon is still attached (#333).

The offer is the brand's, and **a brand that writes nothing gets one anyway**: 50% off
the next cycle, that cycle only.

| Key | Type | Default | What it does |
|-----|------|---------|--------------|
| `payment.winback.enabled` | boolean | `true` | The whole off switch. `false` skips the pitch, and the cancel meets the data-retention warning instead (#341) |
| `payment.winback.percent` | integer 1-100 | `50` | Whole percentage off. Mutually exclusive with `amount` |
| `payment.winback.amount` | number > 0 | — | Flat amount off in `payment.currency`'s major unit (`10` = $10). Mutually exclusive with `percent` |
| `payment.winback.duration` | `'once'` \| `'forever'` | `'once'` | `once` discounts the next cycle only; `forever` is a permanent price cut |

Setting **both** `percent` and `amount` is a validation error: a coupon is one shape or
the other everywhere in the payment stack, and two shapes on one offer has no honest
reading.

`resolveWinbackOffer(payment)` is the ONE home of these defaults. The backend's
`POST /payments/winback` route resolves the brand's section through it, and the web
build bakes the same call into the client blob (`site.client.payment.winback`), so the
dialog the customer reads and the coupon the provider creates can never name different
numbers — the browser never applies a default of its own.

Not every provider can discount a subscription that is already running. Stripe can
(the coupon plumbing the checkout already uses); PayPal has no discount object at all
and Chargebee has no way to reach a live subscription with one through existing
plumbing. Those two refuse with `not-supported-by-provider`, and the billing card
retires the offer for the session and opens the questionnaire — a subscriber can always
still cancel.

## Consent (`client.consent`) — #383

The consent banner is a real GATE, so its config is schema-known even though the rest of
the `client` blob is not: a typo that silently disabled it would ship a site with no
consent surface and no error.

```json5
targets: {
  web: {
    client: {
      consent: {
        enabled: true,                    // default true; false ships NO banner
        config: {
          position: 'bottom-left',        // bottom-left | bottom-right | bottom
          content: {
            message: 'We use cookies … See our { terms }.',       // the banner face
            panelIntro: 'We and our partners … See our { cookies } and { terms }.',
            accept: 'Accept',                                     // the big grant
            customize: 'Customize',                               // opens the panel
            acceptAll: 'Accept all',                              // the panel's pair
            acceptNone: 'Accept none',
          },
          // `{terms}` and `{cookies}` link the terms and cookie-policy pages.
          // `save` retired with the Save button (#391) — a config still setting
          // it is ignored, not an error.
        },
      },
    },
  },
}
```

Two things are deliberately NOT config:

- **The regime.** The visitor's browser timezone picks it — the strict opt-in roster (plus an
  unplaceable timezone) gets opt-in, where no provider script loads until they accept; everywhere
  else gets opt-out, where the scripts load and a first visit sees only the Cookies Settings
  tab ([#391](https://github.com/Omega-JS-Stack/omega/issues/391)). There is no key that
  forces one, because the answer is legal, not stylistic.
- **The colors.** The panel paints itself from the `--omega-*` token sheet, which is the
  only way it is correct in both color modes. The old `palette`/`theme` keys are gone.

`enabled: false` is legal only for a site that loads no analytics or marketing provider
at all — the gate and the banner are the same switch.

## Feature gating polarity (#527)

Ratified 2026-08-24 (Ian). A feature has ONE switch with ONE polarity, and which
polarity it is follows from what the feature needs — never from taste at the read
site. Three cases:

| Case | The switch | The read | Examples |
|------|-----------|----------|----------|
| **1. Data-bearing** — the feature cannot run without a value only the brand can supply | that DATA's presence | `if (value)` | `advertising.providers.adsense.client`, `monitoring.providers.sentry.dsn`, `analytics.providers.*.id`, `edge.providers.cloudflare.zone`, `advertising.providers.inhouse.source` |
| **2. Zero-data** — the framework can run it for every brand with no input | `enabled`, default ON | `value !== false` | `forms.providers.slapform.enabled`, `inbound.chat.providers.chatsy.enabled`, `repo.providers.github.enabled`, `search.providers.searchConsole.enabled`, `edge.providers.cloudflare.enabled` |
| **3. Consequential** — it costs money, publishes to the world, or is irreversible | `enabled`, default OFF | `value === true` | `directory.enabled`, `devlog.enabled`, `targets.desktop.platforms.mac.mas.enabled` |

- **A block by itself NEVER enables.** Authoring `providers: { adsense: {} }` is an opt-IN
  to being asked, not an ON — the case-1 data or the case-2/3 `enabled` still decides.
- **Never a second switch on one feature.** Two switches let a config say ON to one half
  of the stack and OFF to the other: adsense carried exactly that (the manager gated on
  `enabled`, the site on `client` + `units`), so `{ client, enabled: false }` stopped the
  account being managed while the site kept serving ads off it. #527 collapsed adsense to
  case 1 and deleted both extra gates. A state that needs a second switch to express
  (managed account, ad-free site) is deliberately inexpressible.
- **Every code-read switch has a schema rule** ([#546](https://github.com/Omega-JS-Stack/omega/issues/546)):
  an undeclared key validates clean, so a typo (`enbaled: false`) silently reads as ON and
  the validator cannot document what the key does. The rule carries the `default:` that
  states the polarity — except where the SECTION is presence-gated (`advertising`), because
  a materialized default would write the section into every brand and switch the feature on
  for brands that configured none; there the ON answer lives at the read site.

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

## The site global: the curated targets view (#85, #610)

`toSiteGlobal()` (the web build's `site.*`) strips the raw `targets` machinery and
replaces it with a CURATED `site.targets` — an allow-list of display-safe facts per
declared target, never a spread of the raw config: every entry carries `enabled: true`,
desktop adds a derived `releasesUrl` once releases are opted in, extension adds its
store `listings`.

It is the ONE home of those facts
([#610](https://github.com/Omega-JS-Stack/omega/issues/610)). The legacy UJM-shaped
`targets.web.download` / `targets.web.extension` page maps — and the `site.download` /
`site.extension` data they filled — are GONE: a brand still carrying either key fails
validation naming the block it derives from, and `omega migrate` drops it with a note.

- **The desktop derivation is OPT-IN (#124)**: `releasesUrl` appears only when
  `targets.desktop.releases` is present (its
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
  instance's facts belong on the site is ambiguous, so instance-form brands get an
  `enabled: true` entry and nothing else. Those pages stay on their empty state.

Three consumers read the curated view and nothing else: the `/download` page (every
desktop card → `site.targets.desktop.releasesUrl`), the `/extension` page
(`site.targets.extension.listings[browser].url`), and the shortlink generator
(`src/target-shortlinks.js`, #561), which publishes `/download/<platform>[/<artifact>]`
and `/extension/<store>` off the same facts. Mobile derives nothing while MAM is
parked, so the mobile band stays on its notify form.

## Consumer access

Each framework exposes the vendored loader — desktop: `require('@omega.js/desktop/config')`,
extension: `require('@omega.js/extension/config')` → `{ loadConfig, validateConfig, … }`.
Consumer workflows use this instead of raw JSON5 reads so brand-monorepo resolution
always applies.

**Derived values reach brands as VALUES, never as a recipe to re-run**
([#290](https://github.com/Omega-JS-Stack/omega/issues/290)). A brand target cannot require
this private package at runtime, so a framework that owns a derivation publishes its
ANSWER on the runtime config object the target already holds, under `resolved.*`: the
backend's `Manager.config.resolved.github` carries `{ owner, name, repo }` — the brand
repo derivation (`repo.providers.github` overlaid by `targets.backend.github`, slug or
bare name) as one finished value, `repo` being the `owner/name` slug. The derivations
themselves stay here (`brandRepo()` in `src/repo.js`): one implementation, called by the
framework, so no brand re-implements the merge rules and drifts from them. New derived
values join a framework's `resolved` group as real brand needs surface.

## Defaults & self-healing

Ian's ruling (2026-08-22, [#478](https://github.com/Omega-JS-Stack/omega/issues/478)): the config
stays complete and current. A subsystem that exists has its config structure IN the file —
visible and editable — instead of an invisible framework fallback, and every default has ONE
home.

**The schema is that home.** A `schema.js` entry carries its own `default:` beside its type and
description; `schemaDefaults(target)` builds them into the merge chain's lowest layer, so nothing
else re-states a default. A key with no sane framework answer carries none: owner decisions,
tri-states that mean "ask" (`cloud.billingAccount`), ids the services provision
(`forms.providers.slapform.formId`), anything secret-shaped. The other standing exclusion is the
**presence gate** ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)), which in practice
means monitoring: that service reads `monitoring.providers.sentry` presence as the pick of
Sentry, so its SDK knobs (`sampleRate`, `scrubEmail`, …) carry no default and keep their home in
the package that reads them — and `advertising`, whose adsense `client` id is the whole switch
([#527](https://github.com/Omega-JS-Stack/omega/issues/527)), so a materialized block would turn
the web build's automatic ad placements on for a brand that configured none. Blocks whose services
gate on `enabled` or provisioned ids rather than presence (github, cloudflare, searchConsole,
slapform, chatsy, replyify) DO carry defaults — see the polarity doctrine above.
Role-level switches beside any providers block
(`monitoring.enabled`, `marketing.campaigns.enabled`) are nobody's pick and always may.

**`omega manage` materializes what a brand lacks.** The workspace service's `defaults` operation
(right after the `config` health check) diffs the brand's own `config/omega.json5` against the
schema defaults and writes the missing blocks through the comment-preserving editor, each key
documented with the schema's own description. The rules:

- **Never an overwrite.** Only keys the brand has NOT authored are written — a `false` a brand
  set (or a section it deliberately switched off) is a decision, and the heal never dives into it.
- **Highest missing path, once.** A brand with no `marketing` at all gets one `marketing` block,
  not one edit per key inside it.
- **Idempotent.** A converged config leaves the file byte-identical; a dry run reports the blocks
  and writes nothing.
- **New subsystems arrive on the next run.** Adding a `default:` to the schema is all it takes for
  every consumer's config to grow the block the next time manage runs.

`marketing.prune.enabled` is the first ruling this carries: pruning is ON by default and lands in
every brand config as an editable switch (Ian 2026-08-22, closing the
[#422](https://github.com/Omega-JS-Stack/omega/issues/422) follow-up).

## Writeback (comment-preserving edits)

omega.json5 is hand-edited — comments, key order, and quote style carry meaning — so
programmatic writes are surgical text edits, not a re-stringify (omega-manager's
serializer rewrote the whole file in canonical order and lost comments; this replaces
it). The manager's services use it to land resolved IDs in config: the SendGrid list,
the Beehiiv publication, Stripe/PayPal product IDs, the Firebase SDK config.

`applyConfigEdits(source, edits, { comments }?)` applies `{ 'dot.path': value }` edits to JSON5 text:
existing leaves get their value span replaced; missing branches insert as one property
before the containing object's closing brace (matching indent; house style: unquoted
keys, JSON.stringify strings, trailing commas). Every byte outside the edited spans
survives. Paths take dots, numeric array indexes, and `[key=value]` matchers that select
an array element by its own key — `payment.products[id=plus].stripe.productId` — so
writes self-locate in the file being edited instead of trusting an index computed from a
merged config. Array elements are never created.

`comments` (dot-path → text) documents INSERTED keys only — the comment lands above the key its
path names, wherever inside the inserted block that is, wrapped at that key's indent. A path that
already exists keeps whatever the brand wrote above it. That is how the manage-run heal
([Defaults & self-healing](#defaults--self-healing)) lands each materialized block with the
schema's own guidance beside it.

Guarantees: edits whose value already matches are skipped entirely (reruns are
byte-identical); after every edit the result must JSON5-parse and hold the requested
value at the requested path, or the call throws and nothing is returned — a corrupted
config can't land on disk.

`writeConfigValues(projectDir, edits, { dryRun }?)` is the file-level form: resolves the
standard locations, skips the write when nothing changes, and returns
`{ path, changed, applied }` (`applied` = the paths that actually differed). The manager
wraps it in `lib/config-write.js` (`writeBrandConfig(context, edits)`) for the uniform
dry-run gate + logging.

**Deleting** is the same surgery in reverse ([#612](https://github.com/Omega-JS-Stack/omega/issues/612)):
`applyConfigRemovals(source, paths)` cuts the property a dot-path names — its key, its whole
subtree, the comma that separated it, and the `//` comment block documenting it, because that
comment describes the key being deleted and would otherwise dangle over the next one. A property
sharing its line (`{ a: 1, b: 2 }`) takes only itself and its separator. Absent paths are skipped,
so reruns are byte-identical, and each removal is verified (parses, path gone) or the call throws.
Array ELEMENTS are never removed, the mirror of never creating them. `removeConfigValues(projectDir,
paths, { dryRun }?)` is the file-level form → `{ path, changed, removed }`. Unlike a write it does
NOT normalize top-level key order: a deletion is surgical, and re-sorting the file around it would
bury the one line the caller means to report. The consumer is `omega migrate` at a brand root
([manager/index.md](../manager/index.md)).

## Migration — legacy configs → omega.json5

No framework reads the legacy files anymore. Convert once, delete the old file. General
recipe: shared-looking sections move to the TOP LEVEL (brand, analytics, payment, theme,
oauth2 verbatim; `firebaseConfig` becomes `cloud: { provider: 'firebase', config: {…} }` and
`sentry` becomes `monitoring: { providers: { sentry: {…} } }`); everything framework-specific
moves under `targets.<type>`.

**Retired keys fail loudly** ([#142](https://github.com/Omega-JS-Stack/omega/issues/142)):
a name that was renamed OUTRIGHT is a validation error wherever it sits — shared level,
inside a `targets.<type>` entry, inside an instance array — naming its replacement and
pointing back here. Today that is `web_manager` → `client`, `firebaseConfig` → `cloud`, and
`cookieConsent` → `client.consent` (`src/retired-keys.js` is the list). Without the guard the old key validated clean and
everything under it vanished, since nothing dual-reads it. Names that live on as legitimate
keys elsewhere stay out of the list — the rows below are their only guide. `sentry` is the one
that reads like a contradiction and is not: its NEW home is itself a `sentry` key
(`monitoring.providers.sentry`), so a name test would fire on the very shape it is steering
people toward. Same for `google`/`meta` under `analytics.providers`.

**`omega migrate` at the brand root deletes them** ([#612](https://github.com/Omega-JS-Stack/omega/issues/612)): both halves of the
list, from the file as AUTHORED, through the comment-preserving editor (`removeConfigValues`) —
the key, its subtree, and the comment documenting it, with every other byte untouched. One line
per key naming its replacement, `--dry-run` for the plan, idempotent (a converged brand's rerun
is byte-identical). It removes the dead key; moving the setting into the home named in the tables
below is still by hand.

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
| `github` | **`repo.providers.github`** — the ONE row with no guard: the brand's own `github` (content identity, unchanged; a shared key since [#277](https://github.com/Omega-JS-Stack/omega/issues/277)) lives at the top level, so a name test would false-positive. This table is its only guide |

The one-provider-shape normalization ([#425](https://github.com/Omega-JS-Stack/omega/issues/425))
adds its own rows to the same `RETIRED_PATHS` half — every role names its vendors
`role.providers.<provider>` now, so the flat picks, the bare vendor key and payment's
fourth word are all retired. Key PRESENCE is the pick; `false` is the deliberate off
switch; no entry at all is "none chosen" (what a null provider meant). `cloud` stays the
ratified exception. Full rationale + the by-hand step per row:
[breaking-changes.md](breaking-changes.md#one-provider-shape--roleprovidersprovider-425).

| Retired path | New home |
|---|---|
| `payment.providers` | **`payment.providers`** — contents identical. The SINGULAR `provider` (Firestore document fields, the intent schema, the payments route params, the email merge field, `libraries/payment/providers/`) is a live data contract and is unchanged |
| `certificates.apple` | **`certificates.providers.apple`** — no bare vendor keys; Windows signing sits beside it later |
| `domain.provider` | **`domain.providers.<registrar>`** — `{ namecheap: {} }` / `{ squarespace: {} }` |
| `domain.email.provider` | **`domain.email.providers.<provider>`** — `domain.email.forwarding` stays role-level (provider-agnostic) |
| `translation.provider` | **`translation.providers.<name>`** — `{ claude: {} }` / `{ chatgpt: {} }`; an absent block still means claude. `translation.model` stays role-level |
| `devlog.provider` + `devlog.{lookbackDays,orgs,excludeRepos,excludeCommits,excludeTopics,includePrivate,postPath,destinations,overrides}` | **`devlog.providers.ghostii.<same key>`** — the writer is the KEY, its settings live inside it. `devlog.enabled` stays role-level |
| `monitoring.provider` + `monitoring.{org,dsn,environment,sampleRate,tracesSampleRate,scrubEmail,attachScreenshot,bundlePatterns}` | **`monitoring.providers.sentry.<same key>`** — the monitor is the KEY, every SDK-facing knob lives inside it. `monitoring.enabled` stays role-level, and per-surface DSNs are `targets.<type>.monitoring.providers.sentry.dsn` |
| `marketing.campaigns.provider` + `marketing.campaigns.listId` | **`marketing.campaigns.providers.sendgrid.listId`** — `marketing.campaigns.enabled` stays role-level |
| `marketing.newsletter.provider` + `marketing.newsletter.publicationId` | **`marketing.newsletter.providers.beehiiv.publicationId`** — `marketing.newsletter.enabled` AND `marketing.newsletter.content` stay role-level: content configures @omega.js/backend's newsletter generator, not Beehiiv |

The
`omega migrate` converter is unaffected: it READS legacy files as input and emits the new
names, and only its output is validated.

### electron-manager (`config/electron-manager.json` → `config/omega.json5`) — DONE (checkpoint 18)

| Legacy | New |
|---|---|
| `brand`, `analytics`, `payment`, `theme` | top level, unchanged |
| `firebaseConfig` | **`cloud: { provider: 'firebase', config: {…} }`** (D12) |
| `sentry` | **`monitoring: { providers: { sentry: { dsn } } }`** ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)) |
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
| `sentry` | **`monitoring: { providers: { sentry: { dsn } } }`** ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)) |
| custom keys (`omega`, `mcp`, …) | top level, unchanged |
| `parent`, `github`, `reviews`, `marketing`, `blog`, `dataRequest` | top level, unchanged ([#277](https://github.com/Omega-JS-Stack/omega/issues/277)): shared keys the manager reads brand-level, so a website-only brand has a home for them; `targets.backend.<same key>` still overrides |

Notes: @omega.js/backend's framework-defaults layer is `templates/config/omega.json5` resolved through
the same loader and passed as `options.defaults`; `Manager.init()`'s
`backendManagerConfigPath` option is gone (the loader discovers the file); boot warns on
schema findings, `npx omega setup` is the hard audit. The sandbox brand dogfoods the full
hierarchy: shared sections live in `brands/sandbox-brand/config/omega.json5` (brand level),
the backend target's local file carries only `targets.backend`.

### browser-extension-manager (`config/browser-extension-manager.json` → `config/omega.json5`) — DONE (checkpoint 20)

| Legacy | New |
|---|---|
| `brand`, `analytics`, `theme` | top level, unchanged |
| `firebaseConfig` | **`cloud: { provider: 'firebase', config: {…} }`** (D12) |
| `sentry` | **`monitoring: { providers: { sentry: { dsn } } }`** ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)) |
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
| `web_manager` (rest: auth, exitPopup, …) | **`targets.web.client`** — the client-runtime settings blob, whole, under its new name (#1: `web_manager` → `client`, since it configures `@omega.js/client`; WebManager is not an OMEGA concept). No dual-read: the old key name is not honored anywhere |
| `web_manager.sentry` (`{ enabled, config: {…} }`) | **`monitoring: { enabled, providers: { sentry: {…} } }`** (top level) — the SDK knobs inside `config` ARE the provider block ([#485](https://github.com/Omega-JS-Stack/omega/issues/485)). Leaving them in the client blob meant the converted brand had no `monitoring` key at all, so the manager's monitoring service skipped every run and no Sentry project was ever reconciled |
| `web_manager.cookieConsent` (incl. `palette`, `theme`, `type`, `content.dismiss`) | **`targets.web.client.consent`** — the block that became a real gate (#383). `palette`/`theme` are gone (the panel paints from the `--omega-*` tokens); `type` is gone (the visitor's region picks opt-in vs opt-out); `content.dismiss` is now `content.accept`, beside `content.customize`, `content.panelIntro`, `content.acceptAll` and `content.acceptNone` (#391 retired `content.save` with the Save button) |
| `web_manager.chatsy` (agentId + widget settings) | **`inbound.chat.providers.chatsy`** — the chat widget left the client blob for the one chat home the manager also provisions (#23) |
| `socials` | **`socials`** (top level) — a SHARED_SCHEMA key, so the root is its home and the scaffold emits it there ([#483](https://github.com/Omega-JS-Stack/omega/issues/483)). A web load resolves `targets.web.socials` identically, which is why the converter used to leave it in the target; the handles are brand identity, read past the website too |
| `translation` | **`translation`** (top level) — a SHARED_SECTIONS key, so the root is its home and the scaffold emits it there ([#526](https://github.com/Omega-JS-Stack/omega/issues/526)). A web load resolves `targets.web.translation` identically, which is why the converter used to leave it in the target; but disperse copies the SHARED sections, so a target-scoped engine config is invisible to every other target that translates (the extension's `_locales`). `translation.exclude` stays a web-only key at that shared home |
| `meta` | **top level** — a real SHARED section since [#607](https://github.com/Omega-JS-Stack/omega/issues/607) (title, description, image, keywords + the head knobs), schema-declared, with `targets.web.meta` overlaying it. It is also the ONE section a page may restate BARE in frontmatter (`pageBare: true`); every other section a page overrides goes under `config:` |
| `download`, `extension`, `favicon`, `manifest`, `icons` | `targets.web.<same key>` (target overlay puts them back at the top level for web loads) |
| `recaptcha` (incl. `site-key`) | **`captcha.providers.recaptcha`** (`siteKey` — every key is camelCase, #23) |
| `cloudflare` (the purge `zone`) | **`edge.providers.cloudflare`** — one cloudflare home, shared with the manager's zone reconciliation (#23) |
| `advertising.google-adsense` (flat or under `providers`) | **`advertising.providers.adsense`** with camelCase slots (`displaySlot`, `inArticleSlot`, `inFeedSlot`, `multiplexSlot`) — provider ids drop the vendor prefix (#23) |
| `permalink`, `pagination`, `collections`, `defaults`, `generators` | `targets.web.<same key>` (codemod rule 8's home — engine consumption of custom collections rides the consumer-theme waves) |
| UJM-json `distribute`, `sass.purgecss`, `imagemin`, `github.workflows` | `targets.web.{distribute,purgecss,imagemin,workflows}` — `imagemin` is LIVE (schema-known; `enabled: false` ships images verbatim, otherwise the build-time 320/640/1024 + webp matrix runs), and `purgecss.safelist` is LIVE too ([#250](https://github.com/Omega-JS-Stack/omega/issues/250)): schema-known (`{ standard, deep, greedy, keyframes }` arrays, or a bare array for `standard`), it merges over the framework's built-in safelist in the purge pass |
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
  composeTargetConfig, // (projectDir, target) → { config, files } — company+brand+local frozen into ONE self-contained file (deploy upload boundary, #31)
  hasOmegaConfig,      // (projectDir) → boolean — "is this project migrated?"
  resolveConfigPath,   // (projectDir) → abs path | null
  getEnabledTargets,   // (config) → ['web', 'backend', …]
  findBrandRoot,       // (projectDir) → brand root | null — CLASSIFIES one target dir (THE hierarchy rule)
  findBrandConfigPath, // (projectDir) → the BRAND layer's omega.json5 | null — the file a target with no local-layer file rides
  resolveBrandRoot,    // (startDir) → brand root | null — SEARCHES upward from anywhere (standalone → itself), bounded at the nearest .git
  loadEnv,             // (startDir) → { chain, loaded } — resolve + load the .env cascade
  resolveEnvChain,     // (startDir) → { local, brand, company } .env paths (no loading)
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
  chosenProvider,      // (role.providers) → the picked provider name | null — presence is the pick, `false` the off switch (#425)
  backendProjectType,  // (targets.backend | resolved backend config) → 'firebase' | 'custom' — how the backend runs (#584)
  BACKEND_PROJECT_TYPES,
  applyConfigEdits,    // (source, edits, { comments }?) → edited source — comment-preserving (see Writeback)
  writeConfigValues,   // (projectDir, edits, { dryRun, comments }?) → { path, changed, applied }
  applyConfigRemovals, // (source, paths) → edited source — deletes a key, its subtree and its own comment (#612)
  removeConfigValues,  // (projectDir, paths, { dryRun }?) → { path, changed, removed } — absent paths skip, so reruns are byte-identical
  schemaDefaults,      // (target?) → the schema's own defaults, the merge chain's lowest layer (#478)
  missingDefaults,     // (rawConfig, target?) → [{ path, value }] — the blocks a brand file lacks (the manage heal's list)
  defaultComments,     // (target?) → { 'dot.path': description } — the guiding comments a materialized block carries
  deepMerge,           // agnostic layer merge
  // Multi-instance targets (instances.js — the ONE iteration mechanism)
  normalizeTargetInstances, // (targets.<type> value) → [{ id, … }] (object form = [{ id: 'main', …entry }])
  instanceIdFromDirName,    // ('website-admin', 'web') → 'admin'; canonical/unconventional dirs → 'main'
  instanceTargetDir,        // ('web', 'admin') → 'website-admin'; main → the canonical dir
  targetInstance,           // (projectDir, target) → this target dir's instance id (brand targets only; standalone → 'main')
  resolveInstanceEntry,     // (entry, id) → the instance's merge layer (id stripped) | null
  instancePortOffset,       // (entry, id) → position in the instances array (dev-port offsets)
  resolveInstanceUrl,       // (entry, id, config) → instance url → instance brand.url → brand.url | null
  DIR_TARGETS, TARGET_DIRS, MAIN_INSTANCE, // the target-dir mapping SSOT (manager re-exports)
  TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS,
} = require('@omega.js/config');
```
