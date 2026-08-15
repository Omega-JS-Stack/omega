# Breaking changes — legacy → OMEGA

The register of every contract that changed SHAPE between a legacy framework and
its OMEGA successor, with the by-hand migration step for each. Read it once per
legacy brand: work down the sections that apply and the brand lands on the new
contracts in one pass.

**No framework dual-reads a legacy form.** An old key, an old name, an old file
is not "deprecated but accepted" — it is unknown, and the loud ones fail
validation ([#142](https://github.com/Omega-JS-Stack/omega/issues/142)). The only
sanctioned legacy-reading paths are the one-time converters: `npx omega migrate`
for a UJM website, and the mapping tables in
[config.md](config.md#migration--legacy-configs--omegajson5) for every other
target.

**Boundaries.** What never got PORTED is [#78](https://github.com/Omega-JS-Stack/omega/issues/78)'s
gap tables, not this file. Converter TOOLING is
[#40](https://github.com/Omega-JS-Stack/omega/issues/40) — these rows are its
input, not its implementation. The legacy repos stay read-only reference
(AGENTS.md HARD RULE 1): nothing here asks you to change them.

## `ultimate-jekyll-manager` → `@omega.js/web`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Build engine | Jekyll 4 + Ruby/Bundler (`Gemfile`, `Gemfile.lock`, `src/_config.yml`) | Eleventy 3 + LiquidJS, Node only | Run `npx omega migrate --check`, then `npx omega migrate` in the website app: it converts the config, runs the codemod, and deletes `src/_config.yml`, `config/ultimate-jekyll-manager.json`, `Gemfile`, `Gemfile.lock`, `.ruby-version`. Drop the Ruby toolchain from CI |
| Package + CLI | `ultimate-jekyll-manager` dependency; `uj` / `ujm` / `ultimate-jekyll` / `mgr` bins | `@omega.js/web`; `omega` / `omg` / `mgr` | Swap the dependency; replace `npx mgr <verb>` with `npx omega <verb>` in every npm script and workflow |
| Config | `src/_config.yml` + `config/ultimate-jekyll-manager.json` | `config/omega.json5` | Key-by-key table in [config.md](config.md#ultimate-jekyll-manager-src_configyml--configultimate-jekyll-managerjson--omega-migrate-b4-checkpoint-32); `omega migrate` writes it for you |
| Client-runtime config key | `web_manager: { … }` | `client` (`targets.web.client`) | Rename the block and relocate its children per the UJM mapping table in [config.md](config.md#migration--legacy-configs--omegajson5) (the SSOT for the key-by-key moves). The old name is a validation error, not a silent no-op |
| Framework file delivery | `distribute.js` COPIED framework layouts/includes/assets into the consumer repo | Layered resolution (consumer → active theme → base → core), first-layer-wins per relative path, zero copying | Delete every copied framework file from the repo; keep only files you truly override, at the same relative path. `npx omega customize --list` prints the override map |
| Layout values | `layout: themes/[ site.theme.id ]/frontend/pages/blog` (or hardcoded `themes/classy/…`) | The plain layout name: `layout: frontend/pages/blog` | Codemod rule `bracket-layout`, or strip the `themes/<id>/` prefix by hand. An unmigrated value fails the build loudly ("Problem creating an Eleventy Layout") — the engine no longer aliases the old spellings |
| Frontmatter refs | Bracket interpolation — `title: [ site.brand.name ]` | Real Liquid — `title: {{ site.brand.name }}` | Rewrite `[ … ]` to `{{ … }}` in frontmatter by hand (the codemod covers only `layout:` lines). An unmigrated value ships the literal brackets into the output — nothing resolves them anymore |
| Page data reads | `page.<frontmatterKey>`, `page.content`, `page.slug`, `page.resolved.*`, `page.canonical.url` | Bare `<key>`, `content`, `page.fileSlug`, `resolved.*`, `{{ site.url }}{{ page.url }}` | Codemod rules `page-props`, `page-resolved`, `canonical-url`. `page.next` / `page.previous` / `page.collection` have NO mechanical equivalent — port them by hand to the Eleventy collections API |
| Page frontmatter scope | Any frontmatter key fed the templates | META-ONLY allow-list (`meta`, `schema`, `theme`, `client`, `append`, `sitemap`, `templateEngineOverride`, `eleventyExcludeFromCollections`); other content keys are stripped with a build warning | Move page content out of frontmatter into `{% section %}` entries or a collection document (collection entries and layouts are exempt — their frontmatter IS the document) |
| Nested loops | `forloop.parentloop.<prop>` | A hoisted `{% assign omega_parentloop<depth>_<prop> = forloop.<prop> %}` after the parent `{% for %}` (LiquidJS has no parentloop) | Codemod rule `parentloop`; it flags the cases it will not touch (multi-level, same-line) for hand-hoisting |
| Interpolated tag args | `{% omega_icon "{{ page.icon }}" %}` — Jekyll silently no-op'd it | `{% capture omega_migrate_arg_1 %}…{% endcapture %}` hoisted above, the variable passed as the arg | Codemod rule `tag-arg-interpolation`; verify each reported line that it could not rewrite |
| Includes | `{% include /components/x.html %}` | `{% include components/x.html %}` (no leading slash) | Codemod rule `include-slash` |
| Analytics template reads | `site.analytics.google` | `site.analytics.providers.google.id` | Codemod rule `analytics-shape` |
| Sass entry | `@use 'ultimate-jekyll-manager' as * with (…)` in `src/assets/css/main.scss`; page CSS files `@use`-ing themselves | `@use 'omega:main' with (…)`; the self-`@use` lines are gone (theme page css loads through `pageAssets.themeCss`) | `omega migrate`'s consumer-assets pass rewrites both; by hand it is a one-line edit plus deleting the self-`@use` lines |
| JS entry | Seeded `src/assets/js/main.js` bootstrapping the manager | Deleted — core main + the boot runtime own it | `omega migrate` deletes an untouched seed and FLAGS a customized one; port custom logic into a page or section module |
| Client bootstrap | `import webManager from 'web-manager'`; `window.Manager` global | `import omega from '@omega.js/client'`; no window global (the client is a singleton — import it) | Replace the import in every module; delete `window.Manager` references |
| Deploy | `npu sync --message='Deploy'` shell-out | `omega deploy` (plain git sync + `workflow_dispatch`, or the direct lane) | Replace the script; contract in [deploys.md](deploys.md) |
| Version maintenance | Setup-time `ensureManagerVersion()` + peer-dependency auto-install | The explicit `omega update` verb | Stop expecting self-updates; run `npx omega update` (`--apply` to install) — [updates.md](updates.md) |

## `backend-manager` → `@omega.js/backend`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Package + init | `require('backend-manager')`; `Manager.init({ backendManagerConfigPath: 'backend-manager-config.json' })` | `require('@omega.js/backend')`; the config loader discovers the file — the option is GONE | Swap the dependency and delete the `backendManagerConfigPath` option from `functions/index.js` |
| Config | `functions/backend-manager-config.json` | `functions/config/omega.json5` | Key-by-key table in [config.md](config.md#backend-manager-functionsbackend-manager-configjson--functionsconfigomegajson5--done-checkpoint-19) |
| Exported Cloud Functions | `bm_api`, `bm_signUpHandler`, `bm_createPost`, `bm_cronDaily`, … | `omega_api`, `omega_signUpHandler`, `omega_createPost`, `omega_cronDaily`, … | Deploy the new names, repoint every trigger/scheduler/webhook that names a function, then DELETE the orphaned `bm_*` functions from the Firebase project (a rename leaves the old ones running) |
| Hosting rewrite | `{ source: '/backend-manager/**', function: 'bm_api' }` | `{ source: '{/omega,/omega/**,/backend-manager,/backend-manager/**,/mcp,/mcp/**,/.well-known/oauth-protected-resource,/.well-known/oauth-authorization-server,/authorize,/token,/register}', function: 'omega_api' }` | `npx omega setup` writes it (and removes duplicates); by hand, replace the rewrite and keep it FIRST in the list |
| API dispatch | Command-based: `POST /backend-manager` with `{ command: 'user:sign-up', payload: {…} }` | REST: `POST /omega/user/sign-up` with the payload AS the body | Rewrite each caller: the command's `:` becomes a path segment, `payload` becomes the body. On the client, `omega.request('/omega/user/sign-up', { method: 'POST', body: {…} })` |
| URL prefix | `/backend-manager/*` | `/omega/*` (also `/omega_api/*` on the direct function URL) | Repoint every first-party caller. The old prefix still resolves — a deliberate external-client alias, see [Deliberate compatibility that REMAINS](#deliberate-compatibility-that-remains) |
| Per-request object | `BackendAssistant`; handler signature `module.exports = async ({ assistant, settings, analytics }) => …` | `RouteContext`; handler signature `module.exports = async ({ ctx, settings, analytics }) => …` | Rename the destructured argument and every `assistant.` call site (`ctx.respond`, `ctx.log`, `ctx.request`) in each custom route, event, and cron handler |
| Environment | `BACKEND_MANAGER_KEY`, `BACKEND_MANAGER_WEBHOOK_KEY`, `BEM_TEST_RUNNER`, `BEM_HTTPS_PORT` | `OMEGA_ADMIN_KEY`, `OMEGA_WEBHOOK_KEY`, `OMEGA_TEST_RUNNER`, `OMEGA_HTTPS_PORT` | Rename in `.env`, in CI secrets, and in anything that reads them. Values carry over unchanged |
| CLI | `bm` / `bem` / `backend-manager` / `mgr` bins | `omega` / `omg` / `mgr` (one dispatcher; a backend's `functions/` dir resolves to the backend CLI) | Replace the bin name in npm scripts and workflows |
| `test/*` routes | Every route under `routes/test/` served at its production URL | The whole `test/` route folder 404s outside dev/testing, with zero carve-outs; contract in the backend's `docs/routes.md` ([#238](https://github.com/Omega-JS-Stack/omega/issues/238)) | Use `/omega/health` for liveness (a real route, public, no input echoed) — not `/omega/test/health`. A brand whose own `routes/test/*` route must serve in production moves it out of the `test/` folder; debug routes belong in `test/` and are gated by default |

## `electron-manager` → `@omega.js/desktop`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Package + entries | `require('electron-manager/main' \| '/preload' \| '/renderer' \| '/gulp' \| '/test/assert')` | `require('@omega.js/desktop/main' \| '/preload' \| '/renderer' \| '/gulp' \| '/test/assert')` | Swap the dependency and every require path in `src/main.js`, `src/preload.js`, the renderer components, `gulpfile.js`, and the test files |
| CLI | `em` / `electron-manager` / `mgr` bins | `omega` / `omg` / `mgr` | Replace the bin name in npm scripts and workflows |
| Config | `config/electron-manager.json` | `config/omega.json5` | Key-by-key table in [config.md](config.md#electron-manager-configelectron-managerjson--configomegajson5--done-checkpoint-18) — note the per-OS move: `targets.mac` / `.win` / `.linux` → `targets.desktop.platforms.mac` / `.win` / `.linux` |
| Windows signing strategy | `config/electron-manager.json` → `signing.windows.strategy` | `config/omega.json5` → `targets.desktop.platforms.win.signing.strategy` | Move the key; the `.env` credential slots (`CSC_LINK`, signtool path, cloud-provider creds) keep their names |
| Config validation | EM's local validation util | The shared `@omega.js/config` schema, at boot and in the audit task | Nothing to move — but expect boot to report schema findings a legacy config silently carried, and fix them |
| Preload global | `contextBridge.exposeInMainWorld('em', …)` → `window.em` | `window.desktop` | Rename every `window.em.*` call in renderer code |
| Theme controls | `data-em-theme-set="system\|light\|dark"` | `data-omega-theme-set="system\|light\|dark"` | Rename the attribute in every view |
| Client bridge | `web-manager-bridge.js`; `manager.webManager` in renderer entries | `client-bridge.js` + `@omega.js/client`; `manager.omega` | Rename the destructured property (`const { logger, ipc, storage, omega } = manager`) and every `webManager.` call to `omega.` |
| Environment | `BACKEND_MANAGER_KEY` in the app's `.env` | `OMEGA_ADMIN_KEY`, resolved through the `.env` cascade (shell > app > brand root > company) | Rename the key; in a brand monorepo put the value at the brand root and leave the app's placeholder commented |
| Startup config | `startup.openAtLogin: true\|false` — a bare boolean | `startup: { openAtLogin: { enabled, mode } }` (`startup.mode` is a SEPARATE knob: the user-launch mode) | Rewrite the boolean as the object under the same `openAtLogin` key. The boolean is TEMPORARILY still read: the config schema declares only `startup.mode`, so it cannot reject the old shape yet — the acceptance leg retires with the schema entry ([#148](https://github.com/Omega-JS-Stack/omega/issues/148) trail) |

## `browser-extension-manager` → `@omega.js/extension`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Package + entries | `require('browser-extension-manager/build' \| '/test/assert')` | `require('@omega.js/extension/build' \| '/test/assert')` | Swap the dependency and the require paths in `hooks/build/pre.js`, `hooks/build/post.js`, `gulpfile.js`, and the tests |
| CLI | `xm` / `bxm` / `ext` / `browser-extension-manager` / `mgr` bins | `omega` / `omg` / `mgr` | Replace the bin name in npm scripts and workflows |
| Config | `config/browser-extension-manager.json` | `config/omega.json5` (`targets.extension: {}` — key presence enables the target) | Key-by-key table in [config.md](config.md#browser-extension-manager-configbrowser-extension-managerjson--configomegajson5--done-checkpoint-20) |
| Analytics secret | `analytics.providers.google.secret` in the config file | `.env` → `GOOGLE_ANALYTICS_SECRET` (the loader hard-fails secret-shaped config keys) | Move the value to `.env`; the build snapshot bakes it exactly as before |
| Runtime singleton | `import webManager from 'web-manager'`; `manager.webManager` | `import omega from '@omega.js/client'`; `manager.omega` | Swap the import and rename the property in every context (background, popup, options, sidepanel, content scripts) |
| DOM bindings | `data-wm-bind` | `data-omega-bind` | Rename the attribute in every view |
| Cross-context messages | `{ command: 'bxm:syncAuth' }`, `{ command: 'bxm:signOut' }` | `{ command: 'omega:syncAuth' }`, `{ command: 'omega:signOut' }` | Rename in any custom `runtime.onMessage` handler or sender the extension ships |

## `web-manager` → `@omega.js/client`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Package + import | `import webManager from 'web-manager'` (npm `web-manager`) | `import omega from '@omega.js/client'` — still a singleton default export | Swap the dependency and every import; the module API (`auth()`, `firestore()`, `bindings()`, `initialize(configuration)`) carries over unchanged |
| Global | `window.Manager` / a page-attached `webManager` | No window global — import the singleton wherever it is needed | Delete the window assignments and the code that reads them |
| DOM bindings | `data-wm-bind` | `data-omega-bind` | Rename the attribute in every template and view |
| Sign-out hook | `.auth-signout-btn` class, hardcoded in the auth module | The generic `omega-signout` click trigger (`registerTrigger('signout', …)` → class `omega-signout`) | Rename the class on every sign-out control; custom behavior registers its own trigger instead of patching auth |
| Device module | `webManager.usage()` | `omega.device()` | Rename the call sites (`usage.js` became `device.js` verbatim) |
| Configuration payload | The site emitted a `web_manager` block into `window.Configuration` | The `client` block, composed from `resolved.client` | Config-side rename — see the UJM row and [config.md](config.md); nothing dual-reads the old key |
| Version-check manifest | The client probed `/build.json` then `/@output/build/build.json`, reading `data.timestamp` OR `data['npm-build'].timestamp` | One fetch of `/build.json`, one read of `data.timestamp` (the omega web build emits exactly this) | Nothing to do on a migrated site. A site still serving the old path or the `npm-build` wrapper logs "No timestamp found in build.json" and never auto-reloads on a new deploy |

## `jekyll-uj-powertools` → `@omega.js/template-kit`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Delivery | Ruby gem `jekyll-uj-powertools` in the `Gemfile` | JS package `@omega.js/template-kit`, vendored into `@omega.js/web` | Remove the gem line (the whole `Gemfile` goes — see the UJM engine row); nothing to install, the filters and tags are registered by the web engine |
| Tag + filter names | `uj_icon`, `uj_image`, `uj_readtime`, `uj_liquify`, … (`iftruthy`, `iffalsy`, `iffile`, `urlmatches` were already unprefixed) | `omega_icon`, `omega_image`, `omega_readtime`, `omega_liquify`, … — the four unprefixed names are unchanged | Codemod rule `legacy-prefix` renames every registered name; there are NO aliases, so a missed `uj_*` is an undefined tag/filter. Inventory: [docs/web/template-kit.md](../web/template-kit.md) |
| Site namespace | `site.uj.*` (`cache_breaker`, `date.year`, `date.iso`, `placeholder.src`); Jekyll's `site.time` | `site.omega.*`; the build stamp is `site.omega.date.iso` | Codemod rule `legacy-prefix` handles `site.uj`; rewrite `site.time` by hand |
| Markup hooks | `uj-password-show`, `uj-password-hide`, `uj-language-flag`, `uj-language-dropdown`, `uj-schema-*`, `data-uj-no-translate` | `omega-password-show`, `omega-password-hide`, `omega-language-flag`, `omega-language-dropdown`, `omega-schema-*`, `data-omega-no-translate` | Codemod rule `legacy-prefix` renames all of them; check hand-written CSS/JS that selects on the old names |
| Ruby generators + hooks | `variable_resolver.rb`, `blog-taxonomy.rb`, `inject-properties.rb`, `dynamic-pages.rb`, `limit-collections.rb`, `markdown-images.rb`, `parallel-build.rb` | Engine features of `@omega.js/web` (frontmatter Liquid, collections + pagination, the `resolved` cascade) — not template functions | Nothing to migrate: they were never consumer-callable. Which of them exist today and which never got ported is [#78](https://github.com/Omega-JS-Stack/omega/issues/78)'s table, not this register |

## `omega-manager` → `@omega.js/manager`

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Brand config home | Central: `omega-manager/.brands/<id>/config.json` (one repo describing every brand) | The brand's OWN repo: `config/omega.json5` | Convert the brand's config file into the brand repo using the tables in [config.md](config.md) (shared sections at the top level, per-surface settings under `targets.<type>`), then retire the `.brands/<id>/` entry |
| Enabled targets | `targets: ['website', 'backend']` — an array | `targets: { web: {}, backend: {} }` — an object where key PRESENCE enables the target | Rewrite the array as object keys; note the rename `website` → `web` |
| Repo topology | One clone per surface, located by `local.folder` + `github.orgMain` / `orgWebsite` | ONE brand monorepo: npm workspaces, `apps/<target>/` per enabled target ([docs/manager/brand.md](../manager/brand.md)) | Merge the per-surface repos into one brand repo as `apps/website`, `apps/backend`, `apps/desktop`, `apps/extension`; the brand root holds `config/omega.json5`, `.env`, `assets/`, and the workspace `package.json` |
| Durable state | `omega-manager/.output/<id>/state.json` | The brand's `.omega/state.json` (gitignored, per-machine) | Copy the durable IDs across, or let a manage run re-derive them; never commit `.omega/` |
| State service keys | `.omega/state.json` keyed by service name: `firebase` / `sentry` / `sendgrid` / `beehiiv` (pre-cp134; the manager used to migrate them on read) | Role keys only: `cloud` / `monitoring` / `campaigns` / `newsletter` | Rename the four keys in `.omega/state.json` by hand. An old key is now ignored: the service loses its durable IDs and re-provisions from scratch on the next run |
| AGENTS.md healing | Line 1 imported `@node_modules/@omega.js/manager/AGENTS.md`; the walk rewrote that target and scrubbed the cp244 marker/skeleton lines | Line 1 imports `@node_modules/@omega.js/AGENTS.md`; the walk only prepends a missing current import, never rewrites retired lines | Delete the old import line and any cp244 marker/skeleton line by hand — left in place they survive as consumer content (a dangling duplicate import) |
| package.json script healing | Script values leading with the `omega-manager` bin token were healed to `omega` on every walk | Missing `manage: "omega"` and `deploy: "omega deploy"` scripts are minted, and exactly one value migrates: the legacy `start: "omega"` becomes `start: "omega dev"` ([#227](https://github.com/Omega-JS-Stack/omega/issues/227)); every other script value, the `omega-manager` token included, is never rewritten | Replace the leading `omega-manager` token with `omega` by hand (arguments unchanged) — unedited, the script fails at run time with command-not-found: no `omega-manager` bin exists (Ian retired the vestigial shim, 2026-08-05) |
| Secrets store | `omega-manager/.output/<id>/secrets/*.json` | The brand's `.omega/secrets/*` plus the `.env` cascade (app → brand → company) | Move the files into the brand's `.omega/secrets/`; secret VALUES belong in `.env`, never in `omega.json5` |
| Brand assets | `omega-manager/.brands/<id>/assets/` | The brand repo's `assets/` (logo sources, templates); derived variants land in the gitignored `.omega/assets/` | Copy the source assets into the brand repo; a manage cycle regenerates the derived set |
| Entry point | `npm start` inside the omega-manager repo, all brands at once, `--brand <id>` to narrow | `npx omega` (or `npm run manage`) inside the BRAND root — one brand, always; `--service=<name>` still narrows to one service | Run the manage cycle from the brand repo; there is no cross-brand run |
| Retired flags | `--bump`, `--build`, `--sync`, `--deploy`, `--exec`, `--dirty`, `--force-recreate` | Gone with the multi-repo-clone model | Use the per-target verbs instead: `omega deploy` at the brand root fans out (backend → web → extension/desktop), `omega update` handles version bumps. The drop calls are recorded in [#78](https://github.com/Omega-JS-Stack/omega/issues/78) |

## Cross-cutting

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Config keys (every framework) | Per-framework key names and homes | The omega.json5 schema | **Do not re-derive them here** — the key-by-key mapping tables are in [config.md](config.md#migration--legacy-configs--omegajson5), one table per legacy framework, and they are the SSOT |
| Config file | One JSON file per framework (`ultimate-jekyll-manager.json`, `backend-manager-config.json`, `electron-manager.json`, `browser-extension-manager.json`) | ONE format everywhere: `config/omega.json5`, merged `defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>` | Convert once, delete the old file. In a brand monorepo the apps carry no config of their own — the brand root's file owns everything |
| Retired key names | Renamed keys used to validate clean and their contents vanished | Retired names FAIL validation wherever they sit, naming their replacement (`web_manager` → `client`, `firebaseConfig` → `cloud`), plus path-based retirements (`slapform` → `forms.providers.slapform`, `cloudflare` → `edge.providers.cloudflare`, …) | Fix what the validator names; the full retired list is [config.md](config.md#migration--legacy-configs--omegajson5) |
| Secrets | Secret values sat in the framework config files | Config hard-fails secret-shaped keys; secrets live in `.env`, resolved through the cascade shell > app > brand root > company | Move every secret out of config into `.env`, brand-root first so the apps inherit it |
| CLI bins | EVERY legacy framework shipped a `mgr` bin (plus `uj`/`bm`/`em`/`bxm`), so in a multi-target repo whichever npm hoisted won | One context-aware dispatcher: `omega` / `omg` / `mgr`, all identical — the nearest `package.json` walking up from cwd names the framework whose CLI runs | Replace legacy bin names in npm scripts and CI; run the verb from the app dir that owns it |
| CLI default | A bare `omega` / `mgr` at a brand root RAN the whole service walk (omega-manager's default command) | Every verb is named: `omega manage` is the walk (one name, no alias), `omega dev` the local stack, `omega deploy` the publish. A bare `omega` prints help and touches nothing ([#229](https://github.com/Omega-JS-Stack/omega/issues/229)) | Replace bare `omega`/`mgr` invocations with `omega manage` in scripts, cron, and CI. A brand still carrying `manage: 'omega'` must be walked ONCE by hand — `npx omega manage` — because its own `npm run manage` would print help; that walk heals the script to `omega manage` |
| Publish | Per-framework release scripts and `npu sync` | `omega deploy` on every target — deliberate, never triggered by a push; at a brand root it fans out (backend → web → extension/desktop) | Replace publish scripts with `omega deploy`; contract in [deploys.md](deploys.md) |
| Dependency updates | Framework self-update + peer-dependency auto-install at setup | The explicit `omega update` verb (report first, `--apply` installs, majors opt-in) | Run it deliberately — [updates.md](updates.md) |
| Environment prefixes | `BACKEND_MANAGER_*`, `BEM_*`, framework-specific names | `OMEGA_*` | Rename in `.env`, CI secrets, and every reader. Each framework's `_.env` template is the current list — `npx omega setup` refreshes it |
| Default/Custom file markers | The marker grammar in `_.env`, `_.gitignore`, `AGENTS.md` | **UNCHANGED — this is not legacy.** The Default/Custom marker grammar is the live defaults-engine mechanism that merges framework-owned lines into consumer-owned files | Leave the markers alone in migrated files; `omega setup` rewrites the Default block and preserves everything under Custom |

## Deliberate compatibility that REMAINS

Old forms the new system still speaks ON PURPOSE, because a party outside this
ecosystem still sends them. They are NOT accommodations to clean up: each one
retires when its named condition is met, and never unilaterally.

| Compatibility | Who still speaks it | Retirement condition |
|---|---|---|
| The `/backend-manager/*` URL alias — the backend router's prefix strip and its Cloudflare edge-worker twin (`packages/manager/src/services/cloudflare/workers/omega-api-proxy.js`) | In-the-wild clients of migrated brands: shipped apps, third-party integrations, and pages still calling the old path | Every known caller moved to `/omega/*` and the alias shows no traffic |
| `backendManagerKey` sent in outbound request bodies (`process.env.OMEGA_ADMIN_KEY` under the OLD field name) | Legacy-BEM parent deployments, the Ghostii API, and ITW's `wrapper` Cloud Function — all still reading that field | Each upstream migrates to the new stack and accepts the `omega-admin-key` header; fix per upstream, never unilaterally |
| The Ghostii flat-article response fallback | api.ghostii.ai, whose production backend runs legacy BEM and can return the flat field shape | Ghostii returns only the structured shape |
| The `gatherings/online` sign-out leg | Old somiibo / electron-manager desktop clients that still write that RTDB path | Those app versions are out of circulation |
| `legacyProductIds` / `legacyPlanIds` matching in the PayPal and Chargebee processors | Currently-billing subscribers on plan/product IDs created before the current catalog | The last subscription on a legacy ID ends or is migrated |
| The legacy desktop deep-link param translation in web core auth (`?destination=&source=app&signout=&cb=` → `authReturnUrl` / `authSignout`, chained through `/token`) | Shipped legacy desktop apps whose auth links are baked into installed binaries | Those app versions are out of circulation |
| Fixed legacy download filenames in the desktop mirror-downloads task (`Somiibo.dmg`, `Somiibo-Setup.exe`, `somiibo_amd64.deb`) | Every published download link and site pointing at the stable, version-less filename | No published link depends on the stable filename |
