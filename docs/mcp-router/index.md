# @omega.js/mcp-router

The one MCP endpoint an omega session pays for. A single stdio MCP server that proxies many upstream MCP servers, serves their tool schemas from a disk cache, and spawns an upstream's child process only when a tool call actually needs it.

**Published package, latched private** until the publish proving checkpoint ([docs/shared/publishing.md](../shared/publishing.md)). Provenance: the engine graduated from a personal dotfiles checkout ([#75](https://github.com/Omega-JS-Stack/omega/issues/75)) and was depersonalized on the way in — no absolute paths in a config, bare `npx`/`node` commands, `OMEGA_*` env names. A bare `node`/`npm`/`npx` is resolved at spawn time to the absolute binary beside the router's own node (`process.execPath`); PATH is only the fallback when no sibling exists.

## Why a router at all

An MCP client loads every declared server eagerly: each one's full tool schema enters the context window before the session does anything, and each one's process starts whether or not it is used. Four browser-shaped servers is a four-figure token bill per session, paid up front, mostly for tools nobody calls.

The router collapses that to one declaration:

- **Tool lists come from a cache.** Each upstream's schemas live in its `config.json`, so listing tools costs no processes.
- **Children are lazy.** Nothing spawns until a `<upstream>__<tool>` call arrives; concurrent cold calls share ONE in-flight spawn, and a cold spawn is bounded by a deadline (30s) so a child that never finishes the handshake fails that one call instead of wedging the upstream for the session. `router__refresh_upstream`'s one-shot spawn runs on the same deadline, on the connect AND on the tools/list read after it (so a stalled read fails on the router's budget instead of the SDK's 60s default), and terminates its child on any failure. `omega-mcp refresh` runs that one-shot through the SAME helper, so both refresh surfaces carry the same deadlines and the same cleanup rather than two copies that drift.
- **Visibility is per session.** `on-demand` upstreams stay out of the tool list until a session enables them, and a session's enable/disable never touches disk.

## Architecture

```
client ──stdio──> router ──┬──> chrome-devtools           (npx chrome-devtools-mcp, isolated)
                           ├──> chrome-devtools-electron  (npx chrome-devtools-mcp, attaches to $OMEGA_CDP_PORT)
                           ├──> chrome-devtools-extension (node src/launch-cft.js)
                           ├──> omega-extension           (node src/launch-omega-extension.js)
                           └──> …your overlay upstreams
```

| File | Concern |
|---|---|
| [src/router.js](../../packages/mcp-router/src/router.js) | The MCP server: the layered registry at startup, per-session state, lazy spawn + dedup, the idle sweep, the meta-tools, `<upstream>__<tool>` dispatch, SIGKILL grace on shutdown |
| [src/cli.js](../../packages/mcp-router/src/cli.js) | `omega-mcp` — list/enable/disable/add/remove/refresh, all writing the overlay |
| [src/lib/oneshot.js](../../packages/mcp-router/src/lib/oneshot.js) | The connect deadline every spawn runs under, and the one-shot spawn-connect-list-close both refresh surfaces share, plus the `MCP_ROUTER_SPAWN_TIMEOUT_MS` seam |
| [src/lib/kill-tree.js](../../packages/mcp-router/src/lib/kill-tree.js) | The `pgrep -P` walk and the deepest-first signal — what makes stopping a child stop everything the child started |
| [src/lib/registry.js](../../packages/mcp-router/src/lib/registry.js) | The layered registry: bundled + overlay, the shallow merge, the overlay-only write path |
| [src/lib/env.js](../../packages/mcp-router/src/lib/env.js) | `.env` loading, `${NAME}` / `${NAME:-default}` interpolation including the reserved `${MCP_ROUTER_ROOT}`, and the bare `node`/`npm`/`npx` bin resolution every spawn shape goes through |
| [src/lib/paths.js](../../packages/mcp-router/src/lib/paths.js) | Where the layers are, plus the two `MCP_ROUTER_*` env seams |
| [src/launch-cft.js](../../packages/mcp-router/src/launch-cft.js) | Finds the newest Chrome for Testing in puppeteer's cache (platform-aware) and execs the MCP server against it |
| [src/launch-omega-extension.js](../../packages/mcp-router/src/launch-omega-extension.js) | Resolves `@omega.js/manager` from its main export and runs its `extension/mcp-server/index.js` |

Everything the router says goes to **stderr** — stdout is the MCP wire.

## An upstream's lifecycle

A child exists only while it is earning its keep ([#779](https://github.com/Omega-JS-Stack/omega/issues/779)).

- **It starts on a call**, never at startup — the lazy spawn above.
- **It is closed once it goes quiet.** An unref'd sweep closes any upstream whose child is spawned, has no call in flight, and has not been called for **15 minutes** (`MCP_ROUTER_IDLE_MS` is the seam, and the sweep cadence is a quarter of the limit, floored at a second, so shrinking one shrinks both). A call IN FLIGHT is never closed under: a long tool call looks idle by the clock the whole time it runs, so an in-flight counter, not the clock, is what protects it. The upstream stays ACTIVE for the session — the next call spawns a fresh child through the unchanged lazy path, and `router__list_upstreams` carries the `pid` and `idle_ms` that show which state it is in. Before this, a child lived until the router got a signal: a session left open for a day held its browser open for the day, at 2.5 cores.
- **Closing takes the whole tree.** The transport pid is often only the ROOT of one (`npx` starts npm, which starts the real server, which starts a browser), and closing it reparents everything below to init, where nothing can find it again. So the WHOLE tree under the child is captured BEFORE the close (`descendantPids`, deepest first) — one level would not do it, since the middle of a tree exits with its root and takes the browser below it out of every walk — and after the 2s grace each captured pid still alive is signalled, along with a root that outlived its close. The grace is a fire-and-forget unref'd timer for the sweep and for `router__disable_upstream`; on the way out it is AWAITED (`killUpstream(name, { wait: true })`), because session end is the everyday close and an exit that beat its own grace left the browser running.
- **A call landing mid-close gets a fresh child, not an error.** The session slot is emptied when a close STARTS: a close runs for seconds against a child that will not go politely, and a call arriving in that window would otherwise be handed the closing client and fail for a close it never asked about.
- **The router goes when the host goes, and takes the trees with it.** SIGINT and SIGTERM close every upstream, wait the one grace out (they run concurrently) and exit; so does the server closing (`server.onclose`, the SDK's own seam), which an EOF on stdin now brings about — a host that exits without signalling used to leave the router and every child of it running, held open by the children's own handles.
- **That shutdown runs ONCE, whoever asks.** A host tears down by ending stdin, then SIGTERM a moment later, then SIGKILL: the signal lands mid-shutdown, and a second run would find the slots already emptied, await nothing, and exit over the top of the graces still to fire. The promise is memoized, so every trigger joins the run already going.
- **And it cannot outstay its welcome.** A 6s ceiling is armed before the closes are awaited, so a close that never settles cannot hold the router past the host's own SIGKILL window — where the exit stops being the router's to make.

## Meta-tools

| Tool | What it does |
|---|---|
| `router__list_upstreams` | Every upstream with `enabled_on_disk`, `default`, `locked`, `active_this_session`, `spawned`, `pid`, `idle_ms` (both null when no child is running), `tool_count`, `last_error` |
| `router__enable_upstream {name, env?}` | Activate for this session. `env` values are per-session vars for the child; passing them restarts a running child. Re-reads the LAYERED disk state first, so an `omega-mcp enable` from the shell lands without a router restart. A `locked` upstream is refused, with no override from inside a chat |
| `router__disable_upstream {name}` | Deactivate and stop the child. Disk untouched, env override cleared |
| `router__refresh_upstream {name}` | Spawn once, re-read the tool list, cache it **to the overlay**. Re-reads the LAYERED disk state first, so a command or args edited mid-session is what gets spawned. The one-shot spawn carries the same deadline as a cold spawn, on the connect and on the tools/list read after it, through the same helper `omega-mcp refresh` runs; any failure terminates the child before the error comes back and lands in `last_error`, which the next successful refresh clears |

A tool-list-changed notification follows each of them, so the client re-lists.

## Bundled upstreams

| Name | Command | Default | Notes |
|---|---|---|---|
| `chrome-devtools` | `npx -y chrome-devtools-mcp@1.4.0 --isolated --acceptInsecureCerts --usage-statistics=false` | auto | The session's private Chrome, throwaway profile |
| `chrome-devtools-electron` | `npx -y chrome-devtools-mcp@1.4.0 --browserUrl=http://127.0.0.1:${OMEGA_CDP_PORT:-9222} --usage-statistics=false` | auto | Attaches to a running omega desktop dev app. No shell: the router expands the `${NAME:-default}` itself, so the command still goes through bin resolution |
| `chrome-devtools-extension` | `node ${MCP_ROUTER_ROOT}/src/launch-cft.js` | on-demand | Chrome for Testing + the unpacked extension at `$OMEGA_EXTENSION_PATH`; 34 tools, hence on-demand |
| `omega-extension` | `node ${MCP_ROUTER_ROOT}/src/launch-omega-extension.js` | auto | The manager's extension automation server |

Each ships with its tool schemas cached, so a fresh install lists tools without spawning anything.

`launch-cft.js` replaces a mac-arm64-only shell glob with a real lookup over `~/.cache/puppeteer/chrome/`: it knows each platform's shape (`chrome-mac-arm64`/`chrome-mac-x64` → `*.app/Contents/MacOS/*`, `chrome-linux64/chrome`, `chrome-win64/chrome.exe`), picks the highest version numerically, and fails loudly with the `npx puppeteer browsers install chrome` hint rather than falling back to the user's own Chrome.

## Config layering

Bundled defaults inside the package, then the user's overlay at `~/.omega/mcp-router/servers/<name>/config.json`. The merge is **shallow, field-level, overlay-wins**:

- `{"enabled": false}` alone turns a bundled default off and keeps everything else.
- A partial entry re-points one field (`args`, `command`, `default`, `tools`).
- A full entry under a new name adds a private upstream.

**Every write lands in the overlay** — the CLI's enable/disable/add/remove/refresh and the router's `router__refresh_upstream` alike. The bundled dir is inside `node_modules` for a consumer, and nothing edits `node_modules`. `omega-mcp remove` on a bundled-only name refuses and points at `disable`; on a name that has both layers it drops your overrides and the default returns.

### Locking an upstream off

`{"locked": true}` in an overlay entry refuses the enable flip wherever it happens: `omega-mcp enable <name>` exits non-zero naming the field, `router__enable_upstream` returns the same refusal to the chat, and `omega-mcp add` over that name refuses as it does over any existing entry (it would write `enabled: true`). The one override is `omega-mcp enable <name> --force`, deliberately a shell-only escape hatch: a chat cannot force a locked upstream awake. The lock survives the forced flip, so the next enable refuses again.

Locking guards WAKING, not turning off: `omega-mcp disable` and `omega-mcp remove` stay open on a locked entry, and a schema `refresh` never touches `enabled`. `omega-mcp list` marks a locked upstream `[locked]` and `router__list_upstreams` carries `locked` per row.

Secrets live in `~/.omega/mcp-router/.env` and reach a command as `${NAME}`. `${NAME:-default}` runs the same lookups and takes the literal default when they all miss, which is how an upstream carries an optional value without a shell wrapper; other shell forms (`${VAR:+…}`) pass through untouched. `${MCP_ROUTER_ROOT}` is reserved for the package root and resolves before any lookup.

Four seams exist for tests and power users: `MCP_ROUTER_SERVERS_DIR` (overlay servers dir), `MCP_ROUTER_ENV_FILE` (the `.env`), `MCP_ROUTER_SPAWN_TIMEOUT_MS` (the spawn deadline, cold spawns and refresh alike, default 30000), and `MCP_ROUTER_IDLE_MS` (the idle-close limit, which the sweep cadence follows, default 900000).

## Where the router comes from

The router always launches from the engine beside the PLUGIN the session loaded — never from whatever project the session's cwd happens to sit in. A user-level plugin install (the common case: every session on the machine gets it, in any directory, omega project or not) means one engine for everything. A brand that enables the plugin from its own `node_modules/@omega.js/manager` ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)) launches the router the launcher resolves from THAT install — the plugin and its router move together within manager's dependency range (the router is a normal published dependency, deliberately not vendored). Each session spawns its own router process from that one engine, reads the bundled defaults beside it, layers the user's `~/.omega/mcp-router/` overlay on top, and serves the merged list to that session alone. Even the `omega-extension` upstream resolves the manager package from where the router sits — never from whatever project is the current directory.

## Plugin wiring

The omega Claude plugin declares **exactly one** MCP server, in [agent-plugins/claude/.mcp.json](../../agent-plugins/claude/.mcp.json):

```json
{ "mcpServers": { "mcp-router": { "type": "stdio", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is substituted by Claude Code with the plugin's own directory, so the entry never addresses anything outside the plugin — which is what lets the declaration ship in the vendored copy inside `@omega.js/manager` ([#144](https://github.com/Omega-JS-Stack/omega/issues/144)). [mcp-router-launch.js](../../agent-plugins/claude/mcp-router-launch.js) is the whole indirection: it `require.resolve`s `@omega.js/mcp-router/bin/mcp-router.js` with `paths: [__dirname]`, so ONE launcher is correct in both eras — node resolution from the monorepo plugin dir finds this workspace copy, and from a brand's `node_modules/@omega.js/manager/claude-plugin/` it finds the installed router wherever npm hoisted it (the manager depends on it, which is why the router joined the publish set). The package declares no `exports` map, so that bin stays resolvable by subpath. Pinned by [test/plugin-launch.test.js](../../packages/mcp-router/test/plugin-launch.test.js).

A marketplace clone arrives without node_modules, so the router's bin self-bootstraps: when its dependencies do not resolve, it runs one `npm install` in its own package root before starting (stderr-only — stdout is the MCP wire), and every later launch is a silent no-op. Nobody installing the plugin runs an install step, and a dev editing the checkout sees changes on the next session start with no publish.

There are no other native MCP declarations anywhere in the plugin — anything else a user wants is an overlay entry. The usage pattern (session-owned Chrome, the safety rule about never quitting Chrome by app name, the electron and extension upstreams) is the plugin's `omega:browser` skill, [agent-plugins/claude/skills/browser/SKILL.md](../../agent-plugins/claude/skills/browser/SKILL.md).

## Tests

`npm test` in [packages/mcp-router](../../packages/mcp-router) (node:test): registry layering, env interpolation, both launchers against fixture caches and injected spawn seams, the CLI against fixture layer dirs (with a real fixture MCP server behind `refresh`), a bundled-config sanity pass, the plugin-launch pins (one declared server, launched from inside the plugin, and the launcher resolving this package's bin from the plugin dir), a router e2e that connects the real SDK client to a real router process over stdio against the REAL bundled defaults plus a fixture overlay, a spawn-deadline e2e that calls a fixture upstream which never finishes the handshake (its deadline shrunk through `MCP_ROUTER_SPAWN_TIMEOUT_MS`) and proves the next call spawns a fresh child, a refresh-deadline e2e that drives the same fixture through `router__refresh_upstream` and proves the one-shot child is gone when the error comes back, a refresh-cleanup e2e whose fixture handshakes and then fails the tools/list read, proving the child is terminated, the failure lands in `last_error`, and a later successful refresh clears it, a refresh-timeout e2e whose fixture handshakes and then stalls on that read, proving the refresh answers on the router's budget rather than the SDK's default, an idle-close e2e that watches a fixture child go away on its own under a shrunk `MCP_ROUTER_IDLE_MS`, answer the next call from a NEW pid, and survive a sweep that runs while a call is in flight, a kill-tree pass over each depth of the tree kill (the helper against a real shell-built tree, a fixture upstream whose orphaned grandchild has to be gone once `router__disable_upstream` has answered, and a two-deep fixture whose middle level dies with the root, leaving a leaf only a whole-tree capture ever named), a host-gone e2e that drives the router over a raw stdio pipe — the SDK client's own close would kill it and prove nothing — ends its stdin and proves the router exits with its child, that child's grandchild and a two-deep fixture's leaf all gone, then repeats the host's real teardown (EOF, SIGTERM a second later) to prove the signal joins the shutdown already running instead of exiting over its graces, and a unit pass on the shared one-shot helper (fake client/transport pairs: the success path closes once, either failure closes the transport before rethrowing, and the read is handed the router's budget). No upstream child is ever started by the suite except the fixture servers.

## Noted gaps

- **`npx -y @omega.js/mcp-router` does not resolve from the public registry yet.** The package is latched private with the rest of the publishables, which is why the plugin's `.mcp.json` launches through `${CLAUDE_PLUGIN_ROOT}` and node resolution instead of npx (an npx entry 404s from any project cwd — Omega-JS-Stack/omega#77). Whether the entry ever moves to npx is a call for the publish checkpoint ([docs/shared/publishing.md](../shared/publishing.md)) — node resolution already works in both eras, so nothing forces the move.
- **The `omega-extension` launcher needs the manager's `extension/` tree on disk.** Covered in every checkout: `require.resolve` finds an installed manager, and when there is none the launcher falls back to the sibling `packages/manager` in this monorepo, passing this package's node_modules via `NODE_PATH` so the server's imports (the MCP SDK, `ws`) resolve without a manager install. Whether the published manager tarball carries `extension/` stays a packaging decision gated with the publish checkpoint; a tree missing the server still fails loudly, naming the file it expected.
