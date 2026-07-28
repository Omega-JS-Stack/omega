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
    ├── hooks/                       hooks.json + the inject hook that loads a skill
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

Each skill is asked for once per session (a marker file under `TMPDIR`, keyed on the session id). The hook fails open — no `package.json`, unparseable JSON, no `jq`, and it exits silently without touching the prompt. Behavior is covered by the inject cases in `scripts/agent-plugins.test.js`, which run the script directly against fixture projects.

## What is here, and what is not built yet

Eight skills — `main` (the hub: the package roster, the docs topology, the brand map, where project state lives), one router per package a session works in (`web`, `backend`, `desktop`, `extension`, `client`, `manager`), and `browser` (driving the MCP router's Chrome upstreams). Each one names where the knowledge lives, in the monorepo and in a consumer project, and carries only the handful of rules a session needs before it knows which document to open. One thing is still open.

**The staleness mechanism.** This is the point of the move, not a bonus. Whatever ships needs something that fails when a skill names an export, a path, a config key, or a CLI command the code no longer has. A test in this repo is the strongest form; a generated section is next; a review trigger tied to a release is the floor. A plugin that goes stale quietly has only relocated the problem.
