---
name: browser
description: Use when the user wants to open, view, screenshot, test, or debug a page in a real browser, fill or submit forms, inspect live pages, run Lighthouse, attach to a running desktop dev app, or test an unpacked extension.
user-invocable: true
---

# Browser (Chrome DevTools through the mcp-router)

Control a browser over CDP. **Your session owns a private Chrome** — it auto-launches on your first tool call, only ever shows YOUR pages, and exits when your session ends. No setup, no ports, no cleanup, and parallel sessions cannot touch each other's browsers.

## How to use

1. `new_page` with your target URL (or `navigate_page` the initial blank page).
2. Work with `click`, `fill`, `take_screenshot`, `evaluate_script`, etc.
3. That's it — open/close pages freely; the whole browser is yours.

## SAFETY

- **NEVER quit, kill, or restart Chrome by app name** (`killall "Google Chrome"`, `pkill "Google Chrome"`, osascript). The user's PERSONAL Chrome is running too — you would kill their browser. You never need to kill anything: your browser dies with your session.
- **Never launch Chrome manually.** The MCP owns the browser lifecycle.

## Diagnosing a server? Grep the logs first

A browser answers "what does this page render", not "why did the build fail" or "what did the backend serve". Every OMEGA surface already tee'd its run to disk — an app's `logs/dev.log` and `logs/build.log`, the backend's `dist/emulator.log`, a lane's `.temp/logs/<lane>.log`. Read those FIRST, and never restart a dev server, emulator or watcher to see output it already wrote. Paths and contract: `docs/shared/logging.md`.

## Ephemeral profile

The browser uses a throwaway profile — cookies/logins do NOT persist between sessions. If a task needs auth, log in during the task.

## The router: one endpoint, four upstreams

Every browser tool arrives through a single MCP server, `mcp-router` (`@omega.js/mcp-router`, declared once by this plugin). Tools are namespaced `mcp__mcp-router__<upstream>__<tool>` — so the default driver's click is `mcp__mcp-router__chrome-devtools__click`.

| Upstream | For | Needs |
|---|---|---|
| `chrome-devtools` | The default: a fresh isolated Chrome | nothing |
| `chrome-devtools-electron` | An ALREADY-RUNNING omega desktop dev app | the app started with a remote-debugging port |
| `chrome-devtools-extension` | An unpacked extension in Chrome for Testing | `OMEGA_EXTENSION_PATH` |
| `omega-extension` | The manager's own extension automation server | `@omega.js/manager` installed |

Two meta-tools control them per session, and neither touches disk:

- `router__list_upstreams` — what exists, what is enabled on disk, what is active in THIS session.
- `router__enable_upstream {name, env?}` — activate one for this session; its tools appear in your tool list. `env` sets vars on the child process (passing it restarts a running child).

An upstream marked `on-demand` stays invisible until you enable it. `router__disable_upstream` drops it and stops its child.

## Desktop apps (Electron)

This skill's default browser is always a fresh Chrome. To drive an already-running omega desktop dev app, enable `chrome-devtools-electron` — it attaches to the app's `--remote-debugging-port` at `http://127.0.0.1:$OMEGA_CDP_PORT` (default 9222). Pass a different port for the session with `router__enable_upstream {name: "chrome-devtools-electron", env: {"OMEGA_CDP_PORT": "9333"}}`.

## Browser extensions

To test an unpacked extension, enable `chrome-devtools-extension`: same isolated model, but it launches Chrome for Testing (from puppeteer's download cache) with the extension at `$OMEGA_EXTENSION_PATH` pre-loaded and the extension tool category on (`install_extension`, `list_extensions`, `reload_extension`, `trigger_extension_action`, …). Set `OMEGA_EXTENSION_PATH` to the built extension directory before the session starts. No Chrome for Testing installed → it fails loudly; install one with `npx puppeteer browsers install chrome`.

## Available tools

Navigate (`navigate_page`), screenshot (`take_screenshot`), click (`click`), fill forms (`fill`, `fill_form`), type (`type_text`), hover (`hover`), evaluate JS (`evaluate_script`), console logs (`list_console_messages`), network requests (`list_network_requests`), keyboard input (`press_key`), resize (`resize_page`), accessibility snapshots (`take_snapshot`), Lighthouse audits (`lighthouse_audit`), performance traces, heap snapshots, dialog handling.

## Where the knowledge lives

- `docs/mcp-router/index.md` — the router guide: architecture, the meta-tools, the bundled upstreams table, config layering, and the plugin wiring.
- `packages/mcp-router/README.md` — the package: the `omega-mcp` CLI, the overlay at `~/.omega/mcp-router/`, and the env vars.
- Adding a private upstream (playwright, firebase, …) is an overlay entry — it never edits the bundled defaults.
