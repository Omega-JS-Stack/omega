# OMEGA

The open JavaScript stack: one brand config, every target — web, backend, desktop, and browser extension.

One repo, every surface of the brand. `config/omega.json5` is the single
source of user choices; `omega-manager` reconciles every external service
to it, idempotently.

## Structure

- `config/omega.json5` — brand-level shared config (apps inherit + override)
- `apps/website/` — the web app (framework: `@omega.js/web`)
- `apps/backend/` — the backend app (framework: `@omega.js/backend`)
- `apps/desktop/` — the desktop app (framework: `@omega.js/desktop`)
- `apps/extension/` — the extension app (framework: `@omega.js/extension`)
- `.env` — credentials (gitignored; see the stub for every service's keys)
- `.omega/` — manager state + run output (gitignored, machine-owned)

## Next steps

1. Install each app's framework and run its setup (see the app list above).
2. Fill in `.env` as the brand adopts external services.
3. `npx omega-manager` — reconcile everything; rerun any time.
