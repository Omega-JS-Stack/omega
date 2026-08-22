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
| Build engine | Jekyll 4 + Ruby/Bundler (`Gemfile`, `Gemfile.lock`, `src/_config.yml`) | Eleventy 3 + LiquidJS, Node only | Run `npx omega migrate --check`, then `npx omega migrate` in the website target: it converts the config, runs the codemod, and deletes `src/_config.yml`, `config/ultimate-jekyll-manager.json`, `Gemfile`, `Gemfile.lock`, `.ruby-version`. Drop the Ruby toolchain from CI |
| Package + CLI | `ultimate-jekyll-manager` dependency; `uj` / `ujm` / `ultimate-jekyll` / `mgr` bins | `@omega.js/web`; `omega` / `omg` / `mgr` | Swap the dependency; replace `npx mgr <verb>` with `npx omega <verb>` in every npm script and workflow |
| Config | `src/_config.yml` + `config/ultimate-jekyll-manager.json` | `config/omega.json5` | Key-by-key table in [config.md](config.md#ultimate-jekyll-manager-src_configyml--configultimate-jekyll-managerjson--omega-migrate-b4-checkpoint-32); `omega migrate` writes it for you |
| Client-runtime config key | `web_manager: { … }` | `client` (`targets.web.client`) | Codemod rule `client-frontmatter` renames page-frontmatter blocks; config blocks relocate per the UJM mapping table in [config.md](config.md#migration--legacy-configs--omegajson5) (the SSOT for the key-by-key moves). The old name is a validation error, not a silent no-op |
| Framework file delivery | `distribute.js` COPIED framework layouts/includes/assets into the consumer repo | Layered resolution (consumer → active theme → base → core), first-layer-wins per relative path, zero copying | Delete every copied framework file from the repo; keep only files you truly override, at the same relative path. `npx omega customize --list` prints the override map |
| Layout values | `layout: themes/[ site.theme.id ]/frontend/pages/blog` (or hardcoded `themes/classy/…`) | The plain layout name: `layout: frontend/pages/blog` | Codemod rule `bracket-layout`, or strip the `themes/<id>/` prefix by hand. An unmigrated value fails the build loudly ("Problem creating an Eleventy Layout") — the engine no longer aliases the old spellings |
| Frontmatter refs | Bracket interpolation — `title: [ site.brand.name ]` | Real Liquid — `title: {{ site.brand.name }}` | Rewrite `[ … ]` to `{{ … }}` in frontmatter by hand (the codemod covers only `layout:` lines). An unmigrated value ships the literal brackets into the output — nothing resolves them anymore |
| Page data reads | `page.<frontmatterKey>`, `page.content`, `page.slug`, `page.resolved.*`, `page.canonical.url` | Bare `<key>`, `content`, `page.fileSlug`, `resolved.*`, `{{ site.url }}{{ page.url }}` | Codemod rules `page-props`, `page-resolved`, `canonical-url`. `page.next` / `page.previous` / `page.collection` have NO mechanical equivalent — port them by hand to the Eleventy collections API |
| Page frontmatter scope | Any frontmatter key fed the templates | META-ONLY allow-list (`meta`, `schema`, `theme`, `client`, `append`, `sitemap`, `templateEngineOverride`, `eleventyExcludeFromCollections`); other content keys are stripped with a build warning | Move page content out of frontmatter into `{% section %}` entries or a collection document (collection entries and layouts are exempt — their frontmatter IS the document) |
| Nested loops | `forloop.parentloop.<prop>` | A hoisted `{% assign omega_parentloop<depth>_<prop> = forloop.<prop> %}` after the parent `{% for %}` (LiquidJS has no parentloop) | Codemod rule `parentloop`; it flags the cases it will not touch (multi-level, same-line) for hand-hoisting |
| Interpolated tag args | `{% omega_icon "{{ page.icon }}" %}` — Jekyll silently no-op'd it | `{% capture omega_migrate_arg_1 %}…{% endcapture %}` hoisted above, the variable passed as the arg | Codemod rule `tag-arg-interpolation`; verify each reported line that it could not rewrite |
| Includes | `{% include /components/x.html %}` | `{% include components/x.html %}` (no leading slash) | Codemod rule `include-slash` |
| Analytics template reads | `site.analytics.google` | `site.analytics.providers.google.id` | Codemod rule `analytics-shape` |
| Classy gradient utilities | `.gradient-animated` (gradient shimmer) + `.gradient-grain` (noise overlay) on hero markup | `omega-dotgrid` — the masked dot backdrop v2 puts behind every hero — plus `data-omega-dotfield` where the animation was. Classy v2 ships zero gradients, so the old classes are silent no-ops | Codemod rule `gradient-utilities` converts both once ([#296](https://github.com/Omega-JS-Stack/omega/issues/296)); the pair on one element collapses to ONE `omega-dotgrid`. `.bg-gradient-*` names are NOT touched — v2 still neutralizes those to flat token paint |
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
| Marketing prune cron | Ran daily unless `marketing.prune.enabled: false` — a brand with NO `marketing.prune` block was pruning | Runs only when `marketing.prune.enabled` is explicitly `true` ([#422](https://github.com/Omega-JS-Stack/omega/issues/422)); absence means no pruning | A brand that wants the prune sets `marketing.prune.enabled: true` in its backend config; a brand that never wanted it does nothing |
| Firestore rules file | `firestore.rules` carried a framework-managed `// ========== OMEGA Rules (vX.Y.Z) ==========` block that `omega setup` regenerated wholesale on every run | `firestore.rules` is the brand's SOURCE — pure rules, no managed block. The framework half ships inside `@omega.js/backend` and compiles in; `firebase.json` points the emulator and `firebase deploy` at the generated `dist/firestore.rules` ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)) | `npx omega setup` converts the file ONCE (custom region preserved) and retargets `firebase.json` — no hand step for the conversion itself. But per-field protection a legacy BEM brand added by HAND-EDITING the managed block is not carried over, because the block is gone: re-declare those keys in your own `match /users/{uid}` block, which merges into the framework's (row below). Keys are TOP-LEVEL — protecting `xp.total` means listing `'xp'` |
| Firestore rules hooks (0.36.0 only) | The compiled model shipped with two brand HOOKS the framework called: `protectedFields()` (a list folded into the user write rule) and `canWriteUser()` (a condition ANDed into it), linted and re-seeded by the compiler | Merge-by-match: a brand match block whose path names a framework block's is MERGED into it, ANDing the brand's condition onto every op both declare. No hooks, no lint, no injection. Rules schema v2.0.0 → v3.0.0 ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)) | `npx omega setup` migrates ONCE: a hook still carrying its shipped default body is deleted, a CUSTOMIZED one is kept as an ordinary function and reported — nothing calls it any more, so move what it enforced into `match /users/{uid} { allow create, update: if …; }` in your own file and delete it. `protectedFields()` becomes `allow create, update: if !isWritingAny(['xp', …]);` in that block |
| Firestore rules helpers | `belongsTo(identity)`, `emailVerified()`, `isWritingProtectedUserField()`, `authUid()`, `authEmail()`, `existingData()`, `incomingData()`; `existingData()` was `resource.data`, so every field helper ERRORED on a create (which denied the write) | One naming convention, `is*` for predicates and `get*` for values: `isUser(identity)`, `isEmailVerified()`, `isWritingFrameworkField()`, `getAuthUid()`, `getAuthEmail()`, `getExistingData()`, `getIncomingData()`, plus new `isWritingAny(fields)` and `isOwner()`. `getRoles()` keeps its name and stays the one helper that bills a document read. `getExistingData()` reads an absent document as `{}`, so the field helpers mean the same thing on create and update ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)) | The setup migration renames every one of those calls inside your rules file. Three behaviour changes to know: a signed-in client may now CREATE its own `users/{uid}` document as long as it carries no framework-owned key (before, every client create was denied by the error); `isUser()`'s EMAIL arm now requires a verified token, so an unverified signup claiming an address no longer matches a document keyed by it (the uid arm is unchanged); and `plan` came off the framework's protected key list — nothing in the stack reads or writes `users/{uid}.plan`, and a brand that still stores one protects it in its own merged block |
| `isEmailVerified()` source of truth | Read the STORED `users/{uid}.verifications.email` through `getVerifications()`, at one billed document read per call | Reads the AUTH TOKEN: `request.auth != null && request.auth.token.get('email_verified', false) == true`. `getVerifications()` is REMOVED, and `verifications` joins the framework-owned key list ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)) | Nothing to rename — the helper keeps its name and gets honest: nothing in the stack has ever WRITTEN `verifications`, so the old gate was satisfiable only by a client planting the field on its own user document. Rules of yours that called `getVerifications()` must stop (it is gone), and a client write to `users/{uid}.verifications` is denied from now on |
| Framework `match /users/{uid}` ops | `allow read` + `allow write` — and `write` covers delete, where `request.resource` is null, so the field guard ERRORED and an owner deleting their own user document was denied by that error | `allow read` + `allow create, update`. Delete falls through to the admin catch-all and is denied by the RULE ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)) | Only if you TIGHTEN that block from your own `firestore.rules`: ops pair by NAME, so change your `allow write:` to `allow create, update:` or your condition appends as a widening instead of ANDing on. The compiler reports the mismatch loudly rather than letting it look like a tightening |
| Storage rules scaffold | `templates/storage.rules` granted the whole bucket to any signed-in user (`allow read, write: if request.auth!=null`) | Deny-all (`allow read, write: if false`) — a brand that serves files from Storage opts in per path it actually exposes ([#278](https://github.com/Omega-JS-Stack/omega/issues/278)) | Nothing is rewritten in place: setup writes `storage.rules` only when the file is missing, so a migrated brand keeps whatever it arrived with. Read that file once and narrow it by hand — a bucket-wide grant carried over from the old scaffold stays live until you do |

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
| Environment | `BACKEND_MANAGER_KEY` in the app's `.env` | `OMEGA_ADMIN_KEY`, resolved through the `.env` cascade (shell > local > brand root > company) | Rename the key; in a brand monorepo put the value at the brand root and leave the target's placeholder commented |
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
| DOM bindings | `data-wm-bind` | `data-omega-bind` | Codemod rule `client-markup` (templates, consumer JS, and section `.json` descriptors alike) |
| Sign-out hook | `.auth-signout-btn` class, hardcoded in the auth module | The generic `omega-signout` click trigger (`registerTrigger('signout', …)` → class `omega-signout`) | Codemod rule `client-markup` renames the class everywhere it appears; custom behavior registers its own trigger instead of patching auth |
| Device module | `webManager.usage()` | `omega.device()` | Rename the call sites (`usage.js` became `device.js` verbatim) |
| Configuration payload | The site emitted a `web_manager` block into `window.Configuration` | The `client` block, composed from `resolved.client` | Config-side rename — see the UJM row and [config.md](config.md); nothing dual-reads the old key |
| Version-check manifest | The client probed `/build.json` then `/@output/build/build.json`, reading `data.timestamp` OR `data['npm-build'].timestamp` | One fetch of the site's `build.json` — mounted under the page's `data-omega-path-prefix` stamp on a site served from a URL path ([#364](https://github.com/Omega-JS-Stack/omega/issues/364)), `/build.json` at the domain root — and one read of `data.timestamp` (the omega web build emits exactly this) | Nothing to do on a migrated site. A site still serving the old path or the `npm-build` wrapper logs "No timestamp found in build.json" and never auto-reloads on a new deploy |

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
| Repo topology | One clone per surface, located by `local.folder` + `github.orgMain` / `orgWebsite` | ONE brand monorepo: npm workspaces, `targets/<target>/` per enabled target ([docs/manager/brand.md](../manager/brand.md)) | Merge the per-surface repos into one brand repo as `targets/website`, `targets/backend`, `targets/desktop`, `targets/extension`; the brand root holds `config/omega.json5`, `.env`, `assets/`, and the workspace `package.json` |
| Durable state | `omega-manager/.output/<id>/state.json` | No durable-state file at all — every provisioned fact lands in the brand's `config/omega.json5`, every secret in its `.env` ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)) | Nothing to copy: a manage run resolves the ids from the platform and writes them into their real homes. Never commit `.omega/` |
| Service names (the last eight) | Services still carried their PROVIDER's name: `github` / `cloudflare` / `recaptcha` / `search-console` / `adsense` / `slapform` / `chatsy` / `replyify` ([#418](https://github.com/Omega-JS-Stack/omega/issues/418)) | Every service now matches its config ROLE key: `repo` / `edge` / `captcha` / `search` / `advertising` / `forms` / `chat` / `email`. The provider KEYS underneath are unchanged (`repo.providers.github`, `edge.providers.cloudflare`, `captcha.providers.recaptcha`, `search.providers.searchConsole`, `advertising.providers.adsense`, `forms.providers.slapform`, `inbound.chat.providers.chatsy`, `inbound.email.providers.replyify`) — the service is the role, the provider is a value | Update `--service=<name>` in any script or cron (`--service=cloudflare` is now `--service=edge`, …) and expect the walk's `[NAME]` log tag to change with it |
| AGENTS.md healing | Line 1 imported `@node_modules/@omega.js/manager/AGENTS.md`; the walk rewrote that target and scrubbed the cp244 marker/skeleton lines | Line 1 imports `@node_modules/@omega.js/AGENTS.md`; the walk only prepends a missing current import, never rewrites retired lines | Delete the old import line and any cp244 marker/skeleton line by hand — left in place they survive as consumer content (a dangling duplicate import) |
| package.json script healing | Script values leading with the `omega-manager` bin token were healed to `omega` on every walk | Missing `manage: "omega"` and `deploy: "omega deploy"` scripts are minted, and exactly one value migrates: the legacy `start: "omega"` becomes `start: "omega dev"` ([#227](https://github.com/Omega-JS-Stack/omega/issues/227)); every other script value, the `omega-manager` token included, is never rewritten | Replace the leading `omega-manager` token with `omega` by hand (arguments unchanged) — unedited, the script fails at run time with command-not-found: no `omega-manager` bin exists (Ian retired the vestigial shim, 2026-08-05) |
| Secrets store | `omega-manager/.output/<id>/secrets/*.json` | The brand's `.omega/secrets/*` plus the `.env` cascade (local → brand → company) | Move the files into the brand's `.omega/secrets/`; secret VALUES belong in `.env`, never in `omega.json5` |
| Brand assets | `omega-manager/.brands/<id>/assets/` | The brand repo's `assets/` (logo sources, templates); derived variants land in the gitignored `.omega/assets/` | Copy the source assets into the brand repo; a manage cycle regenerates the derived set |
| Entry point | `npm start` inside the omega-manager repo, all brands at once, `--brand <id>` to narrow | `npx omega` (or `npm run manage`) inside the BRAND root — one brand, always; `--service=<name>` still narrows to one service | Run the manage cycle from the brand repo; there is no cross-brand run |
| Retired flags | `--bump`, `--build`, `--sync`, `--deploy`, `--exec`, `--dirty`, `--force-recreate` | Gone with the multi-repo-clone model | Use the per-target verbs instead: `omega deploy` at the brand root fans out (backend → web → extension/desktop), `omega update` handles version bumps. The drop calls are recorded in [#78](https://github.com/Omega-JS-Stack/omega/issues/78) |

## Cross-cutting

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Config keys (every framework) | Per-framework key names and homes | The omega.json5 schema | **Do not re-derive them here** — the key-by-key mapping tables are in [config.md](config.md#migration--legacy-configs--omegajson5), one table per legacy framework, and they are the SSOT |
| Config file | One JSON file per framework (`ultimate-jekyll-manager.json`, `backend-manager-config.json`, `electron-manager.json`, `browser-extension-manager.json`) | ONE format everywhere: `config/omega.json5`, merged `defaults ← company ← brand shared ← brand targets.<type> ← local shared ← local targets.<type>` | Convert once, delete the old file. In a brand monorepo the targets carry no config of their own — the brand root's file owns everything |
| Retired key names | Renamed keys used to validate clean and their contents vanished | Retired names FAIL validation wherever they sit, naming their replacement (`web_manager` → `client`, `firebaseConfig` → `cloud`), plus path-based retirements (`slapform` → `forms.providers.slapform`, `cloudflare` → `edge.providers.cloudflare`, …) | Fix what the validator names; the full retired list is [config.md](config.md#migration--legacy-configs--omegajson5) |
| Secrets | Secret values sat in the framework config files | Config hard-fails secret-shaped keys; secrets live in `.env`, resolved through the cascade shell > local > brand root > company | Move every secret out of config into `.env`, brand-root first so the targets inherit it |
| CLI bins | EVERY legacy framework shipped a `mgr` bin (plus `uj`/`bm`/`em`/`bxm`), so in a multi-target repo whichever npm hoisted won | One context-aware dispatcher: `omega` / `omg` / `mgr`, all identical — the nearest `package.json` walking up from cwd names the framework whose CLI runs | Replace legacy bin names in npm scripts and CI; run the verb from the target dir that owns it |
| CLI default | A bare `omega` / `mgr` at a brand root RAN the whole service walk (omega-manager's default command) | Every verb is named: `omega manage` is the walk (one name, no alias), `omega dev` the local stack, `omega deploy` the publish. A bare `omega` prints help and touches nothing ([#229](https://github.com/Omega-JS-Stack/omega/issues/229)) | Replace bare `omega`/`mgr` invocations with `omega manage` in scripts, cron, and CI. A brand still carrying `manage: 'omega'` must be walked ONCE by hand — `npx omega manage` — because its own `npm run manage` would print help; that walk heals the script to `omega manage` |
| Publish | Per-framework release scripts and `npu sync` | `omega deploy` on every target — deliberate, never triggered by a push; at a brand root it fans out (backend → web → extension/desktop) | Replace publish scripts with `omega deploy`; contract in [deploys.md](deploys.md) |
| Dependency updates | Framework self-update + peer-dependency auto-install at setup | The explicit `omega update` verb (report first, `--apply` installs, majors opt-in) | Run it deliberately — [updates.md](updates.md) |
| Environment prefixes | `BACKEND_MANAGER_*`, `BEM_*`, framework-specific names | `OMEGA_*` | Rename in `.env`, CI secrets, and every reader. Each framework's `_.env` template is the current list — `npx omega setup` refreshes it |
| Default/Custom file markers | The marker grammar in `_.env`, `_.gitignore`, `AGENTS.md` | **UNCHANGED — this is not legacy.** The Default/Custom marker grammar is the live defaults-engine mechanism that merges framework-owned lines into consumer-owned files | Leave the markers alone in migrated files; `omega setup` rewrites the Default block and preserves everything under Custom |

## One provider shape — `role.providers.<provider>` ([#425](https://github.com/Omega-JS-Stack/omega/issues/425))

Not a legacy→OMEGA row: this is an OMEGA-internal config rename, made
deliberately before the first npm publish closes the window. Config sections
carried four shapes for the same idea — a `providers` block, a singular pick
(`provider: 'sentry'`), a bare vendor key (`certificates.apple`) and a fourth
word (`payment.processors`) — so a consumer had to memorise which section used
which. Every role now names its vendors ONE way: `role.providers.<provider>`,
where key PRESENCE is the pick and `false` is the deliberate off switch. The
null = unset / false = disabled tri-state is unchanged; it just moved into the
key. `cloud` is the ratified exception (`cloud.provider` + `cloud.config` — its
discriminator is read by 34 runtime files across every framework's bootstrap
and already delivers no-rename-on-a-second-provider).

Every row below is enforced: the old path FAILS validation naming its
replacement, so nothing is silently lost. There is no dual-read.

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Payment providers | `payment.processors.{stripe,paypal,chargebee,coinbase}` | `payment.providers.{stripe,paypal,chargebee,coinbase}` — contents identical | Rename the one key in `config/omega.json5`. The singular `processor` followed one issue later — the whole word is `provider` now, stored data included ([#428](#one-word--provider-everywhere-428) below) |
| Apple signing | `certificates.apple.{bundleIdPrefix,capabilities,profiles,certificates}` | `certificates.providers.apple.{…}` — contents identical | Nest the `apple` block one level under `providers`. Windows signing will sit beside it rather than adding a second bare vendor key. Nothing on disk moves: the signing tree stays `{companyRoot\|\|brandRoot}/.omega/certificates/apple/` |
| Domain registrar | `domain.provider: 'namecheap' \| 'squarespace' \| null` | `domain.providers.<registrar>` — e.g. `providers: { namecheap: {} }` | Replace the string with a keyed entry. **No entry = none chosen** and the domain service skips, exactly what `null` meant |
| Mailbox provider | `domain.email.provider: 'cloudflare' \| 'squarespace' \| 'privateemail' \| null` | `domain.email.providers.<provider>` | Same edit one level down. `domain.email.forwarding` stays role-level — it is provider-agnostic |
| Translation engine | `translation.provider: 'claude' \| 'chatgpt'` | `translation.providers.<name>` — `{ claude: {} }` or `{ chatgpt: {} }` | Replace the string with a keyed entry. An absent block still means `claude` (the no-API-key default), so a brand that never set `provider` needs no edit. `translation.model` stays role-level — it overrides whichever engine is chosen |
| Devlog writer | `devlog.provider: 'ghostii'` plus its settings flat on `devlog` (`lookbackDays`, `orgs`, `excludeRepos`, `excludeCommits`, `excludeTopics`, `includePrivate`, `postPath`, `destinations`, `overrides`) | `devlog.providers.ghostii.{lookbackDays,orgs,excludeRepos,excludeCommits,excludeTopics,includePrivate,postPath,destinations,overrides}` | Move the nine provider-hung keys inside `providers.ghostii` and drop the `provider` string (the key IS the writer). `devlog.enabled` stays role-level — it is the pipeline's switch, not the writer's |
| Error monitoring | `monitoring.provider: 'sentry'` plus its settings flat on `monitoring` (`org`, `dsn`, `environment`, `sampleRate`, `tracesSampleRate`, `scrubEmail`, `attachScreenshot`, `bundlePatterns`) | `monitoring.providers.sentry.{org,dsn,environment,sampleRate,tracesSampleRate,scrubEmail,attachScreenshot,bundlePatterns}` | Move the eight knobs inside `providers.sentry` and drop the `provider` string (the key IS the monitor). `monitoring.enabled` stays role-level. **Per-surface DSNs move too**: `targets.<type>.monitoring.dsn` → `targets.<type>.monitoring.providers.sentry.dsn` — the manager's `monitoring/dsn` operation writes the new path, so a rerun re-lands them. DSN presence is still the runtime enable signal; nothing on Sentry's side changes (same projects, same keys, same release tags) |
| Email marketing | `marketing.campaigns.provider: 'sendgrid'` + `marketing.campaigns.listId` | `marketing.campaigns.providers.sendgrid.listId` | Nest `listId` under `providers.sendgrid` and drop the `provider` string. `marketing.campaigns.enabled` stays role-level. The list itself is untouched — the id is the same SendGrid UUID, and the campaigns service writes the new path on its next run |
| Newsletter | `marketing.newsletter.provider: 'beehiiv'` + `marketing.newsletter.publicationId` | `marketing.newsletter.providers.beehiiv.publicationId` | Nest `publicationId` under `providers.beehiiv` and drop the `provider` string. **`marketing.newsletter.enabled` AND `marketing.newsletter.content` stay role-level** — `content` (sources, categories, tone, template, theme, sponsorships) configures @omega.js/backend's newsletter GENERATOR, not Beehiiv, so it does not move. Beehiiv holds no copy of the id: inbound webhooks are matched against config, so there is no data migration |
| AI blog | `blog.provider: 'ghostii'` | `blog.providers.ghostii` (key presence chooses the writer) | Replace the string with an (empty) `providers.ghostii` entry, or omit the block — an absent `providers` still defaults to ghostii. `blog.enabled` and `blog.content` stay role-level (content is pipeline config) |

Per-target overrides convert on the same terms: a `targets.<type>` block
carrying any of these keys is resolved at the top level, so it fails validation
with the same message and takes the same edit.

Two words the brand files carried but nothing read are simply gone with the
edit: `marketing.campaigns.platform` / `marketing.newsletter.platform` (a
legacy-BEM spelling of the same pick) BECOME the provider key. They are not in
the retired-path guard — they were already dead config, so nothing was lost
before or after — but leaving one behind now buys nothing.

## One word — `provider` everywhere ([#428](https://github.com/Omega-JS-Stack/omega/issues/428))

The other half of #425, and the same window: #425 normalized the config SHAPE
and deliberately left the singular runtime word `processor` standing, which
meant a brand read `payment.providers` in config and wrote `processor` on every
document it produced. Ian's ruling (2026-08-21): consistency wins — ONE word,
`provider`, in code, on the API, and in stored data. Everything below changed
together; there is no dual-read on any of it.

Third-party vocabulary is untouched: where a field name belongs to Stripe,
PayPal, Chargebee or Chargeblast, it is still read verbatim (Chargeblast's
alert payload still sends `processor`, and the route normalizes it onto our
`provider` on the way in).

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Payments API param | `processor` on all eight payments routes (`intent`, `cancel`, `plan`, `portal`, `refund`, `uncancel`, `webhook`, `winback`) — body field or `?processor=` query, per route | `provider` in the same position | Rename it in every caller. A first-party brand gets this from the framework's own frontend; a CUSTOM caller (a mobile client, a server integration, a saved webhook URL at Stripe/PayPal/Chargebee) must be repointed — the webhook and dispute-alert routes read it from the QUERY STRING, so the URL registered at the provider changes too. `npx omega manage` rewrites the webhook URLs it owns; anything registered by hand is a by-hand edit. An unrenamed param is an `Unknown provider: undefined` 400, never a silent default |
| Checkout dev param | `?_dev_cardProcessor=test\|stripe\|chargebee` | `?_dev_cardProvider=…` | Update saved QA links and any script driving a dev checkout. The old param is ignored (the palette control reads only the new name) |
| Email merge field | `user_subscription_payment_processor` (path `subscription.payment.processor`) | `user_subscription_payment_provider` (path `subscription.payment.provider`) | Rename the token in every custom email template. An unrenamed token resolves to nothing — the merge-field table no longer declares the old name |
| Analytics param | `payment_processor` on every commerce event (`purchase`, `refund`, plan changes, trial events) | `payment_provider` | Rename it in saved GA4 explorations, custom dimensions, and any dashboard filtered on the old key. Registered GA4 custom dimensions are per-name: register `payment_provider` alongside, and historical rows keep the old name |
| Stored Firestore field | `processor` on `payments-orders` / `payments-intents` / `payments-webhooks`, `alert.processor` on `payments-disputes`, and `subscription.payment.processor` on `users` | `provider` / `alert.provider` / `subscription.payment.provider` | **This one has DATA.** Deploy the new backend, then run the backfill against the brand's Firestore: `npx omega manage --migration=payment-provider` audits (prints per-collection would-change counts and writes nothing), and `--migration=payment-provider --execute` performs it. Idempotent and re-runnable: a doc already on the new field is skipped, a doc carrying both keeps `provider` and drops the leftover. Order matters only in that the sweep is safe either side of the deploy — a doc written by the new code needs no fix |
| Firestore composite index | `subscription.payment.processor` ASC + `subscription.cancellation.pending` ASC (the PayPal expiry cron's query) | Same index on `subscription.payment.provider` | `npx omega setup` rewrites `firestore.indexes.json`; deploy indexes before the backfill so the cron's query has one when the data lands. The old index is orphaned — delete it in the Firebase console once nothing queries the old field |
| Payment module directory | `libraries/payment/processors/<vendor>.js`, the per-route `<route>/processors/` folders, and `libraries/load-processor.js` (`loadProcessor()`) | `libraries/payment/providers/`, `<route>/providers/`, `libraries/load-provider.js` (`loadProvider()`) | Only a brand that requires a framework payment module by path (a custom route, a custom cron) is affected: repoint the require and rename the call |
| Admin payment sub-handler dir | `<brandRoot>/payment-processors/<productId>.js` — the per-product handler `POST /omega/admin/payment` loads | `<brandRoot>/payment-providers/<productId>.js` | Rename the directory. Nothing else about the handler contract changed; a brand with no such directory (almost all) has nothing to do |

## Two homes, not three — `.omega/state.json` retired ([#434](https://github.com/Omega-JS-Stack/omega/issues/434))

omega-manager's three-bucket principle came across intact: user choices in
config, durable derived data in `.omega/state.json`, per-run transients in
`.omega/runs/`. The middle bucket did not earn its keep. Almost everything in
it was a CACHE of what each idempotent ensure re-reads from the platform on
every run anyway, and the handful of facts that were genuinely durable were
sitting in a gitignored per-machine file instead of the two homes the
frameworks actually read — so a fresh clone silently lost them, and a
brand's `omega.json5` could stay `null` for months next to a state file that
had the answer.

The rule now: **a provisioned fact lands in `config/omega.json5`, a secret
lands in the brand `.env`, and everything else re-derives.** The handler
return key `state` survives as the WITHIN-RUN carry (how the zone operation
hands its zone id to the operations after it) and is written to no file.

`.omega/runs/{ts}.json` is unchanged. `.omega/state.json` lived on for exactly
one key — `deploy`, the per-machine deploy record
`@omega.js/devkit/deploy-record` writes on every successful deploy verb — and
that key has since moved to its own `.omega/deploys.json`
([#449](https://github.com/Omega-JS-Stack/omega/issues/449)), so the retired
name is gone for good. The move needs no migration step: deploy-record adopts
the old key on its first read or write and removes the file once nothing else
is left in it (a brand that has not run state-retirement yet keeps its file,
minus the key, for that migration to finish).

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| The state file | `.omega/state.json`, per-service keyed, written after every service | Gone. The migration moves each fact to its home and deletes the file (trimming it to the `deploy` key when the brand has one) | **This one has DATA.** `npx omega manage --migration=state-retirement` audits (prints every planned move and writes nothing); `--migration=state-retirement --execute` performs it. Idempotent: the executed run leaves nothing to move, so a re-run is a clean no-op. It is the ONE `local: true` migration — no backend target, no service account, no Firestore |
| GA4 Measurement Protocol secrets | `analytics.streams.{target}.apiSecret` in state; the disperse service read it from there | `GOOGLE_ANALYTICS_SECRET_{TARGET}` in the brand `.env`, written by the analytics service; disperse composes each target's own `GOOGLE_ANALYTICS_SECRET` from it | The migration moves them. A brand with no state file re-resolves them from GA on the next `npx omega manage` |
| VAPID key pair | `cloud.cloudMessaging.{vapidPublicKey,vapidPrivateKey}` in state | Public half → `cloud.messaging.vapidKey` in omega.json5 (it ships to every browser); private half → `VAPID_PRIVATE_KEY` in the brand `.env` | The migration splits them. Lose them and there is no API to re-read them: an interactive run re-prompts for the pair from the Firebase console |
| Cloudflare zone id | `edge.zoneId` in state (read by nothing across runs) | `edge.providers.cloudflare.zone` in omega.json5 — the id `omega purge` targets from a build, where no Cloudflare token is in play | The migration moves it, and the edge service now keeps it current: the resolved id always wins over a stale hand-set one |
| Reconcile confirmations | `search.gaLinked`, `payment.{radarConfirmed,disputesConfirmed}`, `cloud.authentication.oauthRedirectsConfigured`, `captcha.domainsConfirmed` in state | `search.providers.searchConsole.gaLinked`, `payment.providers.stripe.{radarConfirmed,disputesConfirmed}`, `cloud.oauthRedirectsConfigured`, `captcha.providers.recaptcha.domainsConfirmed` in omega.json5 | The migration moves them. These are the only reconcile flags config keeps — each is a human console action with no read API on either side, so nothing can re-check it. Every OTHER flag was dropped: the ensure re-reads the platform |
| Everything else | Repo identity, Search Console property URL, GA stream ids and URIs, Stripe account id, provider product ids, Apple certificates/profiles/bundle id, Sentry project map, the Firebase SDK config, billing/firestore/database/storage/hosting/functions status, SendGrid + Beehiiv names | Not persisted anywhere | Nothing to do — every one of them is re-read from its platform (or re-derived from config) by the idempotent ensure that owned it. The provider product ids and the SDK config already had their config home; state was a duplicate |
| `@omega.js/manager/state` subpath export | `require('@omega.js/manager/state')` → `readState` / `writeState` / `statePath` / `STATE_DIR` | Removed. `writeRunOutput` moved to `src/lib/run-output.js` and is still exported from the package root | Delete the import. Nothing in the monorepo or any brand used it |

## One vocabulary — a brand's surfaces live in `targets/` ([#443](https://github.com/Omega-JS-Stack/omega/issues/443))

Config has always called them `targets`; the folder they lived in said `apps/`,
and this monorepo's own `apps/` meant something else again — the in-repo test
BRANDS. Three meanings for two words. Ian's ruling (2026-08-21): one
vocabulary. A brand monorepo's surfaces live under `targets/`, and this
monorepo's brands live under `brands/`. Same behavior, new names — discovery,
scaffolding, the FILE_MAP semantics, disperse, the CI workflow templates and
every doc changed together, and nothing dual-reads `apps/`.

| Contract | Old form | New form | Manual migration step |
|---|---|---|---|
| Brand folder | `<brandRoot>/apps/<target>` — `apps/website`, `apps/backend`, `apps/desktop`, `apps/extension`, `apps/website-admin` | `<brandRoot>/targets/<target>` — the dir names inside are unchanged | **Run the migration ONCE, per brand**: `npx omega manage --migration=targets-rename --execute` (bare, without `--execute`, prints the plan and moves nothing), then `npm install` at the brand root. Nothing heals this inside a normal run — every other verb FAILS LOUD on the old shape and points here. Idempotent — a migrated brand re-runs as a no-op. A brand carrying BOTH folders is a half-done migration and fails loudly instead of guessing: merge them into `targets/` by hand, delete `apps/`, run again |
| Root workspaces glob | `"workspaces": ["apps/*"]` | `"workspaces": ["targets/*"]` | The same migration flips the entry (every other entry is preserved), and heals it on its own for a folder you renamed by hand. Run `npm install` at the brand root afterwards so npm re-links `node_modules/<app>` at the new path |
| Paths in YOUR files | `apps/website/...` in the brand's own scripts, CI workflows, editor config, READMEs, `.env` comments | `targets/website/...` | By hand — the migration moves the folder, never your text. `npx omega manage` rewrites the workflow templates it owns; anything you authored is yours to grep |
| This monorepo's brand folder | `apps/sandbox-brand`, `apps/omega-playground`, `apps/newsflash-brand` | `brands/<same>` | Monorepo-internal — nothing for a consumer brand to do |
| CI base-path helper ([#455](https://github.com/Omega-JS-Stack/omega/issues/455)) | `require('@omega.js/web/deploy').appPathPrefix()` — called by name from the scaffolded `.github/workflows/build.yml` | `targetPathPrefix()` — same signature, same behavior | A brand whose workflow still calls the old name re-scaffolds it (`npx omega manage` rewrites the workflows it owns) at its migration session; no alias exists |
| Config merge-layer word ([#455](https://github.com/Omega-JS-Stack/omega/issues/455)) | The per-target-dir layer was the **app layer**: docs said `… ← app shared ← app targets.<type>`, `loadConfig()`/`composeTargetConfig()` returned `files.app`, and `resolveEnvChain()` returned `{ app, brand, company }` | The **local layer** — `… ← local shared ← local targets.<type>`, `files.local`, `{ local, brand, company }` | Nothing in an authored `omega.json5` changes (the layer is positional — no `app:` key ever existed). Code reading `files.app` or `chain.app` renames the key; no alias exists |

## Deliberate compatibility that REMAINS

Old forms the new system still speaks ON PURPOSE, because a party outside this
ecosystem still sends them. They are NOT accommodations to clean up: each one
retires when its named condition is met, and never unilaterally.

| Compatibility | Who still speaks it | Retirement condition |
|---|---|---|
| The `/backend-manager/*` URL alias — the backend router's prefix strip and its Cloudflare edge-worker twin (`packages/manager/src/services/edge/workers/omega-api-proxy.js`) | In-the-wild clients of migrated brands: shipped apps, third-party integrations, and pages still calling the old path | Every known caller moved to `/omega/*` and the alias shows no traffic |
| `backendManagerKey` sent in outbound request bodies (`process.env.OMEGA_ADMIN_KEY` under the OLD field name) | Legacy-BEM parent deployments, the Ghostii API, and ITW's `wrapper` Cloud Function — all still reading that field | Each upstream migrates to the new stack and accepts the `omega-admin-key` header; fix per upstream, never unilaterally |
| The Ghostii flat-article response fallback | api.ghostii.ai, whose production backend runs legacy BEM and can return the flat field shape | Ghostii returns only the structured shape |
| The `gatherings/online` sign-out leg | Old somiibo / electron-manager desktop clients that still write that RTDB path | Those app versions are out of circulation |
| `legacyProductIds` / `legacyPlanIds` matching in the PayPal and Chargebee providers | Currently-billing subscribers on plan/product IDs created before the current catalog | The last subscription on a legacy ID ends or is migrated |
| The legacy desktop deep-link param translation in web core auth (`?destination=&source=app&signout=&cb=` → `authReturnUrl` / `authSignout`, chained through `/token`) | Shipped legacy desktop apps whose auth links are baked into installed binaries | Those app versions are out of circulation |
| Fixed legacy download filenames in the desktop mirror-downloads task (`Somiibo.dmg`, `Somiibo-Setup.exe`, `somiibo_amd64.deb`) | Every published download link and site pointing at the stable, version-less filename | No published link depends on the stable filename |
