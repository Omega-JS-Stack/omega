# Publishing — the runbook

> The publish-proving checkpoint's script. Nothing here runs without Ian's explicit GO
> (standing rule: zero npm publishes / GitHub releases until then). The latch is
> mechanical: all six publishables carry `private: true` — npm itself refuses until
> the unlatch step below.

## What publishes, what never does

| Publishes (six) | Never publishes (vendored at prepare) |
|---|---|
| `@omega.js/backend`, `@omega.js/client`, `@omega.js/desktop`, `@omega.js/extension`, `@omega.js/manager`, `@omega.js/web` | `@omega.js/devkit`, `@omega.js/config`, `@omega.js/account`, `@omega.js/template-kit` |

Registry-real internal ranges (everything else is workspace `*`): `@omega.js/client`
`^0.1.0` in web/desktop/extension; `@omega.js/backend` `^0.1.0` in manager.

## What prepare vendors into a tarball

Every publishable's prepare `after` hook runs the devkit vendor lane, which
ships two payloads: the private packages' MODULES into `dist/vendor/`
(`tools/vendor.js`), and the DOCS into the package root (`tools/vendor-docs.js`
— the package's guide as `docs/index.md` plus `docs/shared/`, and for
`@omega.js/manager` also `claude-plugin/` + `.claude-plugin/marketplace.json`,
the plugin a consumer brand enables from its node_modules — minus the plugin's
`.mcp.json`, whose server lives outside the plugin in the monorepo's
`packages/mcp-router`, which is not in the publish set
([#144](https://github.com/Omega-JS-Stack/omega/issues/144))). All of it is
generated and gitignored; `node --test scripts/vendor-docs.test.js` packs all
six for real and asserts the tarball listings. A vendor failure ABORTS the
prepare: every publishable sets `preparePackage.hooks.afterBlocking: true`
(prepare-package 2.2.0, [#38](https://github.com/Omega-JS-Stack/omega/issues/38)),
so a tarball can never build missing its vendored internals. Contract:
[agent-docs.md](agent-docs.md).

## Pre-flight (any day, no GO needed)

1. `npm run release:check` — packs all six through their real prepare (vendoring
   included), scratch-installs each tarball with local-tarball overrides, resolves,
   and greps the shipped trees for raw private references. **Must be 6/6 green.**
   This is the laptop mirror of CI's pack-smoke.
2. Full battery green: root `npm test` (packages → corpus → sandbox e2e → journey).
3. npm auth sanity: `npm whoami` (expected `itwcw2000`). Known parked mystery: `npm org ls omega.js`
   403s on the empty org — the first real publish is the definitive test. If IT 403s,
   the org-owning account must grant publish rights for the `@omega.js` scope.

## Publish day (Ian's GO)

1. **Unlatch**: remove `"private": true` from the six publishables' package.json —
   and ONLY those six (the four privates keep theirs forever).
2. **Publish** each (changesets is configured independent + `access: public`; for the
   FIRST 0.1.0 the direct form per package is equally fine):
   `npm publish --workspace=packages/<name>` — order matters only twice: **client
   and backend before their dependents** (web/desktop/extension need client on the
   registry; manager needs backend). Safe order: client → backend → extension →
   desktop → web → manager. 2FA/OTP prompts surface here on first publish.
3. **Verify from the outside**: in an empty temp dir, `npm install @omega.js/web`
   (and one more, e.g. manager) — install + `require.resolve` must succeed with no
   overrides. That is the moment the untested-lane risk is retired.
4. **Flip omega-brand to registry specs**: from the brand root,
   `npx omega i live` — tree-wide `file:` → `^0.1.0` + one registry install
   (`restoreRegistrySpecs`; `omega i local` is the way back for local-era work).
   Commit the brand's manifest+lock change.
5. **Brand proof**: brand `npm start` (manage cycle) + a website build — the brand
   now runs on registry packages; CI-dispatch web deploys become buildable (the
   deploy guard stops refusing once no `file:` specs remain).
6. Record: CHANGELOG entry + close the tracking issue; re-latch nothing — published is the
   new normal, versions move by changesets from here.

## After the first publish

- 0.x caret ranges float patch-only (npm's conservative 0.x behavior) — breaking
  changes bump minor and consumers move deliberately.
- 1.0.0 is a later, deliberate graduation (Ian's call), not an accumulation.
- The publish is also the brand-CI-build unlock: no tarball vendoring exists by
  design — the registry is the lane CI installs from.
