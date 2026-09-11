# Working in a consumer brand monorepo

> Framework-owned. This is the brand-root guide: what a session inside ANY consumer brand needs before touching files. Brands reach it through the agent-docs chain (their root `AGENTS.md` imports the top-level omega `AGENTS.md` via `node_modules` — contract: [../shared/agent-docs.md](../shared/agent-docs.md)) and through the omega plugin's `omega:manager` skill. Brand-specific notes never go here; they live below the import in that brand's own `AGENTS.md`.

## What you are working in

A **brand monorepo**: one brand (`config/omega.json5`), npm workspaces, one dir per enabled target under `targets/`. The `@omega.js/*` frameworks do the heavy lifting — targets stay thin (config + content + custom routes/pages).

| Target dir | Target | Framework | Required reading |
|---|---|---|---|
| `targets/website/` | web | `@omega.js/web` | the `omega:web` skill → `docs/web/index.md` |
| `targets/backend/` | backend | `@omega.js/backend` | the `omega:backend` skill → `docs/backend/index.md` |
| `targets/desktop/` | desktop | `@omega.js/desktop` | the `omega:desktop` skill → `docs/desktop/index.md` |
| `targets/extension/` | extension | `@omega.js/extension` | the `omega:extension` skill → `docs/extension/index.md` |
| `targets/<name>/` | custom ([#603](https://github.com/Omega-JS-Stack/omega/issues/603)) | none — the target's own stack | its own README; the contract is [index.md](index.md) § Custom targets |

**Before doing ANY work inside a target, read its framework's guide** — the omega plugin's inject hook loads the matching skill automatically in that target, and the skill points at the guide; architecture, conventions, APIs, and gotchas live there, not here.

A **custom target** is the exception: `targets.<name>: { type: 'custom' }` in the brand config declares a target no framework owns (a Render API, a worker, a script). It has no framework guide and no framework services — everything it can do is what its own `package.json` scripts (`start`, `build`, `test`, `deploy`, `clean`) declare, and the manager runs those.

## Brand root anatomy

- `config/omega.json5` — THE brand config (shared sections + `targets.<type>`; key presence = target enabled). Targets in a brand carry NO config file of their own.
- `.env` — secrets, ALWAYS (the config loader hard-fails secret-shaped keys in omega.json5). Gitignored.
- `.env.development` / `.env.testing` / `.env.production` — the per-environment OVERLAYS of that `.env` ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)). Only the keys that differ for one environment: the run's own environment picks exactly one file, its values win over the base, and every other environment's file is never read. Put a `sk_test_…` in `.env.development` and the live key in `.env`. Onboard scaffolds all three empty; `.env.*` is gitignored. The mechanics: [../shared/config.md](../shared/config.md#the-env-cascade-secrets--d15).
- `.omega/` — the secrets store, run output, caches, and the per-machine deploy record. Gitignored; never commit it. No durable state file: every provisioned fact the manage cycle resolves lands in `config/omega.json5`, every secret in `.env` ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)).
- `targets/<target>/` — one workspace per enabled target (see table above). A brand still carrying the old `apps/` folder is fixed ONCE, by hand — `npx omega manage --migration=targets-rename --execute` (bare = the audit, moving nothing) renames the folder and flips the root `workspaces` glob with it; re-run `npm install` afterwards so npm re-links the workspaces. Nothing heals it inside a run: every other verb fails loud on the old shape and names that command. Both folders at once is a half-done migration and fails loudly rather than guessing ([../shared/breaking-changes.md](../shared/breaking-changes.md#one-vocabulary--a-brands-surfaces-live-in-targets-443)).
- `logs/` — the brand-level run logs, one file per brand-root verb: `logs/manage.log`, `logs/dev.log`, `logs/build.log`, `logs/clean.log`, `logs/deploy.log`, `logs/update.log`, `logs/test.log`, `logs/pipeline.log` ([#623](https://github.com/Omega-JS-Stack/omega/issues/623)). Gitignored, truncated on every launch.
- `AGENTS.md` / `CLAUDE.md` — the doc chain: `CLAUDE.md` is a one-line `@AGENTS.md` pointer; `AGENTS.md`'s first line imports the framework guide; everything below the import is the brand's own.

**The brand's repos are named `<brand.id>-<role>`** (Ian 2026-09-07, [#809](https://github.com/Omega-JS-Stack/omega/issues/809)). Two roles exist today: `omega`, the brand's SOURCE monorepo (the one you are working in), and `releases`, the one public repo the desktop releases and the autoupdater feed live in. Both are derived, never typed: `@omega.js/config` answers `<brand.id>-omega` for the source repo and `<brand.id>-releases` for the releases one, under the owner `repo.providers.github.org` names, so every verb that addresses a repo (`omega deploy --direct`, the manager's github service, desktop's release lane) reaches the same address. A brand whose repo is named something else declares it: `repo.providers.github.repo` takes a bare name or an `owner/name` slug and wins over the default, which is how a repo under the paid company org is addressed.

### The placement contract — where a thing lives, and what refreshes it

**Authored-once shared things live at the brand ROOT and are distributed from there** (`config/omega.json5`, the `.env` files, the agent docs); **target code and every generated artifact live IN the target** (build hooks, logs, `dist/`, the composed per-target env). A file that is not authored is DERIVED: it refreshes on the verb that owns it and is never hand-edited ([#623](https://github.com/Omega-JS-Stack/omega/issues/623)).

The asymmetry the contract had to settle: `config/omega.json5` is **walked**, never copied — a key deleted at the root is gone from the next read everywhere. `.env` is walked too since [#678](https://github.com/Omega-JS-Stack/omega/issues/678) retired dispersal, so the ONE env copy left is the backend's `dist/.env`, recomposed by every verb that stages it. Neither surface can leave a deleted key behind.

One row per surface; **Siblings** is the set that must match each other (a new mechanism on one sibling and not the others is a defect):

| Surface | Authored where | Lands where | Mechanism | Siblings |
|---|---|---|---|---|
| Brand config | `<brandRoot>/config/omega.json5` | read in place — no copy | **walked** (`defaults ← company ← brand shared ← brand targets.<type> ← local`) | every target reads the one file through `@omega.js/config` |
| Env + secrets | `<brandRoot>/.env`, `.env.<environment>`, company `.env` under both; `.omega/secrets/` for provisioned key material; `targets/<target>/.env` is an optional per-key override | the run's own process env; backend also `targets/backend/dist/.env` | **walked** per verb; the backend `dist/.env` is **generated** per verb ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)) | web · backend · desktop · extension compose from the same cascade (the runtime `environment()` accessor is the open parity gap: [#717](https://github.com/Omega-JS-Stack/omega/issues/717)) |
| Owner hooks | `<brandRoot>/config/hooks/<point>.js`, else the company root's | loaded in place — no copy | **walked** at the call site | every hook point the services declare (today `account/password.js`); committed by default |
| Target build hooks | `targets/<target>/hooks/<point>/{pre,post}.js` | in the target | **scaffolded once** (copy-once), then the target's own file | desktop · extension — one ctx (`{ manager, projectRoot, mode }`), same per-target discovery, desktop adds release/notarize; web has NONE by design and backend's "hooks" are Firebase blocking functions, a name collision ([#591](https://github.com/Omega-JS-Stack/omega/issues/591)) |
| Logs | nobody — output only | `<brandRoot>/logs/<verb>.log` · `targets/<target>/logs/{dev,build,test}.log` | **generated**, truncated per launch, gitignored | every brand-root verb (manage, dev, build, clean, deploy, update, test, pipeline) · every target |
| Translations | source strings in the target's own content | `targets/<target>/translations/{lang}/{namespace}.json` | **generated incrementally, COMMITTED** — a warm cache builds with no AI credentials ([#24](https://github.com/Omega-JS-Stack/omega/issues/24)) | web today; any future target that renders copy |
| Caches | nobody — derived data | `<brandRoot>/.omega/cache/**` | **generated**, gitignored, safe to delete (`--force` ignores them) | every caching service: edge reads, the update fingerprints, web's firebase-auth helpers |
| Build output | nobody — compiled | `targets/<target>/dist/` (+ `packaged/`) | **generated** per verb, gitignored, never edited | every target |
| Agent docs | the framework monorepo (`AGENTS.md` + `docs/`); the brand's own notes below the import in `<brandRoot>/AGENTS.md` | `<brandRoot>/AGENTS.md` + `CLAUDE.md`; `.claude/settings.json` | **distributed** — the workspace service maintains the `node_modules/@omega.js/AGENTS.md` symlink the import resolves through ([../shared/agent-docs.md](../shared/agent-docs.md)) | every brand root; targets carry none by design |
| Package scripts | the manifest's other keys are yours | `<brandRoot>/package.json` + each `targets/<target>/package.json` | **generated write-on-change** — only the named verb keys, every other key and the ordering untouched | brand root (`start`, `manage`, `deploy`) · every target's framework `projectScripts` |
| Tests | per surface: `targets/<target>/test/`; the brand's own browser lane at `<brandRoot>/test/e2e/run.js` | in place | **walked**: each target's own runner, then the brand lane, fanned out by the brand-root `omega test` ([#775](https://github.com/Omega-JS-Stack/omega/issues/775)) | every target · the brand e2e lane |

One file inside `.omega/` is not derived data: `.omega/company.json`, present only in a brand that belongs to a **company workspace**. It is the stamp that makes this brand inherit the company's config layer, its `.env` (under this brand's own), and its shared Apple signing tree — written by `omega company adopt` (or by `omega onboard` inside a company) and re-stamped by company-wide runs. Nothing else about the brand changes. What a company workspace is, and the two commands that own it: [company.md](company.md).

## Verbs (the whole interface)

Run from the **brand root**:

```bash
npm start                           # local dev stack (website + backend by default; `npm run dev` is the same)
npm run manage                      # manage: reconcile EVERY service to omega.json5 (idempotent)
npm run manage -- --service=<name>  # reconcile one service (workspace, repo, cloud, edge, …)
npm run deploy                      # DELIBERATE publish fan-out: each target's own deploy, backend first
npx omega build                     # build fan-out: every target, backend first
npx omega clean                     # clean fan-out: wipe every target's build output
npx omega test                      # test fan-out: every target, then the brand's own e2e lane
```

Every fan-out covers EVERY target type ([#603](https://github.com/Omega-JS-Stack/omega/issues/603)) — a framework target runs its framework's own verb, a custom target runs the matching `package.json` script, and a target that declares no such script steps aside loudly (naming the target and the verb) instead of failing. `build` and `clean` take `--target=` like `deploy` (and like `dev`, `update` and `test`: one picker on every fan-out, [#780](https://github.com/Omega-JS-Stack/omega/issues/780)), plus `--dry-run` (every target prints the command it would have run and nothing executes), and unlike `deploy` a failing target never stops the rest: nothing is published, so one run names every broken target.

**The test walk covers the brand itself, not only its targets** ([#775](https://github.com/Omega-JS-Stack/omega/issues/775)). After every target's own runner, `omega test` runs `<brandRoot>/test/e2e/run.js` when that file exists: ONE entry file by convention, so the walk never guesses which file in the folder is the runner. That lane is the brand's browser proof, driving its real pages against its real local stack (the backend emulator with its seeded personas, plus the real `omega dev`), built on `@omega.js/devkit/test/e2e-harness`. It is a runner script, so like a custom target's `test` script it hears no scope ids and no flags: a bare run reaches it, a scoped or picked or laned run does not. A `test/e2e/` folder with no `run.js` is skipped in one line, never failed. **The browser comes with the manager**: `@omega.js/manager` carries puppeteer, so a brand installs nothing for the lane, and the flip side is that every brand install downloads a Chrome (~150 MB). A brand that will never run the lane skips that download with `PUPPETEER_SKIP_DOWNLOAD=1` in the environment its `npm install` runs in (CI included); the lane then reports the missing browser by name if it is ever run.

Three flags shape the walk. `--target=<a,b>` is the target picker (a comma list of target keys like `web`, or dir names like `website`) and it composes with every scope: `omega test --target=backend framework:` is the backend target's framework suite, `omega test --target=web` its project tests. A framework scope whose owning target the picker excludes is a contradiction, and the run refuses by name rather than testing nothing. `--extended` (real external services) reaches every target. `--lane=<name>` reaches the targets whose framework DECLARES that lane in its package.json `omega.testLanes`; a target that declares none prints one line and the run stays green, because a lane a framework does not serve is not a failure there. A forwarded PATH works the same way: the walk sets `OMEGA_TEST_FANOUT=1` on every target run, so a target that carries no file matching the path answers with a distinct exit code and counts as a miss rather than a failure. The run fails only when every target missed, and says so in one line naming the target, because a path no target carries is a typo and testing nothing is never a green ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)).

The scripts are the named verbs (`omega manage`, `omega dev`, `omega deploy`) — a bare `omega` prints help and runs nothing. `npm start`'s boot reconciles the LOCAL lane only (workspace, assets, disperse); `npm run manage` is the full setup. There is no per-target setup step to remember ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): a target's verbs scaffold and heal its framework-owned files on first run, so a fresh brand goes `npm install` → `npm start`.

Run from a **target root** (`targets/<target>/`):

```bash
npx omega dev        # this target's dev server/build watch
npx omega test       # the target's test suites
npx omega deploy     # DELIBERATE publish for this target (commits never auto-deploy)
npx omega i local    # link the local framework monorepo (ONE-TIME — the link is durable; rerun only to heal, never per change)
npx omega i live     # restore published registry versions
```

`omega`, `omg`, and `mgr` are the same context-aware dispatcher — the nearest target names the framework that runs.

Tests follow the layered doctrine in each framework's own `docs/test-framework.md` (unit for functions, integration for in-package systems, e2e only across framework boundaries; never mock what you can test real). Bare `npx omega test` runs are PROJECT-only — the framework corpus needs an explicit `framework:` or `full:` target.

## One version for the whole family ([#794](https://github.com/Omega-JS-Stack/omega/issues/794))

Every `@omega.js/*` package in this brand carries the SAME version number, and the
manager writes each one as an exact pin — `"@omega.js/manager"` at the root,
`"@omega.js/<framework>"` in each target. `npm run manage` and `npm start` both
open by comparing what is actually INSTALLED (each target's framework and the
`@omega.js/client` under it) against the manager's own version, and a brand that
has drifted is refused before any service or dev leg runs:

```
the @omega.js family ships ONE version — this brand is mixed (#794):
  backend: @omega.js/backend 0.4.0, @omega.js/client 0.4.0
  this manager is 0.5.0
  fix: run `omega update --apply` at the brand root — it moves every target together
```

**The fix is always `omega update --apply` at the brand root** — it fans out over
every target AND the root's own `@omega.js/manager` pin, so the whole family
lands on one number (a bare `omega update` only reports). Never bump a single
target's version by hand: one target ahead means two copies of
`@omega.js/client` in one brand and one omega.json5 validated by two validators,
which nothing downstream can see. A target linked with a `file:` spec is exempt
(the local era — its version is the monorepo's by construction), and a target
with nothing installed yet is skipped with a line rather than failed:
`npm install` is that fix. An installed `package.json` that cannot be parsed, or
carries no version, is its own refusal naming the file — reinstall.

## Logs — grep them, never restart

Every verb tees its whole run to a file: truncated on each launch, ANSI-stripped, gitignored. Server state, build errors, test failures and emulator traffic are ALREADY on disk — read them instead of restarting a process or re-running a suite.

| Where | Files |
|---|---|
| brand root | one file per verb — `logs/manage.log` (the manage cycle) · `logs/dev.log` (`npm start`'s dev fan-out across every leg; consecutive duplicate lines collapse to one `  (repeated N×)` note) · `logs/build.log` · `logs/clean.log` · `logs/deploy.log` · `logs/update.log` · `logs/test.log` · `logs/pipeline.log`. A fan-out log holds the walk's OWN verdict (header, skips, summary) — each target's output is in that target's own log |
| any target | `targets/<target>/logs/dev.log`, `logs/build.log`, `logs/test.log` |
| backend, extra | `targets/backend/dist/emulator.log` (the emulator's own traffic), `dist/dev.log`, `dist/test.log` — beside firebase-tools' `*-debug.log` |
| desktop, extra | `targets/desktop/logs/runtime.log` — the running app itself (packaged builds: the OS log dir) |

```bash
tail -50 targets/website/logs/dev.log            # is the dev server up, what did it last build
grep -i error targets/backend/dist/emulator.log  # what the emulator actually served
```

The mechanism, the retention rule, and the complete path table: [../shared/logging.md](../shared/logging.md).

## Working locally against the framework (upstream-first)

When this brand runs `omega i local` / `omega dev --local`, every `@omega.js/*` dep is linked LIVE from the local framework monorepo — a framework change reflects here instantly. That linkage exists for a reason: real applications expose framework holes. **When you hit a defect or gap that EVERY consumer would face — a broken core style, a missing option, a wrong default — it belongs in the FRAMEWORK (the linked monorepo), not in this brand.** The test: would the next consumer project need the same patch? Then it belongs upstream. **But ask first, always: SURFACE the proposed framework change (what is broken, what you would change, why every consumer needs it) and WAIT for Ian's go before editing the monorepo — or file it as an upstream issue.** Never edit the framework silently as a side effect of brand work. Within reason: brand-specific looks, content, and one-off behavior stay in the brand; framework edits follow the framework's own rules (its docs, its tests). When the link is NOT active (published versions installed), file the gap upstream instead of patching around it locally.

**The guard hook enforces this half of the rule.** A `Write|Edit` to a framework-owned file in this brand is refused by `omega:guard` ([#452](https://github.com/Omega-JS-Stack/omega/issues/452)): generated and vendored files (`node_modules/`, any `dist/`, a generated header, the OMEGA-managed `database.rules.json`) are hard-refused and name the real source to edit, and a SHADOW COPY — a file whose path mirrors one the installed framework ships through its override layer — is refused with the upstream-first message. Two exits for the shadow case, both deliberate: file the framework issue, or declare the override with `omega:consumer-override: <reason>` in the file's first five lines (`OMEGA_CONSUMER_OVERRIDE=1` skips it for one session). `omega customize` already writes that marker into what it materializes, so the sanctioned copy needs nothing from you. Your pages under `src/pages/`, your `src/assets/css/main.scss` and `src/assets/js/main.js`, and your backend's `src/index.js` and `firestore.rules` are yours and are never guarded. The checklist line the hook cannot check for you: **a hand-written rule or template that fills a framework hole is a framework issue, not a brand patch.**

## Hard rules

- **Never edit generated output**: `dist/`, `packaged/`, anything gitignored. Edit `src/`, run the build.
- **Never edit `node_modules/`** — framework bugs get fixed in the framework.
- **Secrets never enter omega.json5** — `.env` / `.omega/secrets/` only.
- **Deploys are deliberate**: only `omega deploy` publishes. Commits and pushes never auto-publish. A brand whose folder is NESTED inside another git repo, or whose `@omega.js/*` deps are `file:` links, publishes through the snapshot lane: the verb pushes the brand folder (packed tarballs included) to the brand repo and dispatches the workflow there, so the runner installs what this machine has ([#872](https://github.com/Omega-JS-Stack/omega/issues/872), [../shared/deploys.md](../shared/deploys.md)). An ORG-owned public brand with a desktop target also needs "Allow public repositories" on the org's Actions runner group, which the manage walk checks and fails loudly on ([repo.md](repo.md)).
- **Don't start long-running dev processes the user may already be running** (`npm run dev`, emulators) — assume theirs is up and GREP THE LOGS; every surface already wrote its output to disk.
- **Framework-owned file sections** (marked `Default Values` / `OMEGA Rules` blocks) are rewritten by the target's own verbs when they scaffold — put customizations in the marked custom sections only. One exception, by design: a backend target's `firestore.rules` is YOURS end to end — it is compiled with the framework half into `dist/firestore.rules` (never edit that), and a match block you write whose path names a framework block's is MERGED into it (your condition ANDs onto the framework's, for every op you both name), which is how the brand tightens a framework rule. See [docs/backend/index.md](../backend/index.md) § Firestore rules.
