# OMEGA Backend (@omega.js/backend)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/backend` — identity, top-level conventions, and a map to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** (per-subsystem APIs, behavior tables, recipes) lives in the package's own [`docs/<topic>.md`](../../packages/backend/docs) files. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one.

> **Mirrored structure:** the four framework guides — `docs/web/index.md`, `docs/backend/index.md`, `docs/extension/index.md`, and `docs/desktop/index.md` — mirror each other (the legacy UJM/BEM/BXM/EM lineage): shared sections (Supply-Chain Security, Development Workflow, File Conventions, Doc-update parity, etc.) appear in the **same order at the same position** across all four. When adding a section that applies to multiple frameworks, insert it in the same spot in all of them.

## Identity

OMEGA Backend (@omega.js/backend) is a comprehensive framework for building modern Firebase Cloud Functions backends. Sister project to Electron Manager (EM), Browser Extension Manager (BXM), and Ultimate Jekyll Manager (UJM). Provides a single `Manager.init(exports, {...})` bootstrap that wires built-in functions (`omega_api`, auth events, cron jobs), helper classes (RouteContext, User, Analytics, Usage, Middleware, Settings, Utilities, Metadata), payment processor integrations (Stripe / PayPal), Firestore-trigger pipelines, marketing campaign automation, an MCP server, and a CLI for emulator/deploy/logs/auth/Firestore operations.

**This repository** is the @omega.js/backend library itself. **Consumer projects** are src-first Firebase apps: `require('@omega.js/backend')` in `src/index.js`, with optional `src/routes/`, `src/schemas/`, and `src/hooks/` for custom endpoints; `omega build` stages everything into `dist/` (the tree `firebase.json` points at). Config is loaded via `@omega.js/config` (shared sections top-level, backend settings under `targets.backend`; brand-monorepo hierarchy supported — brand apps carry NO config file of their own).

## Recommended skills

- **`omega:backend`** — the router skill from the omega Claude plugin. The inject hook loads it automatically in any project with `@omega.js/backend` (root or `functions/`, and inside `packages/backend` here); it points back to this guide + `docs/` (the SSOT).
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## Quick Start

### For Consuming Projects

1. `npm install @omega.js/backend` (at the app root — it's a runtime dependency; the staged `dist/package.json` derives from the app manifest)
2. `npx omega setup` — bootstraps a new project (scaffolds `.firebaserc`, `firebase.json`, `src/index.js`, `engines.node`, plus the defaults tree via the shared devkit engine: AGENTS.md + its one-line `@AGENTS.md` CLAUDE.md pointer, CHANGELOG.md, docs/, test/, `.gitignore`, `.env` — AGENTS.md, `.gitignore`, and `.env` live-sync their `Default Values` section on every setup), validates config, stages `dist/`, provisions Firestore indexes
3. `npx omega emulator` — start Firebase emulators (auth/firestore/functions/database/storage). This is also a **prerequisite of the brand's frontend apps**: `omega dev` in the website app auto-connects Auth/Firestore to these emulators with no live-Firebase opt-out, so start them here first ([docs/web/index.md](../web/index.md))
4. `npx omega serve` — local serve with Stripe webhook forwarding (if `STRIPE_SECRET_KEY` is set)
5. `npx omega test` — runs the project's test suites against an emulator (bare consumer runs never include the framework corpus; the framework self-test context flips the default). Positional target(s) select which test FILES run, by source + path (multiple space-separated targets compose):
   - `npx omega test` — the project's suites
   - `npx omega test email/transactional` — bare path (no prefix): project tests matched by path (relative to `test/`)
   - `npx omega test full:` / `npx omega test full:email` — BOTH sources, the explicit way to include the framework suite
   - `npx omega test mgr:` / `npx omega test backend:` — ONLY framework tests (`mgr:` is the universal cross-framework alias for the manager's own tests; `backend:` is the equivalent @omega.js/backend-specific alias)
   - `npx omega test mgr:email/templates` / `npx omega test backend:email/templates` — only framework tests matching a path
   - `npx omega test project:` — ONLY project tests (all of them)
   - `npx omega test project:routes/custom` — only consumer project tests matching a path
   - `npx omega test backend:rules project:routes` — multiple targets compose (runs both selections)
   - Pass `--extended` (or prefix `TEST_EXTENDED_MODE=true`) for tests that hit real external APIs (SendGrid, OpenAI, etc.). `--extended` is the CLI shorthand for the shared, unprefixed `TEST_EXTENDED_MODE` env var standardized across @omega.js/backend/BXM/UJM/EM; @omega.js/backend propagates it to BOTH the runner subprocess and the live emulator. See [docs/test-framework.md](../../packages/backend/docs/test-framework.md#extended-mode-test_extended_mode).
6. `npx omega deploy` — deploy Cloud Functions to Firebase
7. `npx omega logs:read` / `npx omega logs:tail` — Cloud Function logs from Google Cloud Logging

`npx omega-backend <cmd>` works as an alias for `npx omega <cmd>`.

> **Important:** All `npx omega ...` commands run from the consumer project's **app root** (the directory with `package.json` + `src/`). `dist/` is staged output — never edit it. The CLI also accepts a `functions/` cwd for muscle memory (it normalizes up).

### For Framework Development (This Repository)

> **🚫 NEVER use `npx omega ...` from the framework repo.** `npx omega` is for CONSUMER projects (where the bin is linked in the app's `node_modules/.bin/`). From the framework repo, use `npm test`, `npm run prepare`, etc. — the `scripts` in `package.json` call the local `bin/` directly.

1. `npm install` — install @omega.js/backend's own deps
2. `npm run prepare` — build once: copies `src/` → `dist/` via prepare-package
3. `npm run prepare:watch` — watch mode
4. `npm test` — run framework tests via the bundled fixture project (equivalent to `node bin/omega-backend test`). Accepts the same target syntax: `npm test -- mgr:helpers/content/blog-auto-publisher`. Bare = the fast `boot/` smoke; the FULL framework suite passes against the fixture too — `npm test -- backend:` (the fixture carries corpus-parity payment config and boot-syncs the canonical rules; see [docs/test-boot-layer.md](../../packages/backend/docs/test-boot-layer.md))
5. Test in the **designated test consumer** — `../../ITW-Creative-Works/ultimate-jekyll-backend` is @omega.js/backend's consumer for validating framework changes end-to-end (exercise any consumer-level flow there freely: emulator, tests, deploy paths). From inside it, run `npx omega install dev` to swap @omega.js/backend to this local repo — required whenever you edit the framework source and want the consumer to pick up the changes (the consumer otherwise keeps its installed `node_modules/@omega.js/backend`). Reverse with `npx omega install live`. If `npx omega` then errors with "could not determine executable to run", the local install skipped bin-linking — re-run `npm install` to relink, or call `node node_modules/@omega.js/backend/bin/omega-backend <cmd>` directly.

## Architecture

@omega.js/backend exposes a single `Manager` class that orchestrates everything: it initializes Firebase Admin, wires built-in functions (`omega_api`, auth events, cron), and hands out helper instances via factory methods. Supports **two deployment modes** — Firebase Functions (`projectType: 'firebase'`) or Custom Server (`projectType: 'custom'`). See [docs/architecture.md](../../packages/backend/docs/architecture.md) for the full overview of the Manager class, dual-mode support, and helper factory pattern.

For the directory layout of both the @omega.js/backend library and consumer projects, see [docs/directory-structure.md](../../packages/backend/docs/directory-structure.md).

### Test framework

`npx omega test` runs the project's suites (scope `framework:` or `full:` to include the framework's own) against a **real Firebase emulator** (real Firestore/Auth — never mocked). Suites are organized by concern (`test/routes/`, `test/events/`, `test/rules/`, …) rather than runtime layers. See [docs/test-framework.md](../../packages/backend/docs/test-framework.md).

### Test coverage

Every feature ships with tests at EVERY surface it exposes — logic (`test/routes/`/`test/events/` handler suites against the real emulator), wiring (route round-trips over `http.as(...)` — registration, auth gates, schema validation; this IS @omega.js/backend's end-to-end), and rules (Firestore security-rules suites when rules change). @omega.js/backend has no UI layer — a feature's UI coverage lives in the consuming frontend (UJM/BXM/EM). Skip a surface ONLY when the feature genuinely doesn't have one; "the handler test already covers it" is NOT a reason to skip the route round-trip. See [docs/test-framework.md](../../packages/backend/docs/test-framework.md).

## CLI

`npx omega <command>` (alias `omega-backend`):

| Command | Description |
|---|---|
| `setup` | Bootstrap new projects (scaffolds config files + doc defaults), validate config, provision Firestore indexes |
| `emulator` | Start Firebase emulators (auth/firestore/functions/database/storage); fronts the public hosting port with the mkcert HTTPS proxy (`--no-https` for plain http) |
| `serve` | Local Firebase serve (with auto Stripe webhook forwarding if keys set) |
| `watch` | Auto-reload functions on file change |
| `deploy` | Deploy Cloud Functions to Firebase |
| `test` | Run the project's test suites against an emulator (`framework:` / `full:` reach the framework suite) |
| `update` | Dependency freshness report (installed/wanted/latest + patch/minor/major, < 7-day releases QUARANTINED); `--apply` installs the safe set via npu, `--major` explicit. Aliases: `outdated`, `out`. See docs/shared/updates.md in the Omega repo |
| `mcp` | Start the stdio MCP server (for Claude Code / Claude Desktop). Supports `--token <key>` for user-level connections |
| `firestore:get/set/query/delete` | Direct Firestore reads/writes from the terminal (emulator unless `--production`) |
| `auth:get/list/delete/set-claims` | Manage Auth users from the terminal (emulator unless `--production`) |
| `auth:token` | Mint a custom token + one-click sign-in URL (QA "log in as anyone"; emulator by default, `--production` explicit) |
| `logs:read` / `logs:tail` | Cloud Function logs from Google Cloud Logging |
| `stripe` | Standalone Stripe CLI webhook forwarding |
| `indexes` | Sync deployed Firestore indexes into `firestore.indexes.json` (aliases `indexes:get`, `firestore:indexes:get`) |
| `clean` | Remove node_modules + lockfile and reinstall (alias `clean:npm`) |
| `version` | Print @omega.js/backend version |
| `help` | Print the command listing (also `-h`/`--help`); bare `omega` runs `setup`, unknown commands print the listing and exit 1. The listing is GENERATED from the same command table the dispatcher reads (`src/cli/command-table.js`) — it cannot drift from what actually dispatches |

See [docs/cli-firestore-auth.md](../../packages/backend/docs/cli-firestore-auth.md) and [docs/cli-logs.md](../../packages/backend/docs/cli-logs.md) for full flag references.

## Dependency Resolution

- **Consumer code can use `Manager.require(name)`** to load any @omega.js/backend dependency from @omega.js/backend's own module context (static + prototype). Consumer projects do NOT need to install @omega.js/backend's transitive deps directly.
- **No bundler hook is needed here (#87).** @omega.js/web gives consumers bare imports of framework-declared libraries through an esbuild resolve hook ([docs/devkit/index.md](../devkit/index.md) owns the declared-set reader behind it), and desktop/extension through their webpack `resolve.modules` ordering. Backend functions are NOT bundled: they run under plain node resolution, and `Manager.require(name)` resolves from @omega.js/backend's own module context, which already delivers the same guarantee — the framework's copy, one copy, from the framework's installation. Bare `require('<framework dep>')` in consumer code is NOT part of the contract here; use `Manager.require`.
- **@omega.js/client owns Firebase on the client side.** Consumer frontend code (UJM pages, BXM popup/options, EM renderers) NEVER imports Firebase directly — `firebase.firestore()` → `omega.firestore()`, `firebase.auth()` → `omega.auth()`. @omega.js/backend backend code uses `firebase-admin` directly (server-side is different).

## Development Workflow

- **🚫 NEVER use `npx omega ...` from the framework repo** — `npx omega` is for CONSUMER projects only (where the bin lives in the app's `node_modules/.bin/`). From the framework repo, use `npm test`, `npm run prepare`, etc. — the `scripts` in `package.json` call `node bin/omega-backend` directly. This applies to ALL four OMEGA frameworks (@omega.js/backend/UJM/BXM/EM).
- **🚫 NEVER run `npx omega serve` / `npx omega emulator`** (consumer projects) — they're the user's long-running dev processes. Assume they're already running; if they aren't, **instruct the user to run them** rather than running them yourself (running them again kills theirs). To see output, **read the `dist/*.log` files** (`dev.log`, `emulator.log`, `test.log`) — never tail/attach to the process. Running `npx omega test` is fine (it auto-starts its own emulator if needed).
- **Where the output logs live:** @omega.js/backend CLI commands tee output to `<projectDir>/dist/` (not `logs/` — @omega.js/backend's deliberate exception, co-located with firebase-tools' `*-debug.log`): `dev.log` (`npx omega serve`), `deploy.log` (`npx omega deploy`), `emulator.log` (`npx omega emulator` / test with own emulator), `test.log` (`npx omega test`), `production.log` (`npx omega logs`). The `dev`/`test` names match EM/BXM/UJM; see [docs/logging.md](../../packages/backend/docs/logging.md).
- **If the user reports an error**, check the emulator/test output for the root cause before guessing.
- **Live-test UI changes via CDP.** When working on admin dashboards or browser-facing endpoints, use the `chrome-devtools` MCP tools (screenshots, click, evaluate JS, console logs) to verify the change works in the running browser — your session auto-launches its own private Chrome on the first tool call (no setup, no ports). See [docs/cdp-debugging.md](../../packages/backend/docs/cdp-debugging.md) + `~/.claude/mcp-server/servers/chrome-devtools/CLAUDE.md`.

## Supply-Chain Security

All `npm install` calls in CLI commands (`npx omega i`, `npx omega setup`, setup-tests) route through the `safeInstall()` helper (`src/cli/utils/safe-install.js`). It prefixes `sfw` (Socket Firewall) when installed — blocking confirmed malware at the network level before packages reach disk. Falls back to plain npm if sfw isn't available. CI workflows install sfw globally and run `sfw npm install`/`sfw npm ci`. Installs will **fail if sfw detects confirmed malware** in any package in the dependency tree; non-critical CVEs and quality warnings pass through.

## File Conventions

- **CommonJS** throughout. `prepare-package` copies `src/` → `dist/` 1:1 (no transforms).
- **`fs-jetpack`** over `fs` / `fs-extra` for file operations.
- One `module.exports = ...` per file.
- **Short-circuit early returns** rather than nested ifs.
- **Logical operators at the start of continuation lines** (`|| condB` on a new line, not `condA ||` trailing).
- **Firestore shorthand**: `admin.firestore().doc('users/abc123')` (path string) rather than `.collection('users').doc('abc123')`.
- **Template strings for requires**: `` require(`${functionsDir}/node_modules/@omega.js/backend`) `` rather than string concat.
- **No backwards compatibility** unless explicitly requested.
- **Routes receive whitespace-trimmed data; HTML is preserved.** Sanitize at the HTML-insertion site via `utilities.sanitize()`. Opt into middleware-level HTML strip per-route with `{ sanitize: true }`. See [docs/sanitization.md](../../packages/backend/docs/sanitization.md).
- **Match schema names to route names** — if route is `myEndpoint`, schema is `myEndpoint`.
- **Always use `ctx.respond()` for responses** — do NOT use `res.send()` directly.
- **Always use `Manager.getApiUrl()` for the API URL** — never read the cached `Manager.project.apiUrl` property. The getter is the SSOT and auto-resolves to the local emulator in dev AND test (and production otherwise), so it's safe everywhere without passing an env arg. See [docs/environment-detection.md](../../packages/backend/docs/environment-detection.md).
- **Add Firestore composite indexes** for any compound query (`where` + `orderBy`, or multiple `where`s) to `src/cli/commands/setup-tests/helpers/required-indexes.js` (the SSOT). Without the index, queries crash with `FAILED_PRECONDITION` in production.

See [docs/code-patterns.md](../../packages/backend/docs/code-patterns.md) for code-pattern detail, [docs/common-mistakes.md](../../packages/backend/docs/common-mistakes.md) for the full anti-pattern checklist, and [docs/file-naming.md](../../packages/backend/docs/file-naming.md) for the naming table (routes / schemas / API commands / events / cron jobs / hooks).

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`docs/backend/index.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

**The four framework guides are structurally MIRRORED.** [docs/web/index.md](../web/index.md), [docs/backend/index.md](../backend/index.md), [docs/desktop/index.md](../desktop/index.md), and [docs/extension/index.md](../extension/index.md) keep the same section skeleton in the same order, and each consumer template (`src/defaults/AGENTS.md`; web's lives at `scaffold/AGENTS.md`) mirrors its guide. Never add, rename, or reorder a section in one without making the SAME change in the others in the same pass.

## Documentation

Deep references live in `docs/`. **Whenever you make a behavioral change, update both this overview AND the relevant `docs/*.md` deep reference.**

### Architecture & Conventions

- [docs/architecture.md](../../packages/backend/docs/architecture.md) — Manager class, dual-mode (firebase/custom), helper factory pattern
- [docs/directory-structure.md](../../packages/backend/docs/directory-structure.md) — @omega.js/backend library + consumer project layouts
- [docs/build-system.md](../../packages/backend/docs/build-system.md) — no consumer build (deliberate outlier), framework prepare-package, deploy pipeline
- [docs/code-patterns.md](../../packages/backend/docs/code-patterns.md) — short-circuit returns, logical operators on new lines, Firestore shorthand, template-string requires, fs-jetpack preference
- [docs/file-naming.md](../../packages/backend/docs/file-naming.md) — naming table for routes, schemas, API commands, events, cron jobs, hooks
- [docs/common-mistakes.md](../../packages/backend/docs/common-mistakes.md) — anti-pattern checklist (don't modify Manager internals, always await, increment-before-update, etc.)
- [docs/audit.md](../../packages/backend/docs/audit.md) — full-audit check catalog (U-xx universal / @omega.js/backend-xx / F-xx IDs with severity + scope), protocol + fix loop
- [docs/cdp-debugging.md](../../packages/backend/docs/cdp-debugging.md) — launching a controllable Chrome (CDP) to verify the frontend against your routes (network payloads, auth'd flows via the persistent agent profile)
- [docs/key-files.md](../../packages/backend/docs/key-files.md) — quick lookup for the most-touched files (Manager, helpers, auth events, cron, payment processors, CLI commands)
- [docs/cli-output.md](../../packages/backend/docs/cli-output.md) — shared CLI styling module (`src/cli/utils/ui.js`): OMEGA-style banner/dividers/sections/status symbols + the `Summary` block (pass/warn/fail); setup check return types (`true`/`false`/`Error`/`'warn'`); used by `setup`, adoptable by other commands
- [docs/environment-detection.md](../../packages/backend/docs/environment-detection.md) — `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive); gate side effects on the INTENTIONAL check (`isProduction()` for prod-only, `isDevelopment() || isTesting()` for local-or-test) — never `!isDevelopment()`. Plus the URL helper convention (always `Manager.getApiUrl()` — auto-resolves local in dev+test, never read `project.apiUrl`)
- [docs/response-headers.md](../../packages/backend/docs/response-headers.md) — automatic `omega-properties` header

### Building Routes & Components

- [docs/routes.md](../../packages/backend/docs/routes.md) — recipes for new API commands, routes (context-object handlers, CRUD method files, ownership checks, firebase.json rewrites + ordering, src/index.js entry), event handlers, cron jobs
- [docs/schemas.md](../../packages/backend/docs/schemas.md) — schema contract (context object → flat schema, in-function plan branching), field properties, ID generation + path extraction, required-vs-default footgun
- [docs/firestore.md](../../packages/backend/docs/firestore.md) — path style, NO subcollections, batch reads (~500 cursor pagination), `metadata.{created,updated}` timestamps, response format + redaction
- [docs/migration.md](../../packages/backend/docs/migration.md) — legacy-project migration: runtime config → top-level env vars, `Manager.config.*` → `process.env.*`, constructor routes / tiered schemas → current format
- [docs/sanitization.md](../../packages/backend/docs/sanitization.md) — middleware trim-only default; opt-in HTML strip (`{ sanitize: true }`) with per-field opt-out (`sanitize: false`); manual `utilities.sanitize()` for HTML-insertion sites
- [docs/auth-hooks.md](../../packages/backend/docs/auth-hooks.md) — consumer hooks for `before-create`/`before-signin`/`on-create`/`on-delete` (blocking + non-blocking examples)
- [docs/common-operations.md](../../packages/backend/docs/common-operations.md) — inside-the-handler patterns: authenticate, read/write Firestore, error handling, send response, `omega_api` hook

### Built-in Routes

- [docs/verts.md](../../packages/backend/docs/verts.md) — house verts module (adblock-safe ad system): `verts` collection, public `GET /omega/verts/serve` (self-contained HTML unit, 204 no-fill) + fail-closed `GET /omega/verts/redirect`, admin CRUD, in-memory inventory cache (~5 min TTL), contextual targeting × weight selection
- [docs/admin-post-route.md](../../packages/backend/docs/admin-post-route.md) — `POST/PUT /admin/post` blog creation via GitHub (image extraction + resize at ingest + `@post/` rewriting). Also the publish target for the Ghostii article engine (`libraries/content/ghostii.js`).
- [docs/payment-system.md](../../packages/backend/docs/payment-system.md) — full payment pipeline: Intent → Webhook → On-Write → Transition; subscription model, statuses, `resolveSubscription()`, transition handlers, processor interface, product config, test processor
- [docs/marketing-campaigns.md](../../packages/backend/docs/marketing-campaigns.md) — campaign CRUD routes, recurring campaigns, generator pipeline (newsletter), newsletter-driven blog article (`content.article.enabled`), template-owned schemas, asset hosting, seed campaigns
- [docs/consent.md](../../packages/backend/docs/consent.md) — marketing consent capture: canonical `consent.{legal,marketing}` user-doc shape, signup-form capture, account-page toggle, HMAC unsub link (cross-provider unsub + re-add on resubscribe), admin contact-DELETE revoke mirror, SendGrid+Beehiiv webhook receivers, parent forwarder (`/marketing/webhook/forward`), library-level consent gate in `email.add()`/`email.sync()` (revoked-only skip), migration script template
- [docs/mcp.md](../../packages/backend/docs/mcp.md) — Model Context Protocol server: 28 tools with role-based scoping (24 admin / 2 user / 2 public), tool annotations (title, read/write hints), OAuth 2.1 with PKCE + dynamic client registration + consumer website sign-in, consumer MCP tools (`src/mcp.js`), HTTPS local dev (mkcert), Claude Desktop/Chat/Code configuration

### Subsystems & Libraries

- [docs/ghostii.md](../../packages/backend/docs/ghostii.md) — Blog auto-publisher (Ghostii provider): source types (`$brand` / `$feed:` / `$parent` / URL / text), provider-based architecture, per-entry API overrides, RSS/Atom feed parser, unified `content-sources` Firestore tracking, `sourceContent` pass-through to Ghostii API
- [docs/email-system.md](../../packages/backend/docs/email-system.md) — unified MJML email rendering pipeline: shared preparation (`prepare.js`), composable template system (`base.js` blocks), 4 email templates (card, plain, order, feedback), no SendGrid dynamic templates — everything rendered server-side
- [docs/usage-rate-limiting.md](../../packages/backend/docs/usage-rate-limiting.md) — usage tracking, monthly/daily caps, `setUser()` + mirrors for proxy usage, reset schedule
- [docs/ai-library.md](../../packages/backend/docs/ai-library.md) — `Manager.AI()` unified entry for OpenAI + Anthropic (text via `.request()`, images via `.image()` → `gpt-image-2`)
- [docs/marketing-fields.md](../../packages/backend/docs/marketing-fields.md) — adding custom fields to SendGrid + Beehiiv via the @omega.js/backend/OMEGA SSOT pair
- [docs/stripe-webhook-forwarding.md](../../packages/backend/docs/stripe-webhook-forwarding.md) — auto-started Stripe CLI forwarding for local dev

### Testing & CLI

- [docs/test-framework.md](../../packages/backend/docs/test-framework.md) — running, filtering, log files, test types (standalone/suite/group), context object, assertions, auth levels. **NEVER mock — test against the real emulator.** No `mockManager`/`mockAdmin`/fake `firestore`/stubbed `ctx`; every `run()` gets the real `Manager`/`ctx`/`firestore`/`http`/`accounts` — use them. Pure functions (zero I/O) are the only thing you call directly; anything touching Firestore or an external API runs for real. Real external APIs (OpenAI/PayPal/GitHub/SendGrid/Stripe) are gated behind `TEST_EXTENDED_MODE` in-source (not mocked) — opt in with `--extended` or `TEST_EXTENDED_MODE=true` (shared, unprefixed across @omega.js/backend/BXM/UJM/EM; propagates to BOTH runner + emulator) — and anything an extended test creates externally must be cleaned up by the test. **Each test file `module.exports` a `{ description, type, tests }` object — NOT raw Mocha (`describe`/`it`/`beforeEach`); those globals are not injected and the file fails to load. The only lifecycle hook is `cleanup` — exported `before`/`after` properties are silently IGNORED (do setup inside the tests via an idempotent helper, or in `test/_init.js`). Split tests one-file-per-concern under `test/<area>/`, never one giant `test/test.js`.** **All cleanup runs at the START of every run, never at the end** — the runner flushes the ENTIRE emulator Firestore before every run, so there's nothing to register; seed any needed fixtures in `test/_init.js`'s `setup()`, and never add a trailing cleanup step. Marketing providers (SendGrid/Beehiiv) don't need a special exception — `_test.*` emails are blocked at the validation layer so test signups never reach providers. The `_test.allow_*` carve-out exists only for the live-provider lifecycle test (`test/marketing/consent-lifecycle.js`), which manages its own teardown.
- [docs/test-boot-layer.md](../../packages/backend/docs/test-boot-layer.md) — the `boot/` smoke layer: framework self-test from the repo via the bundled fixture project + `OMEGA_TEST_BOOT_PROJECT` (@omega.js/backend's analog of BXM/UJM `*_TEST_BOOT_PROJECT`)
- [docs/cli-firestore-auth.md](../../packages/backend/docs/cli-firestore-auth.md) — `npx omega firestore:*` and `auth:*` commands, shared flags, examples
- [docs/cli-logs.md](../../packages/backend/docs/cli-logs.md) — `npx omega logs:read` / `logs:tail` with full flag reference and built-in Cloud Function names
- [docs/logging.md](../../packages/backend/docs/logging.md) — `dist/*.log` file table (the `dist/` location exception — co-located with firebase-tools' debug logs), `production.log`
