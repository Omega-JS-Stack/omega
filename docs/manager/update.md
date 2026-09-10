# The update service — install and build every target

The `update` service is the install + build pass: one `npm install` at the brand root (npm
workspaces cover every target), then each target's own `npm run build`. It is the slow tail of
every walk, and it runs late — after everything that writes a target's inputs, before the
account and testing services that talk to a deployed brand.

## What it reconciles

One operation, `targets`:

- **Install** is dependency-resolution-gated for idempotency: when every target's declared
  deps already resolve through the `node_modules` climb, the install is skipped — so a second
  run is a no-op, and a brand nested inside a larger workspace never grows a stray
  `node_modules`.
- **Build** runs each target's `npm run build`. A target with no build script is recorded as
  SKIPPED, not failed (a backend's "build" is its deploy story).

The service skips entirely when no dir maps to a target.

## The incremental cache

The `update` service is incremental ([#445](https://github.com/Omega-JS-Stack/omega/issues/445)): per target it fingerprints TWO input sets, the target's own tree (a stat sweep that excludes `node_modules`, `dist`, `logs`, `.temp`, `.omega`, `.cache`, `.firebase` and log files, so a build can never dirty its own inputs) plus the merge-chain files above it: brand and company `omega.json5` and `.env`, each `.env` counted with its `.env.<environment>` overlays, whose spelling comes from @omega.js/config's `envLayerFiles` rather than a path joined here, so an overlay edit dirties the target exactly like a base-file edit ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)). The second set is the installed identity of every `@omega.js/*` dependency the target declares (an npm install contributes its version string; a local link, whose version stands still inside the monorepo, contributes the link target's version plus a sweep of its build output). Both unchanged since that target's last successful build → it is converged and skips with one line; either one fresh → the full build for that target. The pair lives in `.omega/cache/update.json` — derived data, so it sits with the brand's other caches rather than in config — and `omega manage --force` ignores it. A missing or unreadable cache is not an error: the run treats every target as fresh, builds, and rewrites the file.

Both fingerprints are stat walks — relative path, size and mtime — so no file contents are
ever read.

## Gotchas

- **A failed cache write warns and the walk continues.** A cache is an optimization, never a
  reason to fail a run.
- **A brand-config edit invalidates every target.** The merge-chain files fold into each
  target's fingerprint on purpose: a config change that left every target "converged" would
  serve stale output silently.
- **Phases beyond install/build** (bump, deploy, sync) live in the deliberate verbs, not here —
  see [deploys.md](../shared/deploys.md).
