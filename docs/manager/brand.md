# Working in a consumer brand monorepo

> Framework-owned. This is the brand-root guide: what a session inside ANY consumer brand needs before touching files. Brands reach it through the agent-docs chain (their root `AGENTS.md` imports the top-level omega `AGENTS.md` via `node_modules` — contract: [../shared/agent-docs.md](../shared/agent-docs.md)) and through the omega plugin's `omega:manager` skill. Brand-specific notes never go here; they live below the import in that brand's own `AGENTS.md`.

## What you are working in

A **brand monorepo**: one brand (`config/omega.json5`), npm workspaces, one app per enabled target under `apps/`. The `@omega.js/*` frameworks do the heavy lifting — apps stay thin (config + content + custom routes/pages).

| App dir | Target | Framework | Required reading |
|---|---|---|---|
| `apps/website/` | web | `@omega.js/web` | the `omega:web` skill → `docs/web/index.md` |
| `apps/backend/` | backend | `@omega.js/backend` | the `omega:backend` skill → `docs/backend/index.md` |
| `apps/desktop/` | desktop | `@omega.js/desktop` | the `omega:desktop` skill → `docs/desktop/index.md` |
| `apps/extension/` | extension | `@omega.js/extension` | the `omega:extension` skill → `docs/extension/index.md` |

**Before doing ANY work inside an app, read its framework's guide** — the omega plugin's inject hook loads the matching skill automatically in that app, and the skill points at the guide; architecture, conventions, APIs, and gotchas live there, not here.

## Brand root anatomy

- `config/omega.json5` — THE brand config (shared sections + `targets.<type>`; key presence = target enabled). Apps in a brand carry NO config file of their own.
- `.env` — secrets, ALWAYS (the config loader hard-fails secret-shaped keys in omega.json5). Gitignored.
- `.omega/` — durable state, secrets store, run output. Gitignored; never commit it.
- `apps/<target>/` — one workspace per enabled target (see table above).
- `logs/` — the brand-level run logs: `logs/manage.log` (the manage cycle) and `logs/dev.log` (`npm start`'s dev fan-out). Gitignored, truncated on every launch.
- `AGENTS.md` / `CLAUDE.md` — the doc chain: `CLAUDE.md` is a one-line `@AGENTS.md` pointer; `AGENTS.md`'s first line imports the framework guide; everything below the import is the brand's own.

## Verbs (the whole interface)

Run from the **brand root**:

```bash
npm start                           # local dev stack (website + backend by default; `npm run dev` is the same)
npm run manage                      # manage: reconcile EVERY service to omega.json5 (idempotent)
npm run manage -- --service=<name>  # reconcile one service (workspace, github, cloud, cloudflare, …)
npm run deploy                      # DELIBERATE publish fan-out: each app's own deploy, backend first
```

The scripts are the named verbs (`omega manage`, `omega dev`, `omega deploy`) — a bare `omega` prints help and runs nothing. `npm start`'s boot reconciles the LOCAL lane only (workspace, assets, disperse); `npm run manage` is the full setup.

Run from an **app root** (`apps/<target>/`):

```bash
npx omega setup      # validate config + scaffold/heal framework-owned files
npx omega dev        # this app's dev server/build watch
npx omega test       # the app's test suites
npx omega deploy     # DELIBERATE publish for this target (commits never auto-deploy)
npx omega i local    # link the local framework monorepo (ONE-TIME — the link is durable; rerun only to heal, never per change)
npx omega i live     # restore published registry versions
```

`omega`, `omg`, and `mgr` are the same context-aware dispatcher — the nearest app names the framework that runs.

Tests follow the layered doctrine in each framework's own `docs/test-framework.md` (unit for functions, integration for in-package systems, e2e only across framework boundaries; never mock what you can test real). Bare `npx omega test` runs are PROJECT-only — the framework corpus needs an explicit `framework:` or `full:` target.

## Logs — grep them, never restart

Every verb tees its whole run to a file: truncated on each launch, ANSI-stripped, gitignored. Server state, build errors, test failures and emulator traffic are ALREADY on disk — read them instead of restarting a process or re-running a suite.

| Where | Files |
|---|---|
| brand root | `logs/manage.log` — the manage cycle · `logs/dev.log` — `npm start`'s dev fan-out across every leg (consecutive duplicate lines collapse to one `  (repeated N×)` note) |
| any app | `apps/<target>/logs/dev.log`, `logs/build.log`, `logs/test.log` |
| backend, extra | `apps/backend/dist/emulator.log` (the emulator's own traffic), `dist/dev.log`, `dist/test.log` — beside firebase-tools' `*-debug.log` |
| desktop, extra | `apps/desktop/logs/runtime.log` — the running app itself (packaged builds: the OS log dir) |

```bash
tail -50 apps/website/logs/dev.log            # is the dev server up, what did it last build
grep -i error apps/backend/dist/emulator.log  # what the emulator actually served
```

The mechanism, the retention rule, and the complete path table: [../shared/logging.md](../shared/logging.md).

## Working locally against the framework (upstream-first)

When this brand runs `omega i local` / `omega dev --local`, every `@omega.js/*` dep is linked LIVE from the local framework monorepo — a framework change reflects here instantly. That linkage exists for a reason: real applications expose framework holes. **When you hit a defect or gap that EVERY consumer would face — a broken core style, a missing option, a wrong default — it belongs in the FRAMEWORK (the linked monorepo), not in this brand.** The test: would the next consumer project need the same patch? Then it belongs upstream. **But ask first, always: SURFACE the proposed framework change (what is broken, what you would change, why every consumer needs it) and WAIT for Ian's go before editing the monorepo — or file it as an upstream issue.** Never edit the framework silently as a side effect of brand work. Within reason: brand-specific looks, content, and one-off behavior stay in the brand; framework edits follow the framework's own rules (its docs, its tests). When the link is NOT active (published versions installed), file the gap upstream instead of patching around it locally.

## Hard rules

- **Never edit generated output**: `dist/`, `packaged/`, anything gitignored. Edit `src/`, run the build.
- **Never edit `node_modules/`** — framework bugs get fixed in the framework.
- **Secrets never enter omega.json5** — `.env` / `.omega/secrets/` only.
- **Deploys are deliberate**: only `omega deploy` publishes. Commits and pushes never auto-publish.
- **Don't start long-running dev processes the user may already be running** (`npm run dev`, emulators) — assume theirs is up and GREP THE LOGS; every surface already wrote its output to disk.
- **Framework-owned file sections** (marked `Default Values` / `OMEGA Rules` blocks) are rewritten by `omega setup` — put customizations in the marked custom sections only. One exception, by design: a backend app's `firestore.rules` is YOURS end to end — it is compiled with the framework half into `dist/firestore.rules` (never edit that), and a match block you write whose path names a framework block's is MERGED into it (your condition ANDs onto the framework's, for every op you both name), which is how the brand tightens a framework rule. See [docs/backend/index.md](../backend/index.md) § Firestore rules.
