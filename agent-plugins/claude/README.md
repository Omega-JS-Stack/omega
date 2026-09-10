# OMEGA — the Claude plugin

OMEGA's knowledge for Claude sessions, shipped as a Claude Code plugin from the monorepo that holds the code it describes. Install it and any session working on an OMEGA project gets the current conventions, without the knowledge living in any one developer's personal harness.

## Why it lives here

A skill kept anywhere else is a hand-maintained pointer into a repo that moves on its own schedule — nothing makes the two agree, and nothing notices when they stop. A skill that ships beside the code is version-matched by construction, and it is the same commit that changes the framework and the sentence describing it.

## Install

In this monorepo, install is automatic: the committed `.claude/settings.json` registers the repo-root marketplace (`.claude-plugin/marketplace.json`, relative path) and enables `omega@omega` — Claude Code asks one trust question on first open, then the plugin loads every session. For any other checkout, the manual form:

```sh
claude plugin marketplace add <path-to-this-monorepo-checkout>
claude plugin install omega@omega
```

Plugins load at startup, so a new (or restarted) session — or `/reload-plugins` — is what puts a change into effect. Installed plugins are cache copies; live plugin development runs `claude --plugin-dir ./agent-plugins/claude` instead.

A marketplace added from a local path is read in place — nothing is cloned, so living in a monorepo costs a local install nothing. Installing from GitHub is what makes repo size matter, and the marketplace entry switches to the `git-subdir` source for that: a url plus `"path": "agent-plugins/claude"`, which Claude Code fetches with a sparse partial clone rather than pulling the whole monorepo. Make that change when the plugin is first installed from a remote, not before — the relative `./agent-plugins/claude` source is the right one while every install is local.

## Layout

```
agent-plugins/
└── claude/
    ├── .claude-plugin/plugin.json   the manifest
    ├── .mcp.json                    the one MCP declaration — the @omega.js/mcp-router endpoint
    ├── README.md                    this file
    ├── hooks/                       hooks.json, the inject/gate/guard/shape/quality hooks, and lib/ (the shared scope guard, skill map, and gate-marker naming)
    └── skills/                      the skills, one directory each (see skills/README.md)
```

`agent-plugins/` is the parent for every coding agent OMEGA ships knowledge to, and `claude/` is the Claude Code one. A second provider gets a sibling directory rather than a rearrangement.

Structure is validated by `scripts/agent-plugins.test.js` at the monorepo root, which runs in `npm test`.

## The inject hook

The plugin carries the mechanism that loads its own skills. `hooks/inject/run.sh` runs on every prompt (`UserPromptSubmit`), reads the project's `package.json` — the working directory's own, else the nearest one up to the git root — and asks the session to invoke the skill for the framework it finds:

| package | skill |
|---|---|
| `@omega.js/web` | `omega:web` |
| `@omega.js/backend` | `omega:backend` |
| `@omega.js/desktop` | `omega:desktop` |
| `@omega.js/extension` | `omega:extension` |
| `@omega.js/manager` | `omega:manager` |
| `@omega.js/client` | `omega:client` — the project's own `name` only |
| `omega` (the monorepo root) | `omega:main` — the project's own `name` only |

Every row also matches the manifest's own `name`, which is what covers working inside a `packages/<pkg>` directory in this monorepo. `@omega.js/client` is the exception the other way: the runtime is embedded by web, desktop, and extension, so a dependency on it says nothing about what the session is working on — only being the package asks for its skill.

**At a brand root, the nearest manifest is not the answer.** It carries `@omega.js/manager` alone, so a session at a brand root used to hear about the manager and nothing about the targets it was there to build. The hook now recognizes a brand — a directory carrying `config/omega.json5`, or one whose manifest depends on `@omega.js/manager`, found by walking up to the git root — and reads the level below it: `config/omega.json5`'s `targets` keys AND every `targets/*/package.json` (plus the `functions/package.json` a Firebase backend keeps its framework in). The whole set comes back at once: `omega:main` and `omega:manager` always, plus one `omega:<framework>` per target. A target no framework owns (`type: 'custom'`) and `mobile` (parked) map to nothing.

A brand injection also names the framework map — the brand `AGENTS.md` import line, `node_modules/@omega.js/AGENTS.md` — as required reading BEFORE the first edit, which is what the gate hook below enforces.

Each skill is asked for once per session per SKILL (a marker file under `TMPDIR`, keyed on the session id), so a target that appears mid-session still gets its own line while the skills already asked for stay quiet. The hook fails open — no `package.json`, unparseable JSON, an unreadable config, no `jq`, and it exits silently without touching the prompt. Behavior is covered by the inject cases in `scripts/agent-plugins.test.js`, which run the script directly against fixture projects.

## The gate hook

Injecting a line only SUGGESTS a skill, and a session that skipped the line built a whole `targets/website` app without ever loading `omega:web` — hand-rolled markup, and a documented validator rule filed as a framework bug. So the skills are enforced. `hooks/gate/run.sh` serves two events from one script — the surface question has ONE answer — and refuses a write to a surface whose skill was never invoked:

| Surface written or edited | Gated on |
|---|---|
| `<brand>/targets/<t>/**` | that target's framework skill, read from its own `package.json` (a custom target gates on nothing) |
| `<brand>/config/omega.json5` | `omega:manager` — the file the manage walk reconciles |
| `<monorepo>/packages/<pkg>/**`, where the manifest IS `@omega.js/<pkg>` | that package's skill: `omega:web`, `omega:backend`, `omega:desktop`, `omega:extension`, `omega:client`, `omega:manager` |
| a WEB theme surface, on top of the row above: the packaged `themes/**`, a website target's `themes/**` or `src/themes/**`, its `src/_sections/**` and `src/_components/**` (one override lane), and its `src/assets/css/main.scss` | `omega:theme` IN ADDITION to that surface's own skill — the cascade has its own contract, and it is a web mechanism, so a `themes/` dir in a backend target is not one |

A surface can therefore answer with MORE than one skill, and the gate refuses until EVERY one of them has been invoked — a half-loaded theme edit is refused naming only what is still missing. The inject hook wires none of this: it answers "what does this PROJECT run?" from manifest deps and config target keys, never from a path, so a skill that fires on a surface rather than a package has nothing to add there.

Everything else is free: docs, scripts, the plugin's own files, a brand's root files, a `packages/` directory in somebody else's repo, and every internal package with no skill (`devkit`, `config`, `account`, `analytics`, `monitoring`, `template-kit`, `mcp-router`). Read-only tools are never in scope — the matcher is `Write|Edit`, so reading the code before loading the skill is exactly right.

On `PostToolUse` (matcher `Skill`) the hook records every skill the session invoked, in either spelling — the namespaced `omega:web` or the bare `web` the plugin namespaces. On `PreToolUse` (`Write|Edit`) an unrecorded surface exits 2 with the skill to invoke, so the model is told what to do rather than what it did wrong. Markers live under `TMPDIR/omega-gate`, keyed on the session id.

**Two lanes record the read, and only two.** In the main chat the agent has a Skill tool, so invoking `omega:web` records itself and nothing else is needed. An agent with NO Skill tool (the workkit worker class writes its files through Bash, which a `Write|Edit` matcher never sees) reads the guide its brief names, then runs the ONE sanctioned command: `hooks/gate/mark.sh omega:web` (either spelling the Skill event takes, `omega:web` or bare `web`), which writes the same marker through the same lib (`hooks/lib/omega-gate.sh`) and prints the path it wrote. The script lives at `agent-plugins/claude/hooks/gate/mark.sh` in this monorepo and at `node_modules/@omega.js/manager/claude-plugin/hooks/gate/mark.sh` in a brand on a published install. It takes the session id from `--session <id>` when given (explicit beats ambient), else from `$CLAUDE_SESSION_ID`, else `$CLAUDE_CODE_SESSION_ID`; with none it exits 1 with its usage. Writing a marker by hand, or running `mark.sh` before reading the guide, is a process breach rather than a third lane: the gate is a reading contract, not a lock to pick, and the verifier checks that the worker's report names the guide it read. The gate itself stays a MAIN-CHAT guard on purpose: it does not try to match the paths a heredoc, `sed`, or a python one-liner targets, because best-effort path parsing misses more than it catches ([#760](https://github.com/Omega-JS-Stack/omega/issues/760)).

The gate and the inject hook read ONE table: `hooks/lib/omega-skills.sh`, which owns the framework → skill map, the brand walk, the JSON5 target-key scan, and the surface lookup — so the hook that ASKS for a skill and the hook that REFUSES an edit without it agree on the map itself. They can still ask different questions of it: inject reads the config's target keys too, while the gate resolves a target from its own manifest alone, so a target declared in `omega.json5` before its directory exists is asked for and not gated. That is fail-open by design — the gate refuses only what it can positively identify. Fail-open throughout: no `jq`, an unreadable manifest or config, an unusable marker directory, and the gate lets the write through. Covered by the gate cases in `scripts/agent-plugins.test.js`.

## The guard hook

The gate makes a session READ the framework docs; the guard makes it act on them. `hooks/guard/run.sh` runs on `PreToolUse` (`Write|Edit`) beside the gate and refuses an edit to a framework-owned file inside a CONSUMER BRAND — the upstream-first rule as a mechanism, because "a framework hole gets a framework issue, never a consumer patch" had to be restated three times in one migration session before the hand-written rules and templates stopped landing ([#452](https://github.com/Omega-JS-Stack/omega/issues/452)). Two classes:

| Class | What it catches | Escape |
|---|---|---|
| 1. Generated or vendored | any path under `node_modules/`, any `dist/` tree, a file whose first 20 lines say `GENERATED FILE` + `DO NOT EDIT` or `Generated by @omega.js/`, and `database.rules.json` (the OMEGA-managed rules block) | none — the message names the real source to edit instead (the config, the build source, the brand's own `firestore.rules`) |
| 2. Shadow copies | a brand file whose path mirrors a file the installed framework ships through its OVERRIDE LAYER | `omega:consumer-override: <reason>` in the file's first 5 lines, in any comment syntax (`//`, `#`, `<!--`, `{#`, `/*`), or `OMEGA_CONSUMER_OVERRIDE=1` for the session |

The shadow map is read from the LIVE install (`<brand>/node_modules/@omega.js/<framework>/`), never a hardcoded list, so the knowledge matches the version the brand actually runs. ONE table in the hook holds the lookup roots — `<framework>|<consumer prefix, relative to the target root>|<framework root>`, one row per real override-layer root:

| Framework | Consumer prefix | Framework roots |
|---|---|---|
| `web` | `src/_layouts/` | `core/_layouts/`, `themes/*/_layouts/` |
| `web` | `src/_includes/` | `core/_includes/`, `themes/*/_includes/` |
| `web` | `src/_sections/` | `themes/*/_sections/` |
| `web` | `src/_components/` | `themes/*/_components/` |
| `web` | `src/assets/css/` | `core/css/`, `themes/*/css/` |
| `backend` | `src/routes/` | `src/manager/routes/` |
| `backend` | `src/schemas/` | `src/manager/schemas/` |
| `backend` | (the target root) | `templates/` |

The web rows mirror `packages/web/src/overrides.js` `overrideLanes()` (sections, includes, css) plus the engine's layered `_layouts`: the MECHANISM lanes, where first-layer-wins resolution means a consumer file genuinely takes the framework's place. Sections sit in the theme layers only, because core ships none. The backend rows are the two lanes that really replace a framework file BY NAME — `packages/backend/src/manager/index.js` resolves a consumer route or schema of the same name and method over the framework's — plus the framework half of the rules that ships in `templates/`.

**Pages are never guarded.** `src/pages/` is CONTENT: the designed place for a brand to write its own homepage, about page and pricing page, whether or not the framework ships a default of that name. There is no `defaults/` row and no page row. **There is no js row either**, because page and layout modules are a UNION ([#624](https://github.com/Omega-JS-Stack/omega/issues/624) — every layer's file runs, in layer order) rather than a shadow, so a brand's `src/assets/js/pages/blog.js` replaces nothing.

Two exemption sets, both by name and both traceable to a document:

- **The consumer's own entry files**, which the docs hand to the brand outright: `src/assets/css/main.scss` ([docs/shared/theming.md](../../docs/shared/theming.md) § Consumer customization, tier 1), plus `src/assets/js/main.js` and `src/assets/js/first-paint.js` ([docs/web/index.md](../../docs/web/index.md) — the one REPLACE-with-extend lane, where a consumer file reaches the framework's through `omega:main`). Owning one of those IS the documented recipe, so the guard never asks about it.
- **The backend seeds** the target checks (`omega test`) write once and the brand owns from then on, each healed by a check in `@omega.js/backend`'s `src/cli/commands/setup-tests/`: `firestore.rules`, `storage.rules`, `firebase.json`, `firestore.indexes.json`, `remoteconfig.template.json`, `public/`, `config/`, and `storage-lifecycle-*.json`.

**Desktop and extension have no rows at all**, and that is a finding rather than an omission: neither framework ships an override layer. Their `src/defaults/` tree is scaffolded ONCE and the brand owns every file in it afterwards — `src/main.js`, `gulpfile.js`, `hooks/build/pre.js` are yours by design — so there is nothing there for a brand file to shadow.

`omega customize` closes the loop from the other side: materializing a file writes the `omega:consumer-override:` marker into its own provenance header (`packages/web/src/overrides.js` `provenanceHeader()`), so the sanctioned way to take a copy produces a file the guard already accepts.

The monorepo itself is exempt — `packages/` is the framework's own source and `brands/` are the crew's fixtures — found by walking to the git root for a manifest named `omega` beside a `packages/` directory, which is what keeps a brand fixture from answering first. Everything else fails open: no `jq`, no brand root, no framework in the target's manifest, no install to read, and the write goes through. Covered by the guard cases in `scripts/agent-plugins.test.js`.

## The quality hook

The four quality skills do not wait to be remembered. `hooks/quality/run.sh` serves two events from one script — so the surface table has one home — and fires them off the files a session actually edits:

| Surface written or edited | Skills asked for |
|---|---|
| a page (`*/pages/*.html`, `*/pages/*.md`), a layout, a `.liquid` template | `omega:seo`, `omega:accessibility` |
| the core head/foot chrome | `omega:seo`, `omega:accessibility` |
| an include, section, or component partial; page/core JS | `omega:accessibility` |
| `.scss` / `.css` | `omega:accessibility`, `omega:brandcheck` |
| `omega.json5`, section data JSON, a section schema | `omega:brandcheck` |
| a web flow page or auth module (`*/core/js/pages/*`, `*/core/js/libs/auth/*`) | `omega:analytics` (plus `omega:accessibility` from the core-JS row) |
| a backend payment route, payments-webhook or auth event | `omega:analytics` |
| the analytics package itself (`*/packages/analytics/*`) | `omega:analytics` |

On `PostToolUse` (Write|Edit) a match names its skills once per session per skill and records the file. On `Stop` the recorded list comes back as a block: the surfaces edited this session, the checklists they owe, and a refusal to sign off on an unreviewed pass. The block runs once per batch of edits (the list clears, so a later edit re-arms it) and never inside its own turn (`stop_hook_active`). Same scope guard as the shape hook, literally: both source `hooks/lib/omega-scope.sh`, which walks up from the edited file to the nearest `package.json` (stopping at the git root) and answers whether that project is or depends on `@omega.js/*`. The inject hook asks a different question — a project from a cwd, with its `functions/` manifest joined in — and keeps its own walk. Fail-open throughout. Covered by the quality cases in `scripts/agent-plugins.test.js`.

## What is here, and what is not built yet

Thirteen skills — `main` (the hub: the package roster, the docs topology, the brand map, where project state lives), one router per package a session works in (`web`, `backend`, `desktop`, `extension`, `client`, `manager`), `browser` (driving the MCP router's Chrome upstreams), the four quality checklists (`seo`, `accessibility`, `brandcheck`, `analytics`) the quality hook fires on the surfaces they own, and `theme` (the cascade's own checklist), which the GATE fires on the theme surfaces in the table above rather than the quality hook. Each one names where the knowledge lives, in the monorepo and in a consumer project, and carries only the handful of rules a session needs before it knows which document to open. One thing is still open.

**The staleness mechanism.** This is the point of the move, not a bonus. Whatever ships needs something that fails when a skill names an export, a path, a config key, or a CLI command the code no longer has. A test in this repo is the strongest form; a generated section is next; a review trigger tied to a release is the floor. A plugin that goes stale quietly has only relocated the problem.
