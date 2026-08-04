# @omega.js/mcp-router

The one MCP endpoint an omega session pays for. A single stdio MCP server that proxies many upstream MCP servers, serves their tool schemas from a disk cache, and spawns an upstream's child process only when a tool call actually needs it.

**Published package, latched private** until the publish proving checkpoint ([docs/shared/publishing.md](../shared/publishing.md)). Provenance: the engine graduated from a personal dotfiles checkout ([#75](https://github.com/Omega-JS-Stack/omega/issues/75)) and was depersonalized on the way in — no absolute paths, `npx`/`node` from PATH, `OMEGA_*` env names.

## Why a router at all

An MCP client loads every declared server eagerly: each one's full tool schema enters the context window before the session does anything, and each one's process starts whether or not it is used. Four browser-shaped servers is a four-figure token bill per session, paid up front, mostly for tools nobody calls.

The router collapses that to one declaration:

- **Tool lists come from a cache.** Each upstream's schemas live in its `config.json`, so listing tools costs no processes.
- **Children are lazy.** Nothing spawns until a `<upstream>__<tool>` call arrives; concurrent cold calls share ONE in-flight spawn, and a cold spawn is bounded by a deadline (30s) so a child that never finishes the handshake fails that one call instead of wedging the upstream for the session. `router__refresh_upstream`'s one-shot spawn runs on the same deadline, and terminates its child on any failure: the connect, or the tools/list read after it.
- **Visibility is per session.** `on-demand` upstreams stay out of the tool list until a session enables them, and a session's enable/disable never touches disk.

## Architecture

```
client ──stdio──> router ──┬──> chrome-devtools           (npx chrome-devtools-mcp, isolated)
                           ├──> chrome-devtools-electron  (sh -c, attaches to $OMEGA_CDP_PORT)
                           ├──> chrome-devtools-extension (node src/launch-cft.js)
                           ├──> omega-extension           (node src/launch-omega-extension.js)
                           └──> …your overlay upstreams
```

| File | Concern |
|---|---|
| [src/router.js](../../packages/mcp-router/src/router.js) | The MCP server: the layered registry at startup, per-session state, lazy spawn + dedup + the spawn deadline, the meta-tools, `<upstream>__<tool>` dispatch, SIGKILL grace on shutdown |
| [src/cli.js](../../packages/mcp-router/src/cli.js) | `omega-mcp` — list/enable/disable/add/remove/refresh, all writing the overlay |
| [src/lib/registry.js](../../packages/mcp-router/src/lib/registry.js) | The layered registry: bundled + overlay, the shallow merge, the overlay-only write path |
| [src/lib/env.js](../../packages/mcp-router/src/lib/env.js) | `.env` loading and `${NAME}` interpolation, including the reserved `${MCP_ROUTER_ROOT}` |
| [src/lib/paths.js](../../packages/mcp-router/src/lib/paths.js) | Where the layers are, plus the two `MCP_ROUTER_*` env seams |
| [src/launch-cft.js](../../packages/mcp-router/src/launch-cft.js) | Finds the newest Chrome for Testing in puppeteer's cache (platform-aware) and execs the MCP server against it |
| [src/launch-omega-extension.js](../../packages/mcp-router/src/launch-omega-extension.js) | Resolves `@omega.js/manager` from its main export and runs its `extension/mcp-server/index.js` |

Everything the router says goes to **stderr** — stdout is the MCP wire.

## Meta-tools

| Tool | What it does |
|---|---|
| `router__list_upstreams` | Every upstream with `enabled_on_disk`, `default`, `locked`, `active_this_session`, `spawned`, `tool_count`, `last_error` |
| `router__enable_upstream {name, env?}` | Activate for this session. `env` values are per-session vars for the child; passing them restarts a running child. Re-reads the LAYERED disk state first, so an `omega-mcp enable` from the shell lands without a router restart. A `locked` upstream is refused, with no override from inside a chat |
| `router__disable_upstream {name}` | Deactivate and stop the child. Disk untouched, env override cleared |
| `router__refresh_upstream {name}` | Spawn once, re-read the tool list, cache it **to the overlay**. Re-reads the LAYERED disk state first, so a command or args edited mid-session is what gets spawned. The one-shot spawn carries the same deadline as a cold spawn; any failure (the connect, or the tools/list read after it) terminates the child before the error comes back and lands in `last_error`, which the next successful refresh clears |

A tool-list-changed notification follows each of them, so the client re-lists.

## Bundled upstreams

| Name | Command | Default | Notes |
|---|---|---|---|
| `chrome-devtools` | `npx -y chrome-devtools-mcp@1.4.0 --isolated --acceptInsecureCerts --usage-statistics=false` | auto | The session's private Chrome, throwaway profile |
| `chrome-devtools-electron` | `sh -c "exec npx … --browserUrl=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}"` | auto | Attaches to a running omega desktop dev app. The `${VAR:-default}` is the SHELL's — the router deliberately leaves it alone |
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

Secrets live in `~/.omega/mcp-router/.env` and reach a command as `${NAME}`. Only that strict form is substituted; `${VAR:-default}` and `${VAR:+…}` pass through for a shell to expand. `${MCP_ROUTER_ROOT}` is reserved for the package root and resolves before any lookup.

Three seams exist for tests and power users: `MCP_ROUTER_SERVERS_DIR` (overlay servers dir), `MCP_ROUTER_ENV_FILE` (the `.env`), and `MCP_ROUTER_SPAWN_TIMEOUT_MS` (the spawn deadline, cold spawns and refresh alike, default 30000).

## Where the router comes from

Brands and the router are two delivery channels that never touch. A brand's `npm install` puts the @omega.js packages in that brand's node_modules to run its own apps — ten brands means ten copies at ten versions, and none of them is ever consulted for the router. The router always launches from the ONE checkout the Claude plugin ships in, because the plugin is installed at the user level: every session on the machine gets it, in any directory, omega project or not. Each session spawns its own router process from that one engine, reads the bundled defaults beside it, layers the user's `~/.omega/mcp-router/` overlay on top, and serves the merged list to that session alone. Even the `omega-extension` upstream resolves the manager package from where the router sits — never from whatever project is the current directory.

## Plugin wiring

The omega Claude plugin declares **exactly one** MCP server, in [agent-plugins/claude/.mcp.json](../../agent-plugins/claude/.mcp.json):

```json
{ "mcpServers": { "mcp-router": { "type": "stdio", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/../../packages/mcp-router/bin/mcp-router.js"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is substituted by Claude Code with the plugin's own directory, so the entry launches the router straight from the checkout the plugin is installed from — no registry involved, works while the package is private.

A marketplace clone arrives without node_modules, so the router's bin self-bootstraps: when its dependencies do not resolve, it runs one `npm install` in its own package root before starting (stderr-only — stdout is the MCP wire), and every later launch is a silent no-op. Nobody installing the plugin runs an install step, and a dev editing the checkout sees changes on the next session start with no publish.

There are no other native MCP declarations anywhere in the plugin — anything else a user wants is an overlay entry. The usage pattern (session-owned Chrome, the safety rule about never quitting Chrome by app name, the electron and extension upstreams) is the plugin's `omega:browser` skill, [agent-plugins/claude/skills/browser/SKILL.md](../../agent-plugins/claude/skills/browser/SKILL.md).

## Tests

`npm test` in [packages/mcp-router](../../packages/mcp-router) (node:test): registry layering, env interpolation, both launchers against fixture caches and injected spawn seams, the CLI against fixture layer dirs (with a real fixture MCP server behind `refresh`), a bundled-config sanity pass, a router e2e that connects the real SDK client to a real router process over stdio against the REAL bundled defaults plus a fixture overlay, a spawn-deadline e2e that calls a fixture upstream which never finishes the handshake (its deadline shrunk through `MCP_ROUTER_SPAWN_TIMEOUT_MS`) and proves the next call spawns a fresh child, a refresh-deadline e2e that drives the same fixture through `router__refresh_upstream` and proves the one-shot child is gone when the error comes back, and a refresh-cleanup e2e whose fixture handshakes and then fails the tools/list read, proving the child is terminated, the failure lands in `last_error`, and a later successful refresh clears it. No upstream child is ever started by the suite except the fixture servers.

## Noted gaps

- **`npx -y @omega.js/mcp-router` does not resolve from the public registry yet.** The package is latched private with the rest of the publishables, which is why the plugin's `.mcp.json` launches from the checkout via `${CLAUDE_PLUGIN_ROOT}` instead of npx (an npx entry 404s from any project cwd — Omega-JS-Stack/omega#77). Whether the entry ever moves to npx is a call for the publish checkpoint ([docs/shared/publishing.md](../shared/publishing.md)).
- **The `omega-extension` launcher needs the manager's `extension/` tree on disk.** Covered in every checkout: `require.resolve` finds an installed manager, and when there is none the launcher falls back to the sibling `packages/manager` in this monorepo, passing this package's node_modules via `NODE_PATH` so the server's imports (the MCP SDK, `ws`) resolve without a manager install. Whether the published manager tarball carries `extension/` stays a packaging decision gated with the publish checkpoint; a tree missing the server still fails loudly, naming the file it expected.
