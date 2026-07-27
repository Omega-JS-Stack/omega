---
name: bem
description: BEM backend route, schema, test, and usage patterns for the backend-manager framework and its consumer projects. - Use when creating, editing, or working with backend routes, schemas, tests, Firebase functions, Firestore rules, usage tracking, email templates, or backend-manager projects. Triggers on "route", "schema", "endpoint", "BEM", "Backend Manager", "backend-manager", "Firebase function", "create a route", "add an endpoint", "test", "test suite", "write tests", "add tests", "npx mgr test", "rules test", "security rules test", "audit", "audit the backend", "code audit", "full audit", "logs", "gcloud logs", "cloud logs", "npx mgr logs", "usage", "addMirror", "setMirror", "setUser", "usage.validate", "usage.increment", "rate limit", "quota", "auth hook", "before-create", "before-signin", "marketing campaign", "MCP server", "email template", "MJML", "transactional email", "order email", "email.send", "Manager.Email", "prepare.js", "renderEmail", "migrate", "migration", "runtimeconfig", "RUNTIME_CONFIG", "env migration", "old route format", or any work on files in functions/routes/, functions/schemas/, functions/index.js, test/, src/cli/commands/, src/manager/libraries/email/.
user-invocable: true
---

# BEM Backend Patterns

Router skill for **Backend Manager (BEM)** — the backend framework for Firebase Functions APIs with schema-validated routes, usage tracking, payments, email, and an emulator-based test harness. Sister project to [EM](../em/SKILL.md) (Electron apps), [BXM](../bxm/SKILL.md) (browser extensions), [UJM](../ujm/SKILL.md) (Jekyll/web) — four mirrored frameworks on one ecosystem, same conventions and config shapes.

## Read these first (SSOT)

This skill points; the repo docs are the single source of truth — they ship with every install and always match the installed version. Read the CLAUDE.md for the context you're in, then the `docs/<topic>.md` files relevant to the task:

- **In a consumer project:** the project's own `CLAUDE.md` (framework section + project notes), then `functions/node_modules/backend-manager/CLAUDE.md` → `functions/node_modules/backend-manager/docs/*.md`
- **In the framework repo:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/backend-manager/CLAUDE.md` → `docs/*.md`

CLAUDE.md is a table of contents — the meat lives in `docs/`. Always-relevant references: `docs/common-mistakes.md`, `docs/test-framework.md`, `docs/environment-detection.md`, `docs/logging.md`.

## Hard rules

Summaries only — the SSOT for each is the linked doc.

1. 🚫 **NEVER use `npx mgr ...` from the framework repo** — CONSUMER projects only; framework repos use their own `npm` scripts (repo CLAUDE.md § Development Workflow). Applies to ALL four OMEGA frameworks.
2. 🚫 **NEVER run `npx mgr serve` / `npx mgr emulator`** (consumer projects) — they're the user's long-running dev processes; assume they're already running, and if they aren't, INSTRUCT the user to start them (don't start them yourself). To see output, read the `functions/*.log` files (`dev.log`, `emulator.log`, `test.log`) — never tail/attach to the process (`docs/logging.md`). Running `npx mgr test` is fine (it auto-starts its own emulator if needed).
   - **Consumer website dev server URL: `https://localhost:4000` — NEVER the LAN IP.** Cert, port discovery (`.temp/_config_browsersync.yml`), and the browser loop: `docs/cdp-debugging.md`.
3. **All `npx mgr ...` commands run from the consumer project's `functions/` subdirectory** — the binary lives in `functions/node_modules/.bin/` (`docs/cli-firestore-auth.md`).
4. **NEVER mock — test against the real emulator**, and every feature ships tests at every surface it exposes (handler suites, `http.as(...)` round-trips, rules suites). Side-effect tests use dedicated `journey-*` accounts (`docs/test-framework.md`).
5. **Never manually read/write `usage` fields on Firestore docs** — always the `usage` helper; data lives at `{doc}.usage.{metric}` (`docs/usage-rate-limiting.md`).
6. **No subcollections; batch collection reads (~500, cursor pagination); timestamps under `metadata.{created,updated}`; mirror-the-doc responses, delete-don't-redact** (`docs/firestore.md`).
7. **Never combine `required: true` with `default` in schemas** — required is checked before defaults apply; use `min: 1` (`docs/schemas.md`).
8. **Use `Manager.getApiUrl()`** — never the cached `Manager.project.apiUrl`; the getter auto-resolves emulator vs production (`docs/common-mistakes.md`).
9. **Gate env behavior on the intentional check** — `isProduction()` or `isDevelopment() || isTesting()`, never `!isDevelopment()` (`docs/environment-detection.md`).
10. **Doc parity on every behavioral change** — README + CLAUDE.md + `docs/<topic>.md` + CHANGELOG, after validation.
11. **The OMEGA docs and skills are structurally MIRRORED** — this skill, the repo's CLAUDE.md, the consumer template (`src/defaults/CLAUDE.md`), and shared-concept doc filenames match the sister frameworks section-for-section, in the same order. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

Ordered checklists — every step's details live in the linked doc. Invoked with an argument naming a process (e.g. `/omega:bem audit`)? Run that process directly.

### Build a CRUD endpoint
1. Route handlers at `functions/routes/{name}/{method}.js` — context-object exports, plural-noun names, ownership checks on PUT/DELETE (`docs/routes.md`).
2. Schemas at `functions/schemas/{name}/{method}.js` — flat schema from a context object, ID generation (`value: () => randomId()`) on POST, path extraction on GET/PUT/DELETE (`docs/schemas.md`).
3. Firestore conventions for the data itself (`docs/firestore.md`).
4. Export the function in `functions/index.js` + firebase.json rewrites (bracket syntax, most-specific-first ordering) (`docs/routes.md`).
5. Usage tracking / rate limiting via the `usage` helper (`docs/usage-rate-limiting.md`).
6. Tests: handler suite + `http.as(...)` round-trips + rules suite if rules changed (`docs/test-framework.md`).
7. Audit doc parity: README, CLAUDE.md, `docs/<topic>.md`, CHANGELOG.

### Run tests
- `npx mgr test [<path>|mgr:<path>|project:<path>]` from `functions/`; `--extended` for real external APIs; output tees to `functions/test.log` (`docs/test-framework.md`).

### Audit (full project or framework)
- ID'd check catalog — universal U-xx (mirrored across all four frameworks) + BEM-xx + framework-repo F-xx — scope auto-detect, persisted report, severity-ordered TodoWrite fix loop: `docs/audit.md`.

### Debug production
1. `npx mgr logs:read --fn <name> --severity ERROR --since 2h` / `npx mgr logs:tail` — resolve `--fn` via the function-name table (`bm_api` for all consumer routes, `bm_authBeforeCreate` for blocked signups, …) (`docs/cli-logs.md`).
2. Local/dev issues read `functions/dev.log` / `functions/emulator.log` instead — do NOT confuse the two sources (`docs/logging.md`).

### Inspect or fix data
- `npx mgr firestore:get|set|query|delete` and `npx mgr auth:get|list|delete|set-claims`, with `--emulator` for local (`docs/cli-firestore-auth.md`).

### Work on email
- Unified MJML pipeline, template registry (card/plain/order/feedback), prepare.js, UTM auto-tagging, test patterns (`docs/email-system.md`, tests in `test/email/`).

### Migrate a legacy project
- Three parts — env vars (`.runtimeconfig.json`/`RUNTIME_CONFIG` → top-level `functions/.env` keys), legacy code (`Manager.config.*` → `process.env.*`), routes/schemas (constructor → context-object, tiered → flat): `docs/migration.md`.

### Edit the framework from a consumer
- `npx mgr install dev` (use local BEM source) / `npx mgr install live` (restore published) — designated test consumer + workflow in the framework CLAUDE.md.

### Extend the platform surfaces
- Auth lifecycle hooks at `hooks/auth/*.js` (`docs/auth-hooks.md`) · marketing campaigns (`docs/marketing-campaigns.md`) · MCP tools at `functions/mcp/{name}.js` (`docs/mcp.md`).
