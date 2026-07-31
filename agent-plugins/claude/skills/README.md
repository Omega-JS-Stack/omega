# Skills — the authoring contract

One directory per skill, holding a `SKILL.md`. The directory name and the frontmatter `name` must match exactly, and both are BARE — no namespace. The plugin supplies the namespace, so `skills/web` surfaces in a session as `omega:web`.

The roster follows the packages a session works in: `main` (the hub) plus `web`, `backend`, `desktop`, `extension`, `client`, and `manager` — plus `browser`, which is not a package router but the usage pattern for the plugin's one MCP declaration, the `@omega.js/mcp-router` endpoint.

Three more are checklists rather than routers, and the quality hook fires them on the surfaces they own (the table is in the plugin README):

| Skill | The checklist |
|---|---|
| `seo` | A page's search surface: meta title/description, canonical + social tags, structured data, one h1, sitemap/robots, link shape |
| `accessibility` | Front-end surfaces: landmarks and heading order, alt text, control names, color through the tokens, focus visibility, reduced motion |
| `brandcheck` | Config and copy consistency: brand facts read from omega.json5, one brand hex, the merge chain, no secrets in config |

```
skills/
└── <name>/
    └── SKILL.md
```

## Frontmatter

```yaml
---
name: <name>
description: <when to use it — one sentence, 300 characters or less>
user-invocable: true
---
```

The `description` is the whole loading decision — it is the only part Claude reads before choosing to load the skill — and every skill's sits in EVERY session, so it is a shared context budget. One tight sentence naming WHEN to invoke this skill: the package, the surfaces, the situations. Nothing about what the skill knows — the body and the docs carry that. `scripts/skill-descriptions.test.js` fails the structure lane on anything over 300 characters.

## The body points; the repo docs are the source

A skill is a router. It names where the truth lives for BOTH worlds — `docs/<framework>/index.md` plus `docs/shared/` when the session is in this monorepo, the top-level map through `node_modules/@omega.js/AGENTS.md` (the scope symlink the workspace service maintains) plus `docs/manager/brand.md` when the session is in a consumer project — and carries only what a session needs before it knows which document to open: the hard rules, the shape of the thing, and the paths.

Content copied out of the docs into a skill is a second home for the same fact, and the copy is what goes stale. Point instead.

## Keeping it honest

Every skill has to be checkable against the code it describes. Prefer claims a test can verify — an exported name, a config key, a CLI command, a file path — over prose that can drift without any signal. See the "staleness mechanism" section in the plugin README.
