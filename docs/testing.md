# Testing

## The three verification tiers (what runs when)

| Tier | What | Command | When |
|------|------|---------|------|
| 1 — Package suites | Each package's own `node --test` (config, devkit, manager, web, client, backend boot, …) plus the root `scripts/*.test.js` guards (secrets-copier etc.) | `npm test` in the package, or `npm run test:packages` at the root — **`test:packages` is also the QUICK lane** (no corpus/e2e/journey) | Every checkpoint |
| 2 — Corpus (automated consumers) | The **brand-shape corpus** (7+ generated brand shapes: real onboard + real Eleventy builds with per-shape invariants — themes, target combos, content, font preloads; offline, no installs) then the sandbox **backend corpus** (framework routes/events/rules through a REAL consumer + real emulator) | `npm run test:corpus` at the root | Every checkpoint that touches runtime behavior |
| 2a — Sandbox e2e | The **cross-stack e2e** (puppeteer browser → website → backend: signup/signin/subscribe/cancel/refund/data-request/delete lifecycle) | `npm run test:e2e` at the root | Every checkpoint; `OMEGA_SKIP_E2E=1` to skip |
| 2.5 — Wizard journey (outside-monorepo consumer) | The FULL consumer story in a temp brand born OUTSIDE the monorepo: real onboard wizard (flags) → `i local` tree link → every framework setup → `omega dev` boot + branded-homepage probe → headless creds-scrubbed manage (update must build every app) | `npm run test:journey` at the root (also the tail of root `npm test`) | The full sequence, and any change to onboard/linking/setup/boot plumbing |
| 3 — Playground (live rehearsal) | The 24-service manage pipeline against REAL cloud (Firebase, Cloudflare, SendGrid, …) | `npm run pipeline` in `apps/omega-playground` | SPARINGLY — Ian-authorized (real infra, real cost) |

**Root `npm test` runs tiers 1 + 2 + 2a + 2.5 in one shot** (package suites → corpus → sandbox e2e → wizard journey, sequentially — emulator runs must never overlap). Tier 1 expands `packages/*` only — the apps/* workspaces are covered by their own dedicated stages (the sandbox e2e used to run TWICE per root test through both lanes). The sandbox is offline-only (fake `demo-*` project); the journey brand is `demo-*`/`.invalid`-scoped and creds-scrubbed; the playground is the only tier that touches real cloud.

**Skip knobs** (all documented in their script headers too): `OMEGA_SKIP_E2E=1` (sandbox e2e), `OMEGA_SKIP_JOURNEY=1` (journey), `OMEGA_JOURNEY_STRICT=1` (unmet journey preconditions fail instead of skip), `OMEGA_JOURNEY_KEEP=1` (keep the temp brand after a green run).

**Publish rehearsal — `npm run release:check`** (scripts/release-check.js): packs every publishable (real prepare + vendoring), scratch-installs each tarball with local-tarball overrides for the published @omega.js runtime deps, `require.resolve`s it, and scans the installed tree for raw private @omega.js references. The laptop mirror of CI's pack-smoke; the mechanical gate for the publish-proving checkpoint. `--only=web,manager` iterates a subset; `--keep` preserves the scratch dir.

## The brand-shape corpus (cp197)

Tier 2's opening act ([scripts/corpus-shapes.js](../scripts/corpus-shapes.js)): a matrix of brand SHAPES — target combos (web-only, default web+backend derivation, all-four, backend-only, desktop+extension), themes (classy, newsflash), content (a real `_posts` entry the blog must list) — each born through the REAL onboard in a temp dir (config validates, git initializes) and, for web cells, built by the REAL Eleventy engine straight from the monorepo (no installs — the zero-page-pin lane) with per-cell invariants: branded homepage, `data-theme-id`, `/blog`, sitemap + robots. Fully offline; failing cells keep their temp brand for autopsy. A new shape = a new `CELLS` row, never a new harness. The journey lane (below) covers the one axis this can't: the outside-monorepo install/boot/manage story.

## The wizard journey lane (cp195)

The scripted form of the cp194 hand rehearsal — proof that a consumer OUTSIDE the monorepo (where hoist-luck can't save anything) can live the whole story. Mechanics: `@omega.js/devkit/test/journey-harness` (spec-driven: `{ id, url, targets, expect }` — a corpus of brand shapes can reuse it); runner: [scripts/e2e-journey.js](../scripts/e2e-journey.js).

- **Preconditions skip, never lie**: no network or no java → the lane prints SKIPPED and exits 0 (`OMEGA_JOURNEY_STRICT=1` turns that into a failure). `OMEGA_SKIP_JOURNEY=1` skips outright.
- **Runtime legs run creds-scrubbed**: `omega dev` and manage children get credential-shaped env vars stripped — the journey must never reach a real cloud. Install legs (onboard/link/setup) keep the machine env.
- **The manage scorecard** comes from the brand's `.omega/runs/*.json`: `update` must succeed and no service may error except the allowed set (default `{testing}` — the live-URL probe of a never-deployed `.invalid` brand fails by design).
- **Artifacts**: stage logs in `.temp/journey/`; on failure the temp brand is KEPT and its path printed (`OMEGA_JOURNEY_KEEP=1` keeps it on success too).
- Heavy by design (registry installs, all-four app builds) — that's the point; it caught brand-root manager resolution (#8), the ambient-Node engines stamp (#9), and the stale-manifest clobber + linked-prepare destruction (#10) on its first runs.

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
