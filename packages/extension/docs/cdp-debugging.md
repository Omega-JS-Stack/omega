# CDP Debugging (driving a live browser)

How to drive a browser you can CONTROL — see the extension live, screenshot it, click, type, read console logs, inspect network requests — for agents (Claude via MCP/CDP) and humans. For @omega.js/extension this is THE dev surface: the extension only exists inside a running browser.

> Mirrored across the five sister frameworks (UJM / @omega.js/backend / @omega.js/extension / EM / @omega.js/client) — same core section, framework-flavored. Edit all five together.

## The browser: your Claude session owns one

Browser work runs through the **`chrome-devtools` MCP** (via mcp-router). There is NO launch procedure anymore — no ports, no profile dirs, no curl checks:

- **Just call the tools** — `new_page`, `navigate_page`, `take_screenshot`, `click`, `fill`, `evaluate_script`, `list_console_messages`, `list_network_requests`. The browser auto-launches on the first call.
- **Each Claude session gets its OWN private Chrome** (`--isolated`): temp profile, CDP over an internal pipe. Parallel sessions cannot see or touch each other's pages — open and close pages freely, the whole browser is yours.
- **It dies with the session.** No orphans, no cleanup, nothing to kill.
- **Ephemeral profile** — cookies/logins do NOT persist between sessions. If a flow needs auth, log in during the task.
- **Self-signed HTTPS is pre-accepted** (`--acceptInsecureCerts` in the upstream) — dev servers load without certificate interstitials.
- **NEVER quit/kill Chrome by app name** (`killall "Google Chrome"`, osascript) — that's the user's personal browser, not yours.

Humans: the agent's Chrome window is visible — you can watch it drive. Full reference: `~/.claude/mcp-server/servers/chrome-devtools/CLAUDE.md`.

## Electron apps are the exception (attach, don't launch)

An Electron dev app is a running singleton — you ATTACH to it instead of launching a browser: the `chrome-devtools-electron` MCP upstream (reads `EM_CDP_PORT`, default 9222, expanded once at session start) or EM's per-invocation `npx omega cdp`. See EM's `docs/cdp-debugging.md`.

## @omega.js/extension specifics: testing the extension (`chrome-devtools-extension` upstream)

The plain `chrome-devtools` browser has NO extension in it — and `--load-extension` is silently ignored by branded stable Chrome (removed ~v137; verified on 149). The fix is the dedicated **`chrome-devtools-extension` MCP upstream**: the same per-session isolated model, but it launches **Chrome for Testing** (which still honors `--load-extension` — verified on CfT 150) with your unpacked extension pre-loaded into the ephemeral profile.

The recipe:

1. **Build the loadable output**: `npm run build` → `packaged/chromium/raw/` (strict-JSON manifest; `dist/` is NOT Chrome-loadable — its manifest is JSON5).
2. **Launch the session with the extension path** (env is expanded ONCE at session start — set it BEFORE `claude`):
   ```bash
   BXM_EXTENSION_PATH="$(pwd)/packaged/chromium/raw" claude
   ```
3. **In the session, enable the upstream** (it's on-demand): `router__enable_upstream { name: "chrome-devtools-extension" }`. The first tool call launches CfT with the extension loaded. Tools are namespaced `chrome-devtools-extension__*` (34 tools — the base set + extension tools).
4. **Rebuild loop**: after `npm run build`, `router__disable_upstream` + `router__enable_upstream` → fresh browser with the rebuilt extension (the profile is ephemeral; the extension loads at launch).

What you can reach: the popup and extension pages as page targets, content scripts inside the pages they're injected into, and the background service worker (`evaluate_script` takes a `serviceWorkerId`). Chrome for Testing binaries live in `~/.cache/puppeteer/chrome/` (the upstream auto-resolves the newest; update with `npu npx @puppeteer/browsers install chrome@stable`).

Full recipe + gotchas: `~/.claude/mcp-server/servers/chrome-devtools-extension/CLAUDE.md`.

Navigating to a brand's UJM dev site? **`https://localhost:4000` — NEVER the LAN IP** (`https://192.168.x.x:...`). Port 4000 by default, increments (4001, …) when multiple sites run; exact port in `.temp/_config_browsersync.yml` at the WEBSITE project root (the UJM consumer, NOT this extension repo).
