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
    ├── README.md                    this file
    ├── hooks/                       hooks.json + the inject hook that loads a skill
    └── skills/                      the skills, one directory each (see skills/README.md)
```

`agent-plugins/` is the parent for every coding agent OMEGA ships knowledge to, and `claude/` is the Claude Code one. A second provider gets a sibling directory rather than a rearrangement.

Structure is validated by `scripts/agent-plugins.test.js` at the monorepo root, which runs in `npm test`.

## The inject hook

The plugin carries the mechanism that loads its own skills. `hooks/inject/run.sh` runs on every prompt (`UserPromptSubmit`), reads the project's `package.json` — the working directory's own, else the nearest one up to the git root — and asks the session to invoke the skill for the framework it finds:

| package | skill |
|---|---|
| `ultimate-jekyll-manager` | `omega:ujm` |
| `backend-manager` | `omega:bem` |
| `browser-extension-manager` | `omega:bxm` |
| `electron-manager` | `omega:em` |
| `mobile-app-manager` | `omega:mam` |
| `web-manager` | `omega:wm` — the project's own `name` only |

`web-manager` is the exception: the library is embedded by UJM, BXM, and EM, so a dependency on it says nothing about what the session is working on. Only being the library asks for its skill.

Each skill is asked for once per session (a marker file under `TMPDIR`, keyed on the session id). The hook fails open — no `package.json`, unparseable JSON, no `jq`, and it exits silently without touching the prompt. Behavior is covered by the inject cases in `scripts/agent-plugins.test.js`, which run the script directly against fixture projects.

## What is here, and what is not built yet

Seven skills — `main` (the hub: framework roster, documentation topology, mirror spec, brand-to-repo resolution, global operations) plus one router per framework: `ujm`, `bem`, `bxm`, `em`, `mam`, `wm`. They were ported mechanically from a personal harness, and the injection hook came with them, so the plugin now carries both the knowledge and the mechanism that loads it. Two things are still open.

**The rewrite for the package world.** Every ported skill describes the pre-monorepo world — `ultimate-jekyll-manager`, `backend-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager` as separate repos and separate npm packages, at absolute local paths. That world is gone: the frameworks are now `packages/*` in this repo, published under `@omega.js/*`. The rewrite decides whether the roster follows the packages one-for-one or groups differently — answer it from the package list, not from the old skill names.

**The staleness mechanism.** This is the point of the move, not a bonus. Whatever ships needs something that fails when a skill names an export, a path, a config key, or a CLI command the code no longer has. A test in this repo is the strongest form; a generated section is next; a review trigger tied to a release is the floor. A plugin that goes stale quietly has only relocated the problem.

**The local paths.** The hub skill resolves brand and project names to directories under `ITW-Creative-Works`, which is where this team keeps them. Those absolute paths are part of what the package-world rewrite has to answer for.
