# Testing

## The layered mantra (ratified 2026-07-28, #46)

**Every behavior is proven at the LOWEST layer that can prove it, and the shape is MIRRORED across all frameworks.** This is standing doctrine — it governs every future test, and existing tests that violate it get healed, not grandfathered.

1. **Unit** — a single function or module, in isolation, inside its own package. If a unit test can prove it, nothing above may be the only proof.
2. **Integration** — a whole system inside ONE package, real wiring, no mocks of the package's own code (the js_patterns rule: never mock what you can test real).
3. **End-to-end** — reserved for contracts that CROSS framework boundaries (client↔backend, desktop↔backend, brand↔brand, consumer↔monorepo). An e2e lane that only exercises one package's internals is mis-layered: push the assertion down.

Mirrored means: the same lanes, the same runner semantics, the same `test/` layout and naming, the same scope grammar (below) in every package. A test that exists in one framework's suite exists in its siblings' suites wherever the surface exists (the mirrored-implementation rule applied to test shape).

### Mirrored suite shape

Every package's suite wears the same clothes:

- **Top-level `test/`** — one directory at the package root, mirroring the source tree beneath it. No `test/tests/`, no per-source-dir `__tests__`. Deliberate exception (#46 disposition): desktop and extension keep their suites at `src/test/` — the layer-tagged harness (runners, fixture apps, per-layer suites) is framework source their own `omega test` runner resolves from, and relocating it buys no mirror benefit for real churn risk. The five plain-node email test files that used to sit colocated under backend's `src/manager/libraries/email/` — run by hand, outside every lane — were healed under `packages/backend/test/email/` in their mirrored spots ([#105](https://github.com/Omega-JS-Stack/omega/issues/105)); the runner discovers them like everything else.
- **`*.test.js` filenames** — the suffix IS the discovery signal, everywhere. Backend's suite now matches (its runner discovers `.test.js` only — no bare-`.js` fallback); `_`-prefixed files and directories stay excluded at any depth for shared helpers and fixtures.
- **`node --test`** is the default runner (`node --test test/*.test.js` in the npm script), unless the package's own runner is the motivated path: backend, desktop, and extension self-test through `omega test` because their suites need a booted emulator/app and the C5 scope grammar, and devkit wraps the same runner in `scripts/run-tests.js` for its two-pass shape: a `node --test` main pass over every other file, then `e2e-harness.test.js` on its own, executed DIRECTLY (no `--test`, so no runner child and no result-stream IPC to corrupt, the mechanism behind that suite's long-running flake, [#36](https://github.com/Omega-JS-Stack/omega/issues/36)), with one retry that banks the failing output to `.temp/`.

The always-wrong shapes — a `__tests__/` directory, a `*.spec.*` filename, `test/tests/` nesting — are bounced at write time by the omega plugin's shape hook (`agent-plugins/claude/hooks/shape/`), in this repo and in every consumer session the plugin loads in. The layer CHOICE stays judgment; the hook guards only the mechanical shape.

Layer names inside a suite are platform-native on purpose: desktop's `main`/`renderer` and extension's `background`/`view` name the runtimes those platforms actually have. That is vocabulary, not drift — the mirroring rule is about layout, naming, and runner semantics, not about pretending every platform has the same layers.

## The three verification tiers (what runs when)

| Tier | What | Command | When |
|------|------|---------|------|
| 1 — Package suites | Each package's own `node --test` (config, devkit, manager, web, client, backend boot, …) plus the root `scripts/*.test.js` guards (secrets-copier etc.) | `npm test` in the package, or `npm run test:packages` at the root — **`test:packages` is also the QUICK lane** (no corpus/e2e/journey) | Every checkpoint |
| 2 — Corpus (automated consumers) | The **brand-shape corpus** (7+ generated brand shapes: real onboard + real Eleventy builds with per-shape invariants — themes, target combos, content, font preloads; offline, no installs) then the sandbox **backend corpus** (framework routes/events/rules through a REAL consumer + real emulator) | `npm run test:corpus` at the root | Every checkpoint that touches runtime behavior |
| 2a — Sandbox e2e | The **cross-stack e2e** (puppeteer browser → website → backend: signup/signin/subscribe/cancel/refund/data-request/delete lifecycle) | `npm run test:e2e` at the root | Every checkpoint; `OMEGA_SKIP_E2E=1` to skip |
| 2b — Verts company-mode e2e | The **cross-brand verts (house-ads) proof** (Paperloom's backend emulator serves seeded `verts` inventory — HTML unit / scoring / 204 / fail-closed redirect / whitelist scoping — and The Daily Build consumes as `source: 'company'`: real `@omega.js/config` compose → real `@omega.js/client` resolution → the consumer-built URL fetched against the parent stack) | `npm run test:verts` at the root | Every checkpoint touching the verts chain; `OMEGA_SKIP_E2E=1` to skip |
| 2c — Extension auth e2e | The **extension ↔ backend auth boundary in a REAL Chrome** ([scripts/e2e-extension-auth.js](../../scripts/e2e-extension-auth.js)): the Paperloom extension app builds as a TESTING build, headless Chrome loads it unpacked, the brand-site `?authToken=` tab drives the background SW's real sign-in, and the popup context's `omega:syncAuth` message makes the SW fetch a fresh custom token from the emulator — the uid round trip asserted INSIDE the extension. Offline by construction (host-resolver rules NXDOMAIN everything but the local stack). The lane REQUIRES the classic ports (hosting 5002, auth 9099) — an extension context has no `process.env`, so a bumped port can never reach the SW; a taken port hard-fails naming it (it does not skip) | `npm run test:e2e-extension` at the root | Every checkpoint touching extension auth, the SW build config, or the `/user/token` wire; `OMEGA_SKIP_E2E=1` to skip, and no puppeteer Chrome → SKIPPED (exit 0, reason printed) |
| 2d — Desktop auth e2e | The **desktop ↔ backend auth boundary in a REAL Electron app** ([scripts/e2e-desktop-auth.js](../../scripts/e2e-desktop-auth.js)): a consumer app staged from @omega.js/desktop's bundled fixture is webpack-built and booted by the real boot runner, then a SECOND Electron instance launches carrying `<brand.id>://auth/token?authToken=…` — the OS single-instance lock forwards that argv to the running app, whose real `second-instance` → deep-link → client-bridge chain signs it in. Both sides of the process boundary are asserted: main's client-bridge on the emulator user, and the renderer's own @omega.js/client Firebase on the same uid (it learned only through the real `desktop:auth:sign-in-with-token` broadcast). Offline by construction — a testing run connects main's auth to the emulator and the staged config points the renderer's client at the same ports | `npm run test:e2e-desktop` at the root | Every checkpoint touching desktop auth, the deep-link routes, or the `/user/token` wire; `OMEGA_SKIP_E2E=1` to skip, and no electron binary (or no built @omega.js/desktop `dist/`) → SKIPPED (exit 0, reason printed) |
| 2e — User flows e2e (real browser) | The **CRUCIAL user flows through the actual UI** ([scripts/e2e-flows.js](../../scripts/e2e-flows.js)): headless Chromium against Paperloom's full emulator suite (seeded personas) plus the REAL `omega dev` — the auth-emulator proxy the provider redirect leg needs lives only there. Five areas — four per spec item of [#155](https://github.com/Omega-JS-Stack/omega/issues/155), plus the billing journeys of [#209](https://github.com/Omega-JS-Stack/omega/issues/209): **auth** (the Google picker's real redirect leg on /signup and again with `authReturnUrl`, `?authSignout=true` + the account page's kick-out, the empty-return loud failure, and the password FORMS — /signin, /signup, /reset), **checkout** (bound state, armed payment buttons, a `_dev_cardProcessor=test` payment landing on /payment/confirmation with its order), **verts** (an unfilled slot laddering no-fill → promo, the card content-sized under its slot ceiling, the UTM set on the promo link and the click forwarded out of the frame), **account** (a signed-in policy page rendering the persona's account state from the emulator), **billing journeys** (one paid lifecycle per DEDICATED seeded persona — upgrade, cancel, a declined renewal, a trial converting — each verdict read off the RENDERED account page; the two end states no UI can reach post a hand-built test webhook at the backend exactly as a processor would). **Hard precondition**: `OMEGA_WEBHOOK_KEY` must be in the playground backend's `.env` cascade — the webhook route authenticates on it, and the lane throws `OMEGA_WEBHOOK_KEY is missing from the playground backend's .env cascade` at startup rather than running a crippled pass. Owns its stack: it HOLDS every classic port so both children bump onto fresh ones, so it never disturbs a live dev boot | `npm run test:flows` at the root | Every checkpoint touching auth pages, checkout, the vert ladder, the account page, or the billing lifecycle; `OMEGA_SKIP_E2E=1` to skip, and no puppeteer Chrome → SKIPPED (exit 0, reason printed) |
| 2.5 — Wizard journey (outside-monorepo consumer) | The FULL consumer story in a temp brand born OUTSIDE the monorepo: real onboard wizard (flags) → `i local` tree link → every framework setup → `omega dev` boot + branded-homepage probe → headless creds-scrubbed manage (update must build every app) | `npm run test:journey` at the root (also the tail of root `npm test`) | The full sequence, and any change to onboard/linking/setup/boot plumbing |
| 3 — Playground (live rehearsal) | The 24-service manage pipeline against REAL cloud (Firebase, Cloudflare, SendGrid, …) | `npm run pipeline` in `apps/omega-playground` | SPARINGLY — Ian-authorized (real infra, real cost) |

**Root `npm test` runs tiers 1 + 2 + 2a + 2b + 2c + 2d + 2e + 2.5 in one shot** (package suites → corpus → sandbox e2e → extension auth e2e → desktop auth e2e → verts company-mode e2e → auth-token e2e → user flows e2e → wizard journey, sequentially — emulator runs must never overlap). Tier 1 expands `packages/*` only — the apps/* workspaces are covered by their own dedicated stages (the sandbox e2e used to run TWICE per root test through both lanes). The sandbox is offline-only (fake `demo-*` project); the journey brand is `demo-*`/`.invalid`-scoped and creds-scrubbed; the playground is the only tier that touches real cloud.

**Port isolation cuts two ways.** The extension lane REQUIRES the classic ports (an extension context cannot be told a bumped one); the user-flows lane REFUSES them — it binds every classic port on all three addresses (127.0.0.1, ::1, wildcard: Node's SO_REUSEADDR means one bind is not enough) for the whole run, so the emulator CLI and `omega dev` both bump onto fresh ports and a developer's live stack is untouched. A classic port that is already busy is somebody else's: the hold simply fails and the allocator bumps around it as always. The website port is allocated by the LANE and handed to both children as `OMEGA_WEBSITE_PORT`, because the backend builds checkout confirmation URLs from it and boots first.

**The auth lanes divide by SURFACE.** `npm run test:auth` ([scripts/e2e-auth-token.js](../../scripts/e2e-auth-token.js)) is the fast WIRE-CONTRACT lane: the desktop client-bridge required in-process from node against the emulator, proving the custom-token round trip in seconds. Tiers 2c and 2d are the REAL-SURFACE proofs of the same chain — the extension's background SW inside actual Chrome, and the desktop app inside actual Electron with a real OS-delivered deep link. A change to the token wire runs the fast lane; a change to how either app RECEIVES it runs its real-surface lane.

**Every lane leaves a log.** A lane tees its full output — its own lines plus every child command's — to `.temp/logs/<lane>.log` (`test:packages` → `.temp/logs/test-packages.log`), and each e2e runner writes per-step verdicts to `.temp/<lane>/steps.log` beside its environment logs, so `grep '^FAIL' .temp/*/steps.log` names the failing step even after a lane was killed. Truncated per run; read them instead of re-running a lane to see what it said ([logging.md](logging.md)).

**Skip knobs** (all documented in their script headers too): `OMEGA_SKIP_E2E=1` (sandbox e2e, verts, auth-token, extension auth, desktop auth, user flows), `OMEGA_SKIP_JOURNEY=1` (journey), `OMEGA_JOURNEY_STRICT=1` (unmet journey preconditions fail instead of skip), `OMEGA_JOURNEY_KEEP=1` (keep the temp brand after a green run).

**Publish rehearsal — `npm run release:check`** (scripts/release-check.js): packs every publishable (real prepare + vendoring), scratch-installs each tarball with local-tarball overrides for the published @omega.js runtime deps, `require.resolve`s it, and scans the installed tree for raw private @omega.js references. The laptop mirror of CI's pack-smoke; the mechanical gate for the publish-proving checkpoint. `--only=web,manager` iterates a subset; `--keep` preserves the scratch dir.

## The brand-shape corpus (cp197)

Tier 2's opening act ([scripts/corpus-shapes.js](../../scripts/corpus-shapes.js)): a matrix of brand SHAPES — target combos (web-only, default web+backend derivation, all-four, backend-only, desktop+extension), themes (classy, newsflash), content (a real `_posts` entry the blog must list) — each born through the REAL onboard in a temp dir (config validates, git initializes) and, for web cells, built by the REAL Eleventy engine straight from the monorepo (no installs — the zero-page-pin lane) with per-cell invariants: branded homepage, `data-theme-id`, `/blog`, sitemap + robots. Fully offline; failing cells keep their temp brand for autopsy. A new shape = a new `CELLS` row, never a new harness. The journey lane (below) covers the one axis this can't: the outside-monorepo install/boot/manage story.

## The wizard journey lane (cp195)

The scripted form of the cp194 hand rehearsal — proof that a consumer OUTSIDE the monorepo (where hoist-luck can't save anything) can live the whole story. Mechanics: `@omega.js/devkit/test/journey-harness` (spec-driven: `{ id, url, targets, expect }` — a corpus of brand shapes can reuse it); runner: [scripts/e2e-journey.js](../../scripts/e2e-journey.js).

- **Preconditions skip, never lie**: no network or no java → the lane prints SKIPPED and exits 0 (`OMEGA_JOURNEY_STRICT=1` turns that into a failure). `OMEGA_SKIP_JOURNEY=1` skips outright.
- **Runtime legs run creds-scrubbed**: `omega dev` and manage children get credential-shaped env vars stripped — the journey must never reach a real cloud. Install legs (onboard/link/setup) keep the machine env.
- **The manage scorecard** comes from the brand's `.omega/runs/*.json`: `update` must succeed and no service may error except the allowed set (default `{testing}` — the live-URL probe of a never-deployed `.invalid` brand fails by design).
- **Artifacts**: numbered stage logs in `.temp/journey/`, per-step verdicts in `.temp/journey/steps.log` (`grep '^FAIL'` names the leg that broke, including a `preflight` abort that never reached a step); on failure the temp brand is KEPT and its path printed (`OMEGA_JOURNEY_KEEP=1` keeps it on success too).
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

The sandbox brand's backend corpus is the framework suite run in consumer context — its scripts say so explicitly since cp94: `npx omega test framework:` ([apps/sandbox-brand/apps/backend/package.json](../../apps/sandbox-brand/apps/backend/package.json)).

## Per-framework notes

- **web** — project scope = production build + smoke checks + consumer `test/`; `framework:` runs @omega.js/web's own `node --test` suite. That suite is local-era only: it requires the package's unbuilt `src/` and its dev dependencies, neither of which a published install receives, so `framework:` from an installed brand finds nothing ([#115](https://github.com/Omega-JS-Stack/omega/issues/115) ruling: the suite's home is the monorepo, and shipping it would cost every consumer ~1 MB for a scope only framework developers use).
- **backend** — framework source = the routes/events/rules corpus (boot/ stays self-test-only); project source = `<project>/test`. Filters are prefix-stripped centrally, so `framework:routes/general` and a bare `general/` (project) match within their own trees only.
- **desktop / extension** — runner-core handles sources + layers (`--layer build|main|renderer|boot` etc. unchanged, orthogonal to scoping).
- **Every runner-core framework** — framework `boot/` suites are self-test only: they assert on the framework's own fixture consumer, so consumer discovery excludes them and consumers write their own under `<app>/test/boot/`. A consumer run that asks for `--layer boot` with no suites of its own says so instead of running silently empty.

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
- Other manager commands ride the same handoff: bare `omega` at a brand root means the manager's manage cycle, `omega onboard` reaches the wizard, and `omega deploy` is the brand-root deliberate-deploy fan-out (docs/shared/deploys.md).

## CI runner notes

- **npm 11 script-approval gating skips dependency postinstalls on CI runners.** Puppeteer's Chrome download is handled explicitly in ci.yml (`npx puppeteer browsers install chrome`); if a native-postinstall dep (electron, canvas, sharp, …) ever misbehaves in CI, this gating is the first suspect — add an explicit install step like puppeteer's rather than disabling the gate.
- **Post-mortem steps use `if: always()`**, not `if: failure()` — runner-level cancellation (OOM, watchdog) is NOT `failure()`, and cancelled runs are exactly the ones that need the diagnostics.
