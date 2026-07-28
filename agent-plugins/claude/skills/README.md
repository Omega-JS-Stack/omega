# Skills — the authoring contract

One directory per skill, holding a `SKILL.md`. The directory name and the frontmatter `name` must match exactly, and both are BARE — no namespace. The plugin supplies the namespace, so `skills/web` surfaces in a session as `omega:web`.

The roster follows the packages a session works in: `main` (the hub) plus `web`, `backend`, `desktop`, `extension`, `client`, and `manager`.

```
skills/
└── <name>/
    └── SKILL.md
```

## Frontmatter

```yaml
---
name: <name>
description: <what it covers> - <when to use it, with the trigger words>
user-invocable: true
---
```

The `description` is the whole loading decision — it is the only part Claude reads before choosing to load the skill, so it carries both halves: what the skill knows, and the phrases that should pull it in.

## The body points; the repo docs are the source

A skill is a router. It names where the truth lives for BOTH worlds — `docs/<framework>/index.md` plus `docs/shared/` when the session is in this monorepo, the top-level map through `node_modules/@omega.js/AGENTS.md` (the scope symlink the workspace service maintains) plus `docs/manager/brand.md` when the session is in a consumer project — and carries only what a session needs before it knows which document to open: the hard rules, the shape of the thing, and the paths.

Content copied out of the docs into a skill is a second home for the same fact, and the copy is what goes stale. Point instead.

## Keeping it honest

Every skill has to be checkable against the code it describes. Prefer claims a test can verify — an exported name, a config key, a CLI command, a file path — over prose that can drift without any signal. See the "staleness mechanism" section in the plugin README.
