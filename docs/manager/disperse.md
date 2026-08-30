# The disperse service — signing artifacts into the targets

The `disperse` service is what remains of legacy omega-manager's disperse after the config
hierarchy dissolved file dispersal: targets read `config/omega.json5` directly, so there is no
`.brands/` mirror and no per-repo config writes. What cannot ride the hierarchy is exactly
what this service still moves — binary signing artifacts.

It runs on the DELIVERY lane (`BOOT_SERVICES`): every `omega dev` boot, every brand-root
`omega deploy`, and the full manage walk — after `certificates` (the artifacts must exist) and
before `update` (builds read the cert files).

## What it delivers

One operation, `certs`: the certificates service's signing tree —
`{companyRoot||brandRoot}/.omega/certificates/apple/` — copied into each desktop/mobile
target's certs dir. The copy itself is devkit's (`@omega.js/devkit/certs`,
[#678](https://github.com/Omega-JS-Stack/omega/issues/678)), the ONE delivery step every verb
rides, so a desktop build reaches the same artifacts through the same rules. What lives here is
the manage-lane framing: which targets get a pass, the config gate, and the per-rule reporting.

Optional rules skip silently when their source is missing; REQUIRED rules warn (the build
would be unsigned) and the operation returns warned with the count. A brand with no Apple
artifacts at all — certificates disabled, or never run — is a quiet note, not a warning.

A miss is WARN-ONLY — the delivery never deletes, which is why certs is NOT one of the
reconcile surfaces (those are [assets](assets.md) and [workspace](workspace.md)). Every dest is
a documented HUMAN drop point (desktop's [signing guide](../../packages/desktop/docs/signing.md)
tells an operator to `cp` their `.p12`/`.p8` straight into `config/certs/`), and
`omega company init` scaffolds `.omega/certificates/apple/` EMPTY — which passes the tree guard
above. A delete-on-missing pass would therefore eat hand-placed signing material on the very
next build, so a dest with no source in the tree is reported and left exactly where the
operator put it.

## Config

- `certificates.enabled: false` (or `certificates: false`) — nothing to disperse.
- The target set is every dir mapping to a framework with a cert file map (desktop, mobile).

## Gotcha: no machine composes a target `.env`

`.env` composition is GONE ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)). The
brand-root `.env` is the ONE file humans and the manager edit, and every verb composes its
target's runtime env from the cascade by schema. A CUSTOM target has no `@omega.js/config` to
walk the cascade for it, so it INHERITS instead: `manage.js` loads the env chain into
`process.env` before it spawns anything, which is why a custom target started by `omega dev`
or `omega deploy` has the brand keys and a standalone run inside the target dir does not.
