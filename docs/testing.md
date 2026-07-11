# Test scoping (`omega test`) — the C5 grammar

One grammar, every framework (parser: `@omega.js/devkit/test/scope`, adopted by the devkit runner-core → desktop + extension, the backend runner, and web's test command). Decided by Ian 2026-07-11 (core-changes inbox C5): **a bare test run from a brand/app never drags the framework's suite in** — the framework suite is always an explicit choice.

## Grammar

| Target | Runs | Notes |
|--------|------|-------|
| *(bare)* | **project tests only** | consumer default; `pages/x` = project tests under that path |
| `project:` / `brand:` | project tests only | explicit spelling; optional path: `project:auth/` |
| `framework:` / `omega:` / `mgr:` | the framework's own suite | universal aliases |
| `backend:` `web:` `desktop:` `extension:` (+ legacy `em:` `bxm:` `ujm:`) | the framework's own suite | per-framework ids |
| `full:` | both sources | optional path applies to both: `full:auth` |

- Paths after a prefix scope within that source: `framework:routes/general`, `project:checkout`.
- Unknown prefixes (`framwork:x`) warn and are ignored — never silently match nothing.
- Multiple targets union sources; each path binds to its own source.

## The self-test exception

Inside a framework package itself (cwd package name === the framework), a bare run means the framework's own suite — each package's `npm test` keeps meaning "run my suite". Consumer context is what flips to project-only.

## Corpus spelling

The sandbox brand's backend corpus is the framework suite run in consumer context — its scripts say so explicitly since cp94: `npx omega test framework:` ([apps/sandbox-brand/apps/backend/package.json](../apps/sandbox-brand/apps/backend/package.json)).

## Per-framework notes

- **web** — project scope = production build + smoke checks + consumer `test/`; `framework:` runs @omega.js/web's own `node --test` suite (shipped with the package).
- **backend** — framework source = the routes/events/rules corpus (boot/ stays self-test-only); project source = `<project>/test`. Filters are prefix-stripped centrally, so `framework:routes/general` and a bare `general/` (project) match within their own trees only.
- **desktop / extension** — runner-core handles sources + layers (`--layer build|main|renderer|boot` etc. unchanged, orthogonal to scoping).

## Not yet (cp94b)

Brand-ROOT dispatch (`npx omega test` at the brand root fanning out over `apps/*`) lands with the omega-bin brand-root detection + the manager's test command — this doc gains that section then.
