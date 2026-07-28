---
name: web
description: Router for @omega.js/web — the Eleventy 3 + LiquidJS website framework: layered themes, the section/component library, default pages, the asset pipeline, and the omega CLI. - Use when working on a brand's website app or on the web framework itself. Triggers on "@omega.js/web", "omega web", "website app", "apps/website", "Eleventy", "eleventy.config", "LiquidJS", "liquid template", "section", "component", "{% section %}", "composition", "section schema", "theme", "classy", "newsflash", "neobrutalism", "layer", "layered layout", "blueprint", "default page", "omega customize", "omega dev", "omega build", "omega migrate", "omega translate", "omega purge", "PurgeCSS", "esbuild", "sass", "--omega-* token", "design token", "permalink", "page frontmatter", "collections", "posts", "pricing", "service worker", "verts", "ads", "targets.web", or any work in a website app's src/pages/, src/assets/, or the framework's packages/web/.
user-invocable: true
---

# OMEGA Web (@omega.js/web)

`@omega.js/web` builds a brand's marketing site and authenticated frontend: Eleventy 3 + LiquidJS with `@omega.js/template-kit`, layered themes that override by path with zero copying, the section/component library, ~60 virtual default pages, the esbuild/sass/PurgeCSS asset pipeline, and an ESM boot runtime that hands every page the `@omega.js/client` singleton. It ships the `omega` CLI for the whole consumer lifecycle. It is the UJM successor, rebuilt rather than ported — never carry a Jekyll-era assumption into it.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/web/index.md` is the guide (identity, module map, CLI, conventions). Its deep references: `docs/web/sections.md`, `docs/web/omega-sections-spec.md`, `docs/web/template-kit.md`, `docs/web/ads-system.md`, `docs/web/classy-v2/DIRECTION.md`. Cross-framework contracts live in `docs/shared/` (config, theming, icons, translation, testing, deploys, updates, local-dev). Long-form package detail is `packages/web/README.md`.
- **Working in a consumer project** — `node_modules/@omega.js/web/AGENTS.md` and follow its pointer. In the local era that path is a symlink into this monorepo, so the chain resolves to the live guide; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).
- **`@omega.js/client` comes with it.** The client singleton ships into every page, so any task touching auth, Firestore, subscriptions, notifications, or `data-omega-bind` is client work too — `docs/client/index.md` and the `omega:client` skill.

## Non-negotiables

- **Read the guide before editing.** Layers, the frontmatter allow-list, and the section contract each have rules that are not guessable from the file tree.
- **🚫 Never run a consumer's `omega dev`** — it is the user's long-running process. Assume it is up; ask the user to start it if it is not.
- **Consumer page frontmatter is meta-only** and content keys are stripped with a build warning. Content belongs in sections.
- **Secrets never enter `config/omega.json5`** — `.env` only; the config validator hard-fails secret-shaped keys.
- **Nothing generated is committed** — `dist/` and `.omega/` are artifacts. The translation cache is the one deliberate exception.
