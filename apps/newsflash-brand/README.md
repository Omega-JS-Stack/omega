# The Daily Build

The dev-news daily: ship logs, release radar, and the state of the toolchain
— fresh off the press.

This is the monorepo's **second-skin brand**: a fictional editorial
publication wearing the **newsflash** theme permanently, so both first-party
skins stay alive in real consumers (classy on `apps/omega-playground`,
newsflash here). Born by copy of the playground (Ian 2026-07-17); the wizard
rehearsal is a separate exercise. **Offline-only test infrastructure**:
demo-* Firebase project, no real cloud, no real external services, never
production.

## Structure

- `config/omega.json5` — brand-level shared config (apps inherit + override)
- `apps/website/` — the web app (framework: `@omega.js/web`) — newsflash theme
- `apps/backend/` — the backend app (framework: `@omega.js/backend`)
- `.env` — credentials (gitignored; offline brand needs none)
- `.omega/` — manager state + run output (gitignored, machine-owned)

## Run it (side-by-side with the playground)

The website port is pinned; backend emulator ports stay classic and N7
auto-bumps past whatever the playground's live stack holds (the boot log and
`.temp/ports.json` name the resolved set):

```bash
# backend emulator (N7-resolved ports)
cd apps/backend && npm run emulator

# website dev server (pinned: https://localhost:4100)
cd apps/website && npm start
```
