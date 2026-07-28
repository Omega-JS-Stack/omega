# @omega.js/mcp-router

One MCP endpoint for a whole session, and it stays cheap.

An MCP client that declares five servers pays for five: every one is launched, every one's full tool schema sits in the context window from the first token. The router flips that around. It is a single stdio MCP server that proxies many **upstream** servers: tool schemas come from a cache on disk, upstream processes are spawned **lazily** on the first tool call that actually needs one, and a session turns upstreams on and off for itself without touching disk or restarting anything.

Tools surface to the client as `<upstream>__<tool>` — inside Claude Code that reads `mcp__mcp-router__chrome-devtools__click`.

The omega Claude plugin launches the router straight from the monorepo checkout it ships in, and on a bare clone the bin installs its own dependencies on first launch — no install step for a user, no publish for a dev editing the checkout.

## What ships with it

Four defaults, ready on install day:

| Upstream | What it does | Default |
|---|---|---|
| `chrome-devtools` | A private, isolated, throwaway-profile Chrome per session | auto |
| `chrome-devtools-electron` | Attaches to an already-running omega desktop dev app on `$OMEGA_CDP_PORT` | auto |
| `chrome-devtools-extension` | Chrome for Testing with the unpacked extension at `$OMEGA_EXTENSION_PATH` pre-loaded | on-demand |
| `omega-extension` | The extension automation server inside `@omega.js/manager` | auto |

An `on-demand` upstream stays invisible until a session asks for it — that is how a noisy 34-tool server costs nothing until it is wanted.

## The meta-tools (per session, from inside the client)

- `router__list_upstreams` — every upstream, its on-disk enabled state, whether it is active in this session, and its cached tool count.
- `router__enable_upstream {name, env?}` — activate for THIS session. `env` sets vars on the child (passing it restarts a running child so they take effect).
- `router__disable_upstream {name}` — deactivate and stop the child. Disk is untouched.
- `router__refresh_upstream {name}` — spawn once, re-read the tool list, and cache it.

## Config layering

Two layers, and only one of them is ever written:

1. **Bundled defaults** — `servers/<name>/config.json` inside this package. Read-only: for a consumer they live in `node_modules`.
2. **Your overlay** — `~/.omega/mcp-router/servers/<name>/config.json`, plus `~/.omega/mcp-router/.env` for secrets.

The merge is **shallow and field-level**: an overlay entry's top-level keys win over the bundled entry's, and everything else survives.

```jsonc
// ~/.omega/mcp-router/servers/chrome-devtools/config.json
{ "enabled": false }                 // turns the bundled default off, keeps its command + tools cache
```
```jsonc
// ~/.omega/mcp-router/servers/playwright/config.json
{ "enabled": true, "default": "on-demand", "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--isolated"] }
```

A name that only exists in the overlay is simply a private upstream of yours. Nothing you do forks the defaults, and an upgrade of this package never clobbers your overrides.

## The CLI

`omega-mcp` manages the registry. Every command reads the merged view and writes the overlay.

```bash
omega-mcp list                              # every upstream, its source (bundled / yours), state, tool count
omega-mcp enable chrome-devtools-extension  # writes {"enabled": true} to your overlay, then caches the schema
omega-mcp disable chrome-devtools           # writes {"enabled": false}
omega-mcp add my-server npx -y my-mcp@latest
omega-mcp remove my-server                  # a bundled default cannot be removed — disable it instead
omega-mcp refresh chrome-devtools           # re-fetch and cache the tool schemas
```

Registering the router with a client is not this CLI's job: the omega Claude plugin declares it once, in its `.mcp.json`.

## Environment

| Variable | What it does |
|---|---|
| `OMEGA_CDP_PORT` | The port `chrome-devtools-electron` attaches to (default `9222`) |
| `OMEGA_EXTENSION_PATH` | The unpacked extension directory `chrome-devtools-extension` loads |
| `MCP_ROUTER_SERVERS_DIR` | Overrides the overlay servers dir (tests, power users) |
| `MCP_ROUTER_ENV_FILE` | Overrides the overlay `.env` path |

### Placeholders

An upstream's `command`, `args`, and `env` may carry `${NAME}` placeholders, resolved from `~/.omega/mcp-router/.env` first and then the environment — so a token lives in the `.env`, never in a config file. **Only the strict `${NAME}` form is substituted**: shell forms like `${VAR:-default}` inside an `sh -c` string pass through untouched for the shell to expand at spawn time.

One name is reserved: **`${MCP_ROUTER_ROOT}`** always resolves to this package's root directory, before any `.env` or environment lookup. It is how a bundled upstream points at a launcher script the package ships with, wherever the package is installed.

## Docs

The full guide — architecture, the launchers, the plugin wiring, the noted gaps — is [docs/mcp-router/index.md](../../docs/mcp-router/index.md) in the OMEGA monorepo.
