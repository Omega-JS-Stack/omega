# N7 — Port auto-allocation (design)

> Status: **cp88 SHIPPED (foundation + backend)** — config ports module + full backend adoption; live proof: two emulators (sandbox brand + backend fixture) ran CONCURRENTLY, B bumped (functions 5001→5003 skipping A's hosting on 5002, hosting 5002→5004 skipping B's own just-claimed 5003 — the claimed-set at work), both HTTP 200, A alive throughout, clean shutdown cleared both ports files + the resolved config. Bonus proof: A itself bumped firestore/database/pubsub around stale e2e orphans — the allocator absorbs crash leftovers. Next: cp89 (web/client/sandbox), cp90 (desktop/extension/stragglers). Spec source: core-changes inbox N7 (decided, binding): "default ports, bump when taken, brand-level port map that every url getter (getApiUrl/getWebsiteUrl/…) reads → multiple brands in dev simultaneously without conflicts; also fixes BEM's hardcoded 5001/5002 (parked 1.2a)."

## The problem (survey verdict)

- `mgr setup` writes the SAME `DEFAULT_EMULATOR_PORTS` (auth 9099, functions 5001, firestore 8080, database 9000, hosting 5002, storage 9199, pubsub 8085, ui 4050) into every brand's firebase.json (`emulator-config.js:62-74`); every URL getter hardcodes the same numbers (backend `index.js:253/265/277`, client `index.js:460/461/524/541`, desktop `url-helpers.js:24/35/56`). Two brands cannot run dev stacks concurrently.
- Today's "conflict handling" is `checkAndKillBlockingProcesses` — it KILLS the incumbent (brand B's boot kills brand A's emulator). The devkit e2e harness just throws. Nothing bumps.
- Intra-brand bug: `omega dev`'s Eleventy default is **8080** (`web/src/commands/dev.js:38`) — collides with the firestore emulator of the SAME brand, and disagrees with the 4000-website convention every getter + the extension manifest assume.
- Divergences to reconcile: desktop `getApiUrl` uses http 5002 while backend/client use https 5002 (mkcert proxy, `OMEGA_HTTPS_PORT`); `loadEmulatorPorts` exists in triplicate (emulator.js/test.js/firebase-init.js); manager google-auth pins loopback 9876; desktop OAuth already does it right (`listen(0)`).

## Allocation model (decided)

**Literal reading of the spec: classic defaults, probe at boot, bump per-port (+1 steps, shared claimed-set) only when taken.**

- **Single-brand dev is byte-identical to today**: when the classic defaults are free (99% case), no bumping, no temp files, no behavior change.
- **The backend emulator boot is the allocator** (it owns the port family): `mgr emulator`/`mgr serve`/`mgr test` resolve the map (probe each wanted port; busy → +1 until free, skipping ports already claimed this run), then:
  - defaults free → spawn exactly as today (committed firebase.json untouched, no resolved artifacts);
  - bumped → materialize `<projectDir>/firebase.resolved.json` (full firebase.json with only `emulators.*.port` patched; same directory so relative paths keep working) and spawn `firebase emulators:start --config firebase.resolved.json`; gitignored.
- **The resolved map is published two ways**:
  1. `<projectDir>/.temp/ports.json` — `{ ports, pid, startedAt }`; deleted on clean shutdown; readers (same brand's `omega dev`, harness, stripe-forward) fall back to classic defaults when absent/stale (pid dead).
  2. `OMEGA_<NAME>_PORT` env vars injected into children the CLI spawns (extends the proven `OMEGA_HTTPS_PORT` / `OMEGA_LIVERELOAD_PORT` / `OMEGA_CDP_PORT` pattern): `OMEGA_AUTH_PORT`, `OMEGA_FIRESTORE_PORT`, `OMEGA_FUNCTIONS_PORT`, `OMEGA_HOSTING_PORT`, `OMEGA_WEBSITE_PORT`, `OMEGA_LIVERELOAD_PORT`, `OMEGA_CDP_PORT`.
- **URL getters read the map, never literals**: precedence = explicit env (`OMEGA_*_PORT`) → brand ports file (Node-side) → classic default. Browser code (client SDK, site JS) can read neither env nor files — `omega dev` injects **`dev.ports`** into the config object it already injects (`environment: 'development'` chrome); client falls back to classic defaults when absent (plain static hosting of a dev build).
- **Explicit overrides**: new SHARED `ports` section in the config schema (all optional numbers). Set → that port is pinned (no bump; busy = hard error naming the pin). Unset → auto. Per-target overrides ride the existing `targets.<type>` cascade for free.
- **Livereload + CDP**: same allocator, per-target — desktop and extension serve each probe `35729`+ and claim distinct ports (fixes the two-targets-one-brand collision), CDP probes `9222`+ (replaces the "try +1 manually" warning).

## Slices

- **cp88 (SHIPPED)** — foundation + the BEM fix: `@omega.js/config` `ports` module (`CLASSIC_PORTS`, `resolvePorts` probe/bump/claim, ports-file + env helpers) + schema `ports` section + 12 tests. Backend adopted: the 3 `loadEmulatorPorts` copies collapsed into `emulator-config.js`, emulator/test boot through the allocator (resolved-config `--config` spawn when bumped; ports file + `OMEGA_*_PORT` env published; cleared on close), getters read env→classic, orphan sweep now takes THIS run's resolved map (sweeping defaults after a bumped run would kill the incumbent — the exact bug class N7 removes; shared hub/storage ports swept only on defaults runs), `mgr setup` keeps writing classic defaults (allocation is boot-time). Scope notes: `mgr serve`'s mkcert proxy + stripe-forward target stay classic-port (cp90 stragglers — serve's public 5002 is load-bearing for the client's hardcoded getter until cp89/90). Gates MET: config 83 (12 new), backend parse-audit 416 + self-test 6/6, corpus 1224/44/0, e2e 19/19, live two-emulator proof (see status line).
- **cp89** — web + client + sandbox: `omega dev` default port 8080 → website convention **4000** (fixes the intra-brand firestore collision; best-implementation-wins), reads the brand ports file to bump when taken; injects `dev.ports` through the chrome; client emulator-connect + `getApiUrl`/`getFunctionsUrl` read `config.dev.ports`; sandbox `main.js`/`__omega.api` + devkit harness read the resolved map (harness free-check → allocator).
- **cp90** — desktop + extension + stragglers: livereload per-target allocation, CDP probe+bump, desktop `getApiUrl` https-divergence reconciled to the backend/client behavior, manager google-auth loopback → `listen(0)` (the auth-flow.js pattern), extension manifest 4000 documented as build-time (packaged artifacts keep fixed ports by design — bake the resolved website port at build).

## Non-goals

- No central port registry / company-level allocation state — probing at boot is the source of truth.
- No production surface changes — this is a dev/emulator concern only; production URLs never touch the map.
- Packaged extension/desktop artifacts keep build-time-baked ports (a shipped extension can't probe).
