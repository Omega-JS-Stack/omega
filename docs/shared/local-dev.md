# Local dev loop (master plan §8)

How to work on the frameworks and see edits live in consumers — one repo, one window, one command. The mechanics live in **`@omega.js/devkit/local`** (`packages/devkit/src/local.js`), the single home for monorepo resolution, brand/app detection, file:-linking, and the watch lock.

## Root watch: `npm start`

`npm start` at the monorepo root runs `scripts/watch-all.js`, which starts every package's `prepare:watch` (src→dist rebuild-on-change) **concurrently**, with per-package output prefixes:

```
Watching 4 packages (src→dist): backend, client, desktop, extension
[client   ] [02:25:05] 'prepare-package': Ready for changes!
```

- **Discovery, not hardcoding**: any `packages/*` with a `prepare:watch` script is watched. Packages without one (`account`, `config`, `devkit`, `manager`, `template-kit`, `web`) serve `src/` directly — file:-linked consumers see those edits live with no watch at all.
- **Vendor propagation**: a per-package `prepare:watch` only sees its OWN src, but the vendorable shared packages (`devkit`, `config`, `account`) also live as copies inside every framework's `dist/vendor/*`. The orchestrator watches those srcs too (`startVendorPropagation`) and re-runs `npm run prepare` in every watchable package on change — debounced, coalescing, one failure never stops the pass. Without it, a devkit edit strands dist-running frameworks on stale vendored code until a manual rebuild (the cp184 `http://localhost:5002` no-redirect bug). Running processes still need a restart to load the fresh dist, same as any src edit.
- **Single-instance**: the orchestrator takes `.omega/dev-watch.lock` (pid inside). A second `npm start` — or an `omega dev --local` session — sees the live lock and exits cleanly instead of double-watching. Stale locks (dead pid) are swept automatically.
- **Shutdown**: SIGINT/SIGTERM kills every watch child and releases the lock. A watch child dying on its own is announced loudly; the others stay up.

## Brand-root one command: `omega dev` (web + backend together)

At a **brand root** (the dir with `config/omega.json5`), every framework's `omega` bin dispatches to `@omega.js/manager` — whose `dev` command boots the whole local stack at once (`npm run dev` is the packaged form):

```
omega dev                      # website dev server + backend FULL emulator suite
omega dev --only web           # one leg
omega dev --except backend     # default set minus
omega dev --all                # every target with a dev leg (desktop/extension opt-in)
```

- **Default set = `web` + `backend`** — the local web loop. GUI/watcher targets (desktop opens an Electron window; extension runs a build watcher) never boot unless named via `--only`/`--all`. The default also adapts: a web-only brand boots just web, no warning.
- **Legs**: web → the app's `npm start` (`omega dev`, :4000); backend → `npm run emulator` (auth/firestore/functions/database/hosting + seeded personas). Backend boots first so its port map is published before web reads it (N7 makes the order optional — web falls back to the classic ports).
- **Multi-instance web ports offset deterministically**: each instance wants the classic base + its position in the `targets.web` instances array (apps/website → :4000, apps/website-admin → :4001), so instances dev side-by-side from their own app dirs; the N7 allocator still bumps if the offset port happens to be taken, and pins (`--port` / config `ports.website`) win verbatim. Single-object brands stay on :4000 exactly as before.
- **Per-app Node**: each leg spawns under its app's own `.nvmrc` major (web and backend pin different ones).
- Output is line-prefixed per target (`[backend] …`, `[web] …`); one Ctrl-C stops everything; a leg dying alone is announced and its siblings stay up.

## One-command consumer sessions: `omega dev --local`

In a brand's website app, `omega dev --local` runs the full local-mode prelude before the normal dev server:

1. **Resolve the monorepo** — `OMEGA_MONOREPO` env override → self-location (works whenever the running framework is linked from the monorepo, or the consumer lives inside it) → `~/Developer/Repositories/Omega/omega`.
2. **Find the brand root** — walk up from cwd to the first directory with both a `package.json` and `apps/<name>/package.json` (the Omega monorepo itself never counts); standalone apps resolve to themselves.
3. **Link brand-wide** — for every app (brand root + `apps/*`), every `@omega.js/*` dependency in the ONE app-root manifest (src/dist pillar — a backend's `functions/` is staged output and carries no authored manifest) is flipped to a `file:` spec and installed. **Idempotent**: deps already resolving to the monorepo copy are skipped (resolution walks up node_modules, so npm-workspace hoisting is handled), and an already-correct committed `file:` spec is never rewritten. **Transactional**: an install failure restores every flipped manifest to its pre-link spec.
4. **Start the monorepo watch** — spawned as a session-scoped child (dies with the dev server; the lock prevents doubles). Watch output streams into the dev log under a `[watch]` prefix.

Then the standard `omega dev` loop runs. Result: edit any framework's `src/` and the consumer picks it up live — no N windows, no N × `mgr i local`.

**Upstream-first (Ian 2026-07-27).** The live link is not just a convenience — it is how framework holes get found and fixed. Building a real consumer app regularly exposes gaps in OMEGA; when a defect or missing piece would hit EVERY consumer (a broken core style, a wrong default, a missing option), fix it in the framework right here through the link, not in the consumer project — a consumer-side patch has to be rediscovered and repeated in the next project. The test: would the next consumer need the same change? Then it belongs upstream. Brand-specific looks, content, and one-off behavior stay in the brand. The same rule ships to brand sessions in the brand guide (`docs/manager/brand.md`).

**Permission first (Ian 2026-07-27).** Upstream-first says WHERE a fix belongs, never that a consumer session may make it unprompted. A session working in a consumer project that finds a framework-level hole SURFACES the proposed framework change — what is broken, what it would change, why every consumer needs it — and WAITS for Ian's go before touching the monorepo (or files it as an issue when Ian is not in the loop). No consumer session edits the framework silently as a side effect of its own task.

## Per-app linking: `mgr i local`

Unchanged contract for consumers, now monorepo-backed: `mgr i local` (web, desktop, extension — web gained its install command in cp194) and `mgr i local` / `mgr install --local` (backend) call the same `linkLocalPackages()`. Backend links its app-root manifest like every other target (`functions/` is staged output; the CLI normalizes a `functions/` cwd up to the app root). `mgr i live/prod` still installs from the registry and is untouched.

**Linking is brand-tree-wide by construction (cp194):** npm resolves the WHOLE workspace tree on any install anchored in a brand monorepo, so linking one app while a sibling still carries an unpublished registry spec (`@omega.js/backend: *`) 404s before anything links — only reachable in a brand OUTSIDE the omega monorepo, the real consumer topology. `linkLocalPackages()` therefore flips every app's `@omega.js/*` specs to `file:` first (dev/prod placement preserved; specs computed from REAL paths so symlinked/aliased dirs can't dangle), then runs ONE `npm install` for the tree. One call from any app links the whole brand; reruns all-skip.

**The brand root itself is part of the tree (cp195):** onboard scaffolds `@omega.js/manager` into the brand root's devDependencies — the omega-bin dispatcher resolves brand-level verbs (`omega dev`, manage, the scaffolded `start` script) FROM the brand root, and without the declaration nothing installs the manager outside the monorepo (inside it, workspace hoisting masked the gap). `linkLocalPackages()` links it like any app dep (`discoverApps` already includes the brand root).

**Outside brands may COMMIT relative `file:` specs — the real brand does (cp229):** `../omega-brand` (folder renamed from omegajs.dev, cp235) declares every `@omega.js/*` dep as `file:../../../omega/packages/<name>` (brand root: `file:../omega/packages/manager`), the same pattern the in-repo brands already use at their own depth. Clone the two repos side by side and a plain `npm install` links the whole tree with zero linker involvement; `linkLocalPackages()` all-skips because the specs already resolve into the monorepo. At first publish the specs flip to `^0.1.0` registry ranges (versions re-reset to 0.1.0 at cp238 — 0.x until live publishes are proven — so the flip stays seamless).

## Vendoring vs runtime deps (what ships where)

Two different mechanisms keep consumers working:

| Kind | Packages | Mechanism |
|------|----------|-----------|
| Private shared internals | `devkit`, `config`, `account`, `template-kit` (devDependencies of the frameworks) | Vendored into `dist/vendor/<pkg>` at prepare time by `@omega.js/devkit/vendor`; requires rewritten to relative paths. Never published. |
| Published runtime deps | `@omega.js/client` (dependency of web + desktop + extension), `@omega.js/backend` (dependency of manager) | Normal npm dependency — **never vendored** (a vendored copy would pin a stale snapshot and duplicate the shared client singleton). Requires stay as package requires. |

The vendor tool derives the split from the host's package.json: anything in `dependencies`/`peerDependencies`/`optionalDependencies` is published-runtime and skipped; devDependency workspace packages get vendored. ALL SIX publishables (backend, client, desktop, extension, manager, web) are dist-building with the vendor after-hook. Two mirrored gates prove self-containment: CI's pack-smoke and the local `npm run release:check` — both pack, scratch-install with tarball `overrides` for the published runtime deps, resolve, and grep the whole shipped tree for raw private `@omega.js/(devkit|config|account|template-kit)` refs. The publish runbook lives in [docs/shared/publishing.md](publishing.md).

## API surface (`@omega.js/devkit/local`)

| Export | Purpose |
|--------|---------|
| `resolveMonorepoRoot()` | env → self-location walk-up → conventional path; throws with guidance if none |
| `findBrandRoot(dir)` / `discoverApps(root)` | brand-root walk-up / brand root + `apps/*` list |
| `frameworkPackagesOf(appDir)` | `@omega.js/*` deps incl. `functions/package.json`, with dev/prod placement + owning dir |
| `linkLocalPackages({ dir, monorepoRoot, logger, dryRun })` | idempotent brand-tree file:-link (spec flip + one install, transactional — a failed install restores every manifest); returns `[{ name, dir, target, action: link\|skip\|missing }]` across the tree |
| `restoreRegistrySpecs({ dir, logger, dryRun, range })` | the publish-day INVERSE (`omega i live` in every framework): every `file:` spec flips to `^<linked version>` (read from the file: target — no monorepo needed) or the explicit `range`, then one registry install; same transactional restore on failure |
| `startMonorepoWatch({ monorepoRoot, logger })` | lock-aware spawn of the root watch; `{ alreadyRunning, pid, child }` |
| `startVendorPropagation({ packagesDir, packages, dependents, runPrepare?, log?, debounceMs? })` | watch vendorable srcs → re-prepare dependents (debounced, coalescing); `{ watched, poke, close }` — `poke` is the fs-free test seam |
| `acquireWatchLock` / `releaseWatchLock` / `readLiveWatchPid` | the `.omega/dev-watch.lock` single-instance protocol (owned by watch-all) |

## Freshness guard (cp247)

Every framework CLI boot (web/backend/desktop/extension/manager — `freshnessBoot` in devkit `local.js`, wired in each `cli-run`) checks whether a locally-linked framework's `dist/` is stale: newest `src/` mtime vs `dist/` (missing dist = stale), plus each embedded `dist/vendor/<name>` vs that private package's `src/`. Fresh = silent (2–16ms). Stale = loud auto `npm run prepare` in the package, then the invocation RE-EXECS once (`OMEGA_FRESH_REEXEC` loop guard) so no verb ever runs stale framework code. A live root-watch lock defers to the watch (dim note). Registry installs (realpath inside node_modules) and non-buildable dirs skip instantly. `OMEGA_SKIP_FRESHNESS` is the opt-out seam. Pinned by devkit `test/local-freshness.test.js` (14 tests incl. a linked-consumer integration proof).
