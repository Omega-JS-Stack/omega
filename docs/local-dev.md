# Local dev loop (master plan §8)

How to work on the frameworks and see edits live in consumers — one repo, one window, one command. The mechanics live in **`@omega.js/devkit/local`** (`packages/devkit/src/local.js`), the single home for monorepo resolution, brand/app detection, file:-linking, and the watch lock.

## Root watch: `npm start`

`npm start` at the monorepo root runs `scripts/watch-all.js`, which starts every package's `prepare:watch` (src→dist rebuild-on-change) **concurrently**, with per-package output prefixes:

```
Watching 4 packages (src→dist): backend, client, desktop, extension
[client   ] [02:25:05] 'prepare-package': Ready for changes!
```

- **Discovery, not hardcoding**: any `packages/*` with a `prepare:watch` script is watched. Packages without one (`account`, `config`, `devkit`, `manager`, `template-kit`, `web`) serve `src/` directly — file:-linked consumers see those edits live with no watch at all.
- **Single-instance**: the orchestrator takes `.omega/dev-watch.lock` (pid inside). A second `npm start` — or an `omega dev --local` session — sees the live lock and exits cleanly instead of double-watching. Stale locks (dead pid) are swept automatically.
- **Shutdown**: SIGINT/SIGTERM kills every watch child and releases the lock. A watch child dying on its own is announced loudly; the others stay up.

## One-command consumer sessions: `omega dev --local`

In a brand's website app, `omega dev --local` runs the full local-mode prelude before the normal dev server:

1. **Resolve the monorepo** — `OMEGA_MONOREPO` env override → self-location (works whenever the running framework is linked from the monorepo, or the consumer lives inside it) → `~/Developer/Repositories/Omega/omega`.
2. **Find the brand root** — walk up from cwd to the first directory with both a `package.json` and `apps/<name>/package.json` (the Omega monorepo itself never counts); standalone apps resolve to themselves.
3. **Link brand-wide** — for every app (brand root + `apps/*`), every `@omega.js/*` dependency (including backend apps' `functions/package.json`) is `npm install <monorepo path>`-ed, flipping its spec to `file:` and symlinking it. **Idempotent**: deps already resolving to the monorepo copy are skipped (resolution walks up node_modules, so npm-workspace hoisting is handled).
4. **Start the monorepo watch** — spawned as a session-scoped child (dies with the dev server; the lock prevents doubles). Watch output streams into the dev log under a `[watch]` prefix.

Then the standard `omega dev` loop runs. Result: edit any framework's `src/` and the consumer picks it up live — no N windows, no N × `mgr i local`.

## Per-app linking: `mgr i local`

Unchanged contract for consumers, now monorepo-backed: `mgr i local` (desktop, extension) and `mgr i local` / `mgr install --local` (backend) call the same `linkLocalPackages()` for **that app only** — every declared `@omega.js/*` dep is linked from the monorepo, idempotently. Backend links where the dep is declared (`functions/package.json`) regardless of where `mgr` was invoked. `mgr i live/prod` still installs from the registry and is untouched.

## Vendoring vs runtime deps (what ships where)

Two different mechanisms keep consumers working:

| Kind | Packages | Mechanism |
|------|----------|-----------|
| Private shared internals | `devkit`, `config`, `account` (devDependencies of the frameworks) | Vendored into `dist/vendor/<pkg>` at prepare time by `@omega.js/devkit/vendor`; requires rewritten to relative paths. Never published. |
| Published runtime deps | `@omega.js/client` (dependency of desktop + extension) | Normal npm dependency — **never vendored** (a vendored copy would pin a stale snapshot and duplicate the shared client singleton). Requires stay as package requires. |

The vendor tool derives the split from the host's package.json: anything in `dependencies`/`peerDependencies`/`optionalDependencies` is published-runtime and skipped; devDependency workspace packages get vendored. CI's pack-smoke gate greps shipped dist for raw **private** `@omega.js/(devkit|config|account)` refs only, and maps `@omega.js/client` to its local tarball via `overrides` until it exists on npm.

## API surface (`@omega.js/devkit/local`)

| Export | Purpose |
|--------|---------|
| `resolveMonorepoRoot()` | env → self-location walk-up → conventional path; throws with guidance if none |
| `findBrandRoot(dir)` / `discoverApps(root)` | brand-root walk-up / brand root + `apps/*` list |
| `frameworkPackagesOf(appDir)` | `@omega.js/*` deps incl. `functions/package.json`, with dev/prod placement + owning dir |
| `linkLocalPackages({ dir, monorepoRoot, logger, dryRun })` | idempotent file:-install; returns `[{ name, dir, target, action: link\|skip\|missing }]` |
| `startMonorepoWatch({ monorepoRoot, logger })` | lock-aware spawn of the root watch; `{ alreadyRunning, pid, child }` |
| `acquireWatchLock` / `releaseWatchLock` / `readLiveWatchPid` | the `.omega/dev-watch.lock` single-instance protocol (owned by watch-all) |
