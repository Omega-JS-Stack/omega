# Testing

## The three verification tiers (what runs when)

| Tier | What | Command | When |
|------|------|---------|------|
| 1 — Package suites | Each package's own `node --test` (config, devkit, manager, web, client, backend boot, …) | `npm test` in the package, or `npm run test:packages` at the root | Every checkpoint |
| 2 — Sandbox brand (automated consumer) | The backend **corpus** (framework routes/events/rules through a REAL consumer + real emulator) + the **cross-stack e2e** (browser → website → backend) | `npm run test:corpus` / `npm run test:e2e` at the root | Every checkpoint that touches runtime behavior |
| 3 — Playground (live rehearsal) | The 24-service manage pipeline against REAL cloud (Firebase, Cloudflare, SendGrid, …) | `npm run pipeline` in `apps/omega-playground` | SPARINGLY — Ian-authorized (real infra, real cost) |

**Root `npm test` runs tiers 1 + 2 in one shot** (all workspace suites → sandbox e2e → backend corpus, sequentially — emulator runs must never overlap). The sandbox is offline-only (fake `demo-*` project); the playground is the only tier that touches real cloud.

# Test scoping (`omega test`) — the C5 grammar

One grammar, every framework (parser: `@omega.js/devkit/test/scope`, adopted by the devkit runner-core → desktop + extension, the backend runner, and web's test command). Decided by Ian 2026-07-11 (core-changes inbox C5): **a bare test run from a brand/app never drags the framework's suite in** — the framework suite is always an explicit choice.

## Grammar

| Target | Runs | Notes |
|--------|------|-------|
| *(bare)* | **project tests only** | consumer default; `pages/x` = project tests under that path |
| `project:` / `brand:` | project tests only | explicit spelling; optional path: `project:auth/` |
| `framework:` / `omega:` / `mgr:` | the framework's own suite | universal aliases |
| `backend:` `web:` `desktop:` `extension:` (+ legacy `em:` `bxm:` `ujm:`) | the framework's own suite | per-framework ids |
| `full:` | both sources | optional path applies to both: `full:auth` |

- Paths after a prefix scope within that source: `framework:routes/general`, `project:checkout`.
- Unknown prefixes (`framwork:x`) warn and are ignored — never silently match nothing.
- Multiple targets union sources; each path binds to its own source.

## The self-test exception

Inside a framework package itself (cwd package name === the framework), a bare run means the framework's own suite — each package's `npm test` keeps meaning "run my suite". Consumer context is what flips to project-only.

## Corpus spelling

The sandbox brand's backend corpus is the framework suite run in consumer context — its scripts say so explicitly since cp94: `npx omega test framework:` ([apps/sandbox-brand/apps/backend/package.json](../apps/sandbox-brand/apps/backend/package.json)).

## Per-framework notes

- **web** — project scope = production build + smoke checks + consumer `test/`; `framework:` runs @omega.js/web's own `node --test` suite (shipped with the package).
- **backend** — framework source = the routes/events/rules corpus (boot/ stays self-test-only); project source = `<project>/test`. Filters are prefix-stripped centrally, so `framework:routes/general` and a bare `general/` (project) match within their own trees only.
- **desktop / extension** — runner-core handles sources + layers (`--layer build|main|renderer|boot` etc. unchanged, orthogonal to scoping).

## Brand root (cp94b)

At a **brand root** (a directory carrying `config/omega.json5` with no framework declared nearer), every framework's `omega` bin hands over to `@omega.js/manager` — the omega-bin dispatcher detects the brand the same way it detects apps (nearest context wins, walking up; the rule twins `@omega.js/config`'s `resolveBrandRoot`). The manager's `test` command then fans out over the brand's target-mapped apps, spawning each app's own framework bin with `cwd` = the app dir:

| At the brand root | Runs |
|-------------------|------|
| `npx omega test` | every app's **project tests** (bare per app) |
| `npx omega test framework:` | every app's framework suite |
| `npx omega test full:` | both sources, every app |
| `npx omega test routes/x` | project filter forwarded to every app (no match = no-op) |
| `npx omega test web:pages/` | ONLY the web app — its framework suite, scoped |
| `npx omega test em:` | ONLY the desktop app's framework suite |

- Universal targets (bare paths, `framework:`/`omega:`/`mgr:`, `full:`, `project:`/`brand:`) forward to every app verbatim; per-framework ids route to the app owning that framework. The id → framework map is `FRAMEWORK_IDS` in `@omega.js/devkit/test/scope` — the same SSOT each framework's runner reads its own aliases from.
- An id with no matching app warns and runs nothing (exit 0 — same semantics as an app-level filter matching no tests). Only-invalid targets fall back to bare-everywhere, mirroring the app-level parser.
- Apps run **sequentially** with streamed output; any failing app makes the whole run exit 1 (per-app summary at the end).
- **Flags are not fanned out** (`--layer`, `--extended`, …) — flagged runs are app-level invocations; run them from the app dir.
- Other manager commands ride the same handoff: bare `omega` at a brand root now means `omega-manager manage`, `omega onboard` reaches the wizard.

## CI runner notes

- **npm 11 script-approval gating skips dependency postinstalls on CI runners.** Puppeteer's Chrome download is handled explicitly in ci.yml (`npx puppeteer browsers install chrome`); if a native-postinstall dep (electron, canvas, sharp, …) ever misbehaves in CI, this gating is the first suspect — add an explicit install step like puppeteer's rather than disabling the gate.
- **Post-mortem steps use `if: always()`**, not `if: failure()` — runner-level cancellation (OOM, watchdog) is NOT `failure()`, and cancelled runs are exactly the ones that need the diagnostics.
