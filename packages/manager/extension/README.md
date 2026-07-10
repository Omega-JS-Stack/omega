# OMEGA Manager Extension

The companion Chrome extension for `@omegajs/manager` — a private [`@omegajs/extension`](../../extension/) consumer that gives the manager a foothold inside the browser:

- **Bookmark filing** — brand console/dashboard links pushed by the manager's `bookmark` service land under `Ω / {Brand} / {Category}`.
- **Trusted browser automation** — real user-gesture clicks/typing via `chrome.debugger` (CDP), driven over the manager's WebSocket protocol (used by e.g. the Beehiiv segment automation).
- **MCP bridge** — [`mcp-server/`](mcp-server/) exposes the same automation to AI tooling.

## Develop

```bash
npm install        # links @omegajs/extension from ../../extension (file:)
npm run build      # mgr clean && mgr setup && gulp build → dist/ + packaged/
```

Load `packaged/chromium/raw/` as an unpacked extension at `chrome://extensions` (Developer mode). The manager side connects on port 9876 (`OMEGA_EXTENSION_PORT` to override).

## Docs

- [CLAUDE.md](CLAUDE.md) — framework consumer conventions (scaffolded by `mgr setup`)
- [docs/README.md](docs/README.md) — WebSocket protocol + automation command reference
- Manager integration: `packages/manager/src/lib/automation-client.js` and the `bookmark` service

This package is `private: true` and excluded from the `@omegajs/manager` npm tarball (`.npmignore`).
