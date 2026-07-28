# @omega.js/mcp-router

The one MCP endpoint an omega session pays for. A single stdio MCP server that proxies many upstream MCP servers, serves their tool schemas from a disk cache, and spawns an upstream's child process only when a tool call actually needs it.

**Published package, latched private** until the publish proving checkpoint ([docs/shared/publishing.md](../shared/publishing.md)). Provenance: the engine graduated from a personal dotfiles checkout ([#75](https://github.com/Omega-JS-Stack/omega/issues/75)) and was depersonalized on the way in — no absolute paths, `npx`/`node` from PATH, `OMEGA_*` env names.

## Why a router at all

An MCP client loads every declared server eagerly: each one's full tool schema enters the context window before the session does anything, and each one's process starts whether or not it is used. Four browser-shaped servers is a four-figure token bill per session, paid up front, mostly for tools nobody calls.

The router collapses that to one declaration:

- **Tool lists come from a cache.** Each upstream's schemas live in its `config.json`, so listing tools costs no processes.
- **Children are lazy.** Nothing spawns until a `<upstream>__<tool>` call arrives; concurrent cold calls share ONE in-flight spawn.
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
| [src/router.js](../../packages/mcp-router/src/router.js) | The MCP server: the layered registry at startup, per-session state, lazy spawn + dedup, the meta-tools, `<upstream>__<tool>` dispatch, SIGKILL grace on shutdown |
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
| `router__list_upstreams` | Every upstream with `enabled_on_disk`, `default`, `active_this_session`, `spawned`, `tool_count`, `last_error` |
| `router__enable_upstream {name, env?}` | Activate for this session. `env` values are per-session vars for the child; passing them restarts a running child. Re-reads the LAYERED disk state first, so an `omega-mcp enable` from the shell lands without a router restart |
| `router__disable_upstream {name}` | Deactivate and stop the child. Disk untouched, env override cleared |
| `router__refresh_upstream {name}` | Spawn once, re-read the tool list, cache it **to the overlay** |

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

Secrets live in `~/.omega/mcp-router/.env` and reach a command as `${NAME}`. Only that strict form is substituted; `${VAR:-default}` and `${VAR:+…}` pass through for a shell to expand. `${MCP_ROUTER_ROOT}` is reserved for the package root and resolves before any lookup.

Two seams exist for tests and power users: `MCP_ROUTER_SERVERS_DIR` (overlay servers dir) and `MCP_ROUTER_ENV_FILE` (the `.env`).

## Plugin wiring

The omega Claude plugin declares **exactly one** MCP server, in [agent-plugins/claude/.mcp.json](../../agent-plugins/claude/.mcp.json):

```json
{ "mcpServers": { "mcp-router": { "type": "stdio", "command": "npx", "args": ["-y", "@omega.js/mcp-router"] } } }
```

There are no other native MCP declarations anywhere in the plugin — anything else a user wants is an overlay entry. The usage pattern (session-owned Chrome, the safety rule about never quitting Chrome by app name, the electron and extension upstreams) is the plugin's `omega:browser` skill, [agent-plugins/claude/skills/browser/SKILL.md](../../agent-plugins/claude/skills/browser/SKILL.md).

## Tests

`npm test` in [packages/mcp-router](../../packages/mcp-router) (node:test): registry layering, env interpolation, both launchers against fixture caches and injected spawn seams, the CLI against fixture layer dirs (with a real fixture MCP server behind `refresh`), a bundled-config sanity pass, and a router e2e that connects the real SDK client to a real router process over stdio against the REAL bundled defaults plus a fixture overlay. No upstream child is ever started by the suite except the fixture server.

## Noted gaps

- **`npx -y @omega.js/mcp-router` does not resolve from the public registry yet.** The package is latched private with the rest of the publishables, so in the local era the plugin's `.mcp.json` resolves it from the workspace/local link. It starts working off the registry when the publish checkpoint unlatches ([docs/shared/publishing.md](../shared/publishing.md)).
- **The `omega-extension` launcher needs the manager's `extension/` tree on disk.** True in the local era, where `node_modules/@omega.js/manager` symlinks into this monorepo. Whether the published manager tarball carries `extension/` is a packaging decision gated with the publish checkpoint; until then the upstream fails loudly, naming the file it expected.
