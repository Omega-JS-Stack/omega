# The disperse service: registered, with no operations today

The `disperse` service is what remains of legacy omega-manager's disperse. Everything it once
moved now has a better home, and as of [#891](https://github.com/Omega-JS-Stack/omega/issues/891)
it moves nothing at all:

- **config dispersal** dissolved into the hierarchy: targets read `config/omega.json5` directly,
  so there is no `.brands/` mirror and no per-repo config writes.
- **`.env` composition** dissolved into the delivery step every verb runs
  ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)): the brand-root `.env` is the ONE
  file humans and the manager edit, and each verb composes its target's runtime env from the
  cascade by schema. No machine writes a target `.env`.
- **signing artifacts**, its last operation, are READ IN PLACE. The signing tree
  (`<company or brand root>/.omega/certificates/apple/`, company tier first) is where the
  certificates walk writes them and where every reader reads them, and the paths into it derive
  ONCE at the desktop env load (`@omega.js/devkit/signing-env`). Copying them into each target's
  `config/certs/` meant two homes for one fact, and the dispersed duplicate is what a build could
  silently sign with after the tree had moved on. The whole delivery layer went with the
  operation: devkit's `deliverCerts()`, its rule table, and desktop's `deliver-certs.js`.

## Why it is still here

Ian's call, 2026-09-12: "keep as a service that does nothing currently", "keep it in case we need
to use it for something legit". It stays registered on both lanes (`SERVICE_ORDER` and
`BOOT_SERVICES` in `packages/manager/src/config.js`) with an empty operation list, so it is the
named home for the next thing that genuinely cannot ride the config hierarchy. A walk through it
prints one line, `⊘ no operations`, and returns success.

## Where signing material lives now

- The tree, its two tiers and the write side: [certificates](certificates.md) and
  `@omega.js/devkit/signing-tree`.
- The derivation every desktop reader shares, and what `validate-certs` judges:
  [the desktop guide's signing section](../desktop/index.md).
- What a deploy pushes to a runner, and the ladder that refuses to ship unsigned:
  [docs/shared/deploys.md](../shared/deploys.md).
