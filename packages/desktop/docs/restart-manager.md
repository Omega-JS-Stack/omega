# Restart Manager

@omegajs/desktop apps don't restart themselves after a crash — they delegate to **Restart Manager** (RM), a hidden guardian app that sits outside the host app's process tree, so it can wait, observe, and re-launch cleanly through edge cases that are impossible to handle from inside your own dying process (crashed-then-relaunch, post-update install, hidden-mode rehydrate, etc.).

**Protocol v2 rewrite** — the legacy `restart-manager://message?command=register&payload=<json>` deep-link handshake is GONE (it was fire-and-forget with no ack, and RM polled process NAMES). RM now serves a loopback HTTP protocol and monitors exact PIDs. The RM app itself is an @omegajs/desktop consumer at `restart-manager/restart-manager-desktop` and is the serving side of everything below.

## Protocol v1 — the SSOT

The contract ships IN THIS FRAMEWORK as `lib/restart-manager/protocol.js`, exported for the RM app via the sanctioned deep require:

```js
require('@omegajs/desktop/lib/restart-manager/protocol')
```

Both sides import the same file — contract constants are never copied between repos. Bump `PROTOCOL_VERSION` (currently 1) on any breaking change.

### The shared root

Neutral ground, deliberately NOT any app's userData (@omegajs/desktop's dev/test userData suffixing never moves it): `resolveSharedRoot(appDataPath, env)` → `env.EM_RM_ROOT || <appData>/restart-manager/`.

```
<appData>/restart-manager/
├── runtime.json      ← RM advertises { protocolVersion, port, pid, version, environment, startedAt }
│                       atomically while its server is listening; removed on graceful quit.
│                       The pid inside is the liveness truth check — stale files are harmless.
├── app/              ← the installed RM app on mac (Restart Manager.app) / linux
│                       (Restart-Manager.AppImage) — owned by THIS lib. Windows installs via
│                       silent NSIS instead: the exe lives at %LOCALAPPDATA%\Programs\
│                       Restart Manager\Restart Manager.exe (getInstalledAppPath resolves all
│                       three) — NSIS is what lets RM self-update via electron-updater.
└── install.lock      ← advisory lock ({ pid, hostAppId, acquiredAt }, stale after 10 min) so two
                        @omegajs/desktop apps can't run installers concurrently
```

`EM_RM_ROOT` is the cross-repo test/dev isolation seam. In @omegajs/desktop's own test mode the lib roots at `<userData>/restart-manager` (the ` (Testing)` dir, wiped per run) — tests never touch the real root.

### HTTP endpoints (RM serves; 127.0.0.1 bind + peer check; no bearer — same-user threat model)

| Endpoint | Semantics |
|---|---|
| `GET /v1/health` | `{ ok, version, protocolVersion, uptime, apps }` — `apps` is a COUNT |
| `POST /v1/register` | `{ protocolVersion, id, name, pid, path, version, environment }` → `{ ok }` — idempotent upsert by `id` |
| `POST /v1/deregister` | `{ id, pid }` → `{ ok }` — deregister always wins; idempotent |
| `GET /v1/apps` | full records + derived status (RM's dashboard shares this) |

There is deliberately no quit endpoint — RM updates itself (below); nothing external ever needs to stop it.

## Lifecycle (what this lib does)

1. **Boot** (step 12e): after `whenReady` + 15s (3s dev), `register()` runs the full flow — probe (`runtime.json` → pid alive via `process.kill(pid, 0)` (EPERM = alive) → `GET /v1/health` with protocolVersion match) → if RM isn't serving: `ensureInstalled()` + `ensureRunning()` (spawn detached, poll up to 15s) → `POST /v1/register` with **this process's pid**. Attempt budget: 3 per invocation. Never throws; failures land in `getStatus().lastError`.
2. **Heartbeat**: re-POST register every 60s (idempotent upsert on RM's side). Doubles as the keep-alive — a failed tick runs the full `register()` flow, which respawns (or reinstalls, cooldown-gated) RM.
3. **Graceful quit**: the first `before-quit` is prevented once, deregister flushes with a hard 1s cap, then `manager.quit({ force: true })` re-quits (all framework before-quit listeners are double-fire safe — main.js `_isQuitting`, appState sentinel, usage stamp). Exception: when the auto-updater has a staged install (`_allowQuit` + status `downloaded`) we never intercept `quitAndInstall` — deregister goes fire-and-forget and RM's grace window covers the race. RM-side safety net: a crash only counts after 2 consecutive dead ticks (~20s), so a slightly-late deregister always wins.
4. **Crash**: the pid dies with the registration still present → RM relaunches the app from its registered exe path (mac: `open` on the derived bundle). Never in dev — RM refuses to relaunch `environment !== 'production'` registrations (a dev exe path is the bare electron binary). Crash loops back off (3 relaunches / 10 min → RM gives up, visible in its dashboard).

## Silent install (smart existence first)

`ensureInstalled()` short-circuits on `app/<platform entry>` existing — repeat boots cost one stat, zero network. When missing:

1. Fetch the release feed `https://github.com/<owner>/<repo>/releases/latest/download/<latest-mac.yml | latest.yml | latest-linux.yml>` (js-yaml). Default feed: **`restart-manager/update-server`** — RM publishes through @omegajs/desktop's standard release pipeline, so the feed files + versioned artifacts are the normal ones.
2. Pick the artifact — mac: `-<arch>-mac.zip` → `-universal-mac.zip` → `-mac.zip` (RM ships universal); win: the NSIS setup `.exe`; linux: the `.AppImage`. Artifact URLs are `releases/latest/download/<encodeURIComponent(name)>`.
3. Download (atomic `.part` + rename, 5-hop redirect follow) → install per platform (mac/linux extract into `app.tmp/` then swap into `app/`; win runs the installer).

| Platform | Install | UX |
| --- | --- | --- |
| **mac** | zip → `app/Restart Manager.app`, spawned via `open` | Silent. Signed + notarized zip; no DMG mount, no /Volumes flash, no prompts. |
| **windows** | NSIS one-click run with `/S` → `%LOCALAPPDATA%\Programs\Restart Manager\` | Silent. No installer window, no admin, per-user — and NSIS is what makes RM self-updatable by electron-updater. |
| **linux** | AppImage → `app/Restart-Manager.AppImage` + chmod 755 | Silent. No .deb, no sudo. (AppImage needs FUSE; failure surfaces as a spawn-poll timeout in the log.) |

Failures set a 1-hour install cooldown (no download storms); the advisory `install.lock` serializes concurrent installers across @omegajs/desktop apps.

## Updates — RM updates ITSELF (@omegajs/desktop's standard autoUpdater)

This lib only ever **installs** RM when missing. Once running, RM keeps itself fresh exactly like every other @omegajs/desktop app — `autoUpdate.enabled: true`, standard electron-updater flow (NSIS on win, zip-in-place on mac, AppImage on linux), applying on the user-idle install policy with the 30d force gate. No bespoke update logic anywhere.

The update relaunch is safe by construction: RM's registrations are **storage-persisted** (its boot prune keeps live-pid entries), watched apps' 60s heartbeats reconnect through the freshly written runtime.json, and @omegajs/desktop's single-instance lock quits any duplicate spawned during the handover window.

## Bail conditions

- **`manager.isTesting()`** — nothing fires on its own: no timers, no before-quit hook (a preventDefault would wedge the harness quit), and the root is isolated under the testing userData. Tests drive `register()`/`ensureInstalled()` explicitly against fixture servers; the network and spawn paths stay dead (`ensureInstalled` refuses network without `TEST_EXTENDED_MODE`, `ensureRunning` never spawns in testing).
- `manager.config.brand.id === 'restart-manager'` — RM doesn't manage itself.
- `config.restartManager.enabled === false` — explicit opt-out.
- Non-production without `EM_RESTART_MANAGER_DEV=1` — dev noise guard.

## Config

```json5
restartManager: {
  enabled: true,
  // feed: { owner: 'restart-manager', repo: 'update-server' },  // fork/mirror override
  // feed: { url: 'https://mirror.example.com/rm' },             // full base-URL override (air-gapped)
},
```

Existing consumers with the old `{ enabled: true }` shape need zero changes.

## API

```js
manager.restartManager.register()          // full ensure-installed→ensure-running→POST flow; never throws
manager.restartManager.unregister()        // best-effort deregister (stops the heartbeat)
manager.restartManager.ensureInstalled()   // smart-existence install; true when present
manager.restartManager.ensureRunning()     // probe → spawn → poll; true when serving
manager.restartManager.getStatus()         // { enabled, bailed, bailReason, root, installed,
                                           //   installedVersion, running, registered, port,
                                           //   pid, lastHeartbeatAt, lastError }
```

## Threat model

Loopback bind + per-request peer-address check on RM's side; no bearer auth because the callers are same-user local processes with no secret worth protecting (a malicious same-user process can already spawn/kill apps directly). Cross-user access is blocked by the OS. Every payload goes through the protocol validators on both sides.

**Dev and prod share one root per user** (by design — a dev RM must be findable by `EM_RESTART_MANAGER_DEV=1` consumers). The lib logs the connected RM's version + environment on first probe. Quitting a dev RM deletes runtime.json under production apps; their 60s heartbeat respawns the installed RM — self-healing.

## Why a separate helper?

You can `app.relaunch() + app.quit()` from inside the app and it works for the common case. But:

- **Crash recovery**: a crashed process cannot relaunch itself, full stop. RM watches the pid from outside.
- **Post-update install on macOS**: `electron-updater`'s `quitAndInstall` copy fails if the old app isn't fully exited; an outside observer relaunches only once the pid is truly gone.
- **Hidden-mode rehydrate**: self-relaunch can't change `LSUIElement`-style launch modes mid-flight; an external spawner can.

## Dev workflow (end-to-end loop)

```bash
# 1. Run RM from source (writes the REAL shared root on purpose)
cd restart-manager-desktop && npx mgr install dev && npm start
cat ~/Library/Application\ Support/restart-manager/runtime.json

# 2. Any @omegajs/desktop consumer registers against it
EM_RESTART_MANAGER_DEV=1 npm start          # registers ~3s after ready (dev delay)
curl 127.0.0.1:<port>/v1/apps               # the consumer listed, status alive

# 3. Graceful quit → the entry disappears (≤1s flush), NO relaunch
# 4. kill -9 <pid> → RM relaunches it within ~2 ticks (~20s)
# 5. open "restart-manager://app/show" → RM's dashboard (@omegajs/desktop built-in route)
```

Terminal-smoke gotcha: a leaked `ELECTRON_RUN_AS_NODE=1` makes any packaged Electron binary exit instantly as plain node — `env -u ELECTRON_RUN_AS_NODE <binary>` first.

## Source

- Lib: [`src/lib/restart-manager/`](../src/lib/restart-manager/) — `index.js` (singleton), `protocol.js` (the SSOT), `install.js` (feed/download/extract/lock)
- Tests: [`src/test/suites/main/restart-manager.test.js`](../src/test/suites/main/restart-manager.test.js) (+ build suites `restart-manager-protocol` / `restart-manager-install`, boot suite `restart-manager`)
- The RM app: <https://github.com/restart-manager/restart-manager-desktop>
