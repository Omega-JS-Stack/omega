@docs/omega.md

# OMEGA Monorepo: working on omega

> The rules for working on omega itself. The map imported above (`docs/omega.md`) is shared with every brand agent; this file adds only what a contributor needs. Keep it under 250 lines.

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Every package here is `@omega.js/*`-named; zero npm publishes until Ian finalizes versions.** Old-name releases ship from the LEGACY repos; the monorepo's `pre-*-rename` tags are the backup lane.
3. **Publish policy — internal by default**: private shared packages (`account`, `analytics`, `config`, `devkit`, `monitoring`, `template-kit`) are vendored into published frameworks at prepare time and never publish.
   - Published = frameworks + `@omega.js/manager` + `@omega.js/client` (a real runtime dependency of backend/desktop/extension — never vendored) + `@omega.js/mcp-router` (a real runtime dependency of manager, so the vendored plugin's MCP declaration resolves inside the install — Ian 2026-07-30).
   - All seven publishables carry a mechanical `private: true` latch until the proving checkpoint ([docs/shared/publishing.md](docs/shared/publishing.md)) unlatches them.
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## Getting started (the dev loop)

- Root `npm start` watches every dist-building package concurrently (single-instance lock).
- Re-preparing EVERY package (pre-ship, or after touching a vendored internal like analytics) is ONE root command: `npm run prepare --workspaces --if-present`. Bare `npm run prepare` fails (no root script); never loop per-package.
- At a brand root, `omega i local` links every `@omega.js/*` dep brand-wide from this monorepo (`omega i live` restores registry versions); `omega dev --local` links first, then boots the stack with the watch.
  - Linking is ONE-TIME and durable — never re-run per change; a linked brand just restarts `npm start`.
  - A brand ROOT's `npm start` runs `omega dev`: the whole stack (website + backend) in ONE terminal — never boot the targets separately. Full contract: [docs/shared/local-dev.md](docs/shared/local-dev.md).
- **Upstream-first**: consumer work on a locally linked brand that reveals a framework-level hole fixes it HERE, in the framework — never as a consumer-side patch to repeat in the next project.
  - A consumer session asks first: it surfaces the proposed framework change and waits for Ian's go (or files an issue), never editing the monorepo unprompted.
  - The rule (and its "within reason" line) lives in [docs/shared/local-dev.md](docs/shared/local-dev.md) and ships to brand sessions via the brand guide.
- Tests run in lanes: `npm run test:packages` (unit), then corpus/e2e/verts/auth/journey — the full pipeline and when each lane gates is in [docs/shared/testing.md](docs/shared/testing.md).

## Project state

Live work is GitHub issues (project-state spec v4): the queue is a query (`gh issue list`), status labels carry state, and a spec is the `## Spec` section of its issue — never a file. The retired board era's plan files are history in `_attic/plans/` (on disk, out of git); its durable rulings live in [docs/shared/rulings.md](docs/shared/rulings.md).
