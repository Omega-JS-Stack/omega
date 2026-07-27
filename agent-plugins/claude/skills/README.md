# Skills — the authoring contract

One directory per skill, holding a `SKILL.md`. The directory name and the frontmatter `name` must match exactly, and both are BARE — no namespace. The plugin supplies the namespace, so `skills/ujm` surfaces in a session as `omega:ujm`.

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

A skill is a router. It names where the truth lives — `packages/<name>/docs/<topic>.md`, the package's own `AGENTS.md` — and carries only what a session needs before it knows which document to open: the hard rules, the shape of the thing, and the paths.

Content copied out of the docs into a skill is a second home for the same fact, and the copy is what goes stale. Point instead.

## Keeping it honest

Every skill has to be checkable against the code it describes. Prefer claims a test can verify — an exported name, a config key, a CLI command, a file path — over prose that can drift without any signal. See the "staleness mechanism" section in the plugin README.
