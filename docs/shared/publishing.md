# Publishing — the runbook

> The publish-proving checkpoint's script, run for real on 2026-09-09: the seven
> publishables are on the registry ([#25](https://github.com/Omega-JS-Stack/omega/issues/25)) at 0.50.0, the
> monorepo's own number (0.1.0 went out first that night and is deprecated: the family
> carries ONE version, the root package.json's, by ruling 2026-09-10),
> each with `publishConfig.access: public`, and published is the new normal. The unlatch
> step below is history; versions move by changesets from here.

## What publishes, what never does

| Publishes (seven) | Never publishes (vendored at prepare, six) |
|---|---|
| `@omega.js/backend`, `@omega.js/client`, `@omega.js/desktop`, `@omega.js/extension`, `@omega.js/manager`, `@omega.js/mcp-router`, `@omega.js/web` | `@omega.js/devkit`, `@omega.js/config`, `@omega.js/account`, `@omega.js/template-kit`, `@omega.js/analytics`, `@omega.js/monitoring` |

The private six are `VENDORABLE_PACKAGES` in [packages/devkit/tools/vendor.js](../../packages/devkit/tools/vendor.js),
which is the SSOT: the vendor tool throws on a dist reference to any `@omega.js`
package not on that list, so read the count from there rather than from this page.

`@omega.js/mcp-router` joined the set (Ian 2026-07-30, [#144](https://github.com/Omega-JS-Stack/omega/issues/144)):
the manager's vendored Claude plugin declares the router, so the router has to be
installable beside it — a real dependency, never vendored. It ships no docs tree
(it is not in the vendor lane's `DOCUMENTED_PACKAGES`) and no `exports` map, so the
plugin's launcher can deep-resolve `@omega.js/mcp-router/bin/mcp-router.js`.

Registry-real internal ranges (everything else is workspace `*`): `@omega.js/client`
in backend/web/desktop/extension; `@omega.js/backend` and `@omega.js/mcp-router` in
manager — the EXACT family version (0.50.0 today), not carets, because the family is
lockstep (below).

## Lockstep — the family ships ONE version ([#794](https://github.com/Omega-JS-Stack/omega/issues/794))

Changesets carries the seven publishables as a single `fixed` group
(`.changeset/config.json`; `scripts/changeset-config.test.js` holds that group
and `release-check.js`'s `PUBLISHABLES` in parity, and release-check itself
prints a `one version across the family` check). A bump on any one bumps all
seven to the same number, and packages with no code change republish anyway.

Why, in two sentences: ONE number for the family means a brand can never
install a backend from one release beside a client from another — "everything
is 0.5.x" is the whole compatibility contract, readable by a human and
checkable in one comparison. The private internals are VENDORED copies inside
each framework, so a config-schema change already forces every framework to
republish; independent numbers only hid that, and let one omega.json5 be
validated by two validators.

`updateInternalDependencies` stays `patch`, so the exact ranges above move
with the group on every release. In a brand, the same number lands as an exact
PIN per target ([updates.md](updates.md)) and the manager's boot check refuses
a brand that ever drifts ([../manager/brand.md](../manager/brand.md)).

## What prepare vendors into a tarball

Every publishable's prepare `after` hook runs the devkit vendor lane, which
ships two payloads: the private packages' MODULES into `dist/vendor/`
(`tools/vendor.js`), and the DOCS into the package root (`tools/vendor-docs.js`
— the package's guide as `docs/index.md` plus `docs/shared/`, and for
`@omega.js/manager` also the repo-root map as `docs/AGENTS.md` (links
retargeted) and `claude-plugin/` + `.claude-plugin/marketplace.json`, the
plugin a consumer brand enables from its node_modules, `.mcp.json` included —
its launcher resolves `@omega.js/mcp-router` from the install
([#144](https://github.com/Omega-JS-Stack/omega/issues/144))). All of it is
generated and gitignored; `node --test scripts/vendor-docs.test.js` packs the
six documented packages for real and asserts the tarball listings. A vendor
failure ABORTS the prepare: every publishable sets `preparePackage.hooks.afterBlocking: true`
(prepare-package 2.2.0, [#38](https://github.com/Omega-JS-Stack/omega/issues/38)),
so a tarball can never build missing its vendored internals. Contract:
[agent-docs.md](agent-docs.md).

The MODULE payload is closed over itself ([#739](https://github.com/Omega-JS-Stack/omega/issues/739)): a vendored file's own cross-package requires are rewritten to the sibling vendored copy, and any vendorable only a vendored file needs is vendored too, so the raw-private-reference grep below reads `dist/vendor/` as strictly as the rest of the tree.

## The license check ([#320](https://github.com/Omega-JS-Stack/omega/issues/320))

A published install needs a LICENSE to enable the payment system and remove the omega
attribution. A license is a subscription bought on omegajs.dev and the key is that
account's API key — `OMEGA_LICENSE_KEY` in the brand `.env`, never in omega.json5
(secret-shape rule). One key per ACCOUNT, unlimited brands for now.

**When it runs**: at DEPLOY time, per target, once — `resolveLicenseVerdict({ config, env, transport })`
in [`@omega.js/devkit/license`](../../packages/devkit/src/license.js). Each target's
deploy asks and bakes the answer into that artifact; runtime never phones home and the
payment call stays pure, so a cancelled key holds until the next deploy (accepted — a
boot or periodic re-check is additive later).

| Verdict | When | `payments` | `attribution` |
|---|---|---|---|
| licensed | the key resolves an omegajs.dev account whose subscription plan is not the reserved `basic` free sentinel | `live` | `removed` |
| keyless | no key, an empty key, a `demo-*` project, or a key whose account has no active subscription | `gated` | `shown` |

**Loud failure**: a key IS present but the server is unreachable, answers non-2xx, or
resolves no account → the resolver THROWS. A typo'd or dead key must never quietly ship a
gated artifact for a brand that is paying.

**The keyless-dev carve-out**: a `demo-*` (emulator-only) project short-circuits before
the network call, key present or not — local dev and the test brands run keyless forever,
payments in test mode, attribution shown.

**The wire**: `GET https://api.omegajs.dev/omega/user?apiKey=<key>&brandId=<brand.id>`.
The host is a CONSTANT, not config: every other api base in OMEGA derives from a brand's
own `brand.url` (`api.<host>`) because it belongs to that brand, and this one is the
PRODUCT's license server — the same host for every brand that installs OMEGA. Server side
it is the ordinary `GET /user` route resolving an API key (`users` where
`api.privateKey ==` it), and the plan comes from `@omega.js/account`'s
`resolveSubscription`, the same derivation the backend and the client run. `brandId` rides
along and the server ignores it today, so a future per-key brand limit is a server-side
change alone. `transport` is the injected fetch, so the tests run fully offline.

**Delivery**: the env schema declares `OMEGA_LICENSE_KEY` as `ci` for web, desktop and
extension — their deploys build on Actions runners, so the check runs where the build runs
— and declares NOTHING for the backend, which deploys straight from the CLI and reads the
key out of the `.env` cascade in its own process. It never bakes: a baked license key is a
license key anyone who unpacks the app can copy.

**What each target does with the verdict**: the resolver's answer becomes ONE stamp —
`resolveLicenseStamp({ config, production })` in the same module, which returns
`{ status: 'licensed'|'keyless', payments, attribution }` and short-circuits to the keyless
stamp for any build that is not a production one (so a dev build, a watch and a test never
phone home).

| Target | Where the check runs | What the artifact carries | What changes |
|---|---|---|---|
| web | `omega build` (the production build — on the runner for a deploy, locally for a local one) | `site.license`, a build fact beside `site.pricing`/`site.brandTokens` | the footer's "Powered by omegajs.dev" block renders only while `site.license.attribution == 'shown'` (themes/base `_includes/frontend/sections/footer.html`) |
| backend | `omega deploy`, before the stage — the CLI reads the key from the .env cascade in its own process | `OMEGA_LICENSE_STATUS` in the composed `dist/.env` (the one COMPUTED key there; the KEY itself never rides the upload) | `libraries/payment/license.js` refuses Stripe/PayPal/Chargebee `init()` on `keyless`. The `test` provider is never gated, and an ABSENT status — every local lane, the emulator, a test — behaves exactly as before |
| desktop | the bundle task, production builds only | `OMEGA_BUILD_JSON.license` (outside `config`, the blob the renderer hands @omega.js/client) | nothing at runtime: the artifact records what it was packaged as. Neither target has an attribution surface today, and their payments ride the backend's gate |
| extension | the bundle task, production builds only (once per build — the one snapshot every browser target then copies) | `OMEGA_BUILD_JSON.license`, baked into every bundle, likewise outside `config` | as desktop |

**Honesty system** (spec call 6): plain readable checks, no obfuscation and no artifact
signing. The legal backing is the Elastic License 2.0 below, whose terms forbid
circumventing license-key functionality and removing notices.

## Pre-flight (any day, no GO needed)

1. `npm run release:check` — packs all seven through their real prepare (vendoring
   included), scratch-installs each tarball with local-tarball overrides, resolves,
   and greps the shipped trees for raw private references. **Must be 7/7 green.**
   This is the laptop mirror of CI's pack-smoke.
2. Full battery green: root `npm test` (packages → corpus → sandbox e2e → journey).
3. npm auth sanity: `npm whoami` (expected `itwcw2000`). Known parked mystery: `npm org ls omega.js`
   403s on the empty org — the first real publish is the definitive test. If IT 403s,
   the org-owning account must grant publish rights for the `@omega.js` scope.
4. **License check** ([#349](https://github.com/Omega-JS-Stack/omega/issues/349)): every
   `packages/*/package.json` reads `"license": "Elastic-2.0"`, every publishable carries a
   root `LICENSE` naming the Elastic License 2.0 (npm ships it into the tarball regardless
   of `files`), and no MIT text survives anywhere:
   `grep -rL "Elastic License 2.0" packages/*/LICENSE` must print nothing and
   `grep -ril "MIT License" packages/ --include=LICENSE*` must be empty. A tarball that
   publishes under the wrong license cannot be recalled from the registry, so this runs
   before the unlatch, not after.

## Publish day (Ian's GO)

1. **Unlatch**: remove `"private": true` from the seven publishables' package.json,
   and ONLY those seven (the six vendorable privates keep theirs forever:
   `VENDORABLE_PACKAGES` in [packages/devkit/tools/vendor.js](../../packages/devkit/tools/vendor.js)
   names them, so the list is never re-typed here).
2. **Publish** each (changesets is configured lockstep + `access: public`, so the
   seven go out at ONE number; the direct form per package is equally fine):
   `npm publish --workspace=packages/<name>` — order matters only where a dependent
   waits on a dependency: **client and backend before their dependents**
   (web/desktop/extension need client on the registry; manager needs backend and
   mcp-router). Safe order: client → backend → mcp-router → extension → desktop →
   web → manager.
3. **Verify from the outside**: in an empty temp dir, `npm install @omega.js/web`
   (and one more, e.g. manager) — install + `require.resolve` must succeed with no
   overrides. That is the moment the untested-lane risk is retired.
4. **Flip omega-brand to registry specs**: from any TARGET root (`targets/website`;
   the manager has no `i` verb), `npx omega i live` — tree-wide `file:` → the EXACT
   family pin + one registry install (`restoreRegistrySpecs` writes the linked copy's version with no
   caret, because the family is lockstep; `omega i local` is the way back for
   local-era work). Commit the brand's manifest+lock change.
5. **Brand proof**: brand `npm run manage` (manage cycle) + a website build — the brand
   now runs on registry packages; CI-dispatch web deploys become buildable (the
   deploy guard stops refusing once no `file:` specs remain).
6. Record: CHANGELOG entry + close the tracking issue; re-latch nothing — published is the
   new normal, versions move by changesets from here.

## After the first publish

- 0.x caret ranges float patch-only (npm's conservative 0.x behavior) — breaking
  changes bump minor and consumers move deliberately. A BRAND floats nothing: the
  manager pins every target exactly, so `omega update` is the one thing that moves
  a brand, and it moves the whole family ([updates.md](updates.md)).
- **1.0.0 is NEVER published without Ian's explicit word** (ruling 2026-09-10): it is the
  official release, and it waits until OMEGA has survived on its own with Ian's brands.
  Every number below it is free to publish whenever he wants.
- The publish is also the brand-CI-build unlock: no tarball vendoring exists by
  design — the registry is the lane CI installs from.
