# ========== Default Values ==========
# @omega.js/web consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework consumer templates (src/defaults/AGENTS.md ×N; web's lives at scaffold/AGENTS.md) with the same sections in the same order (framework-specific extras may be inserted; canonical sections are never reordered/renamed). Edit every framework consumer template together. The mirroring rule lives in each framework guide's Doc-update parity section (docs/<framework>/index.md) -->

## Framework

This project consumes **@omega.js/web**, the OMEGA web framework (Eleventy 3 + LiquidJS). It ships ~60 default pages as virtual templates (nothing copied into this repo), layered themes with zero file copying, a `page.resolved` data cascade, the esbuild/sass/PurgeCSS asset pipeline, and an ESM boot runtime around the @omega.js/client singleton.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, the agent MUST read the framework documentation: that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`**: the OMEGA map, the one agent entry into the framework docs; follow it to `docs/web/index.md` (the @omega.js/web guide: identity, architecture, conventions)
- **the deep references beside that guide** (`docs/web/sections.md`, `docs/web/template-kit.md`, `docs/shared/theming.md`, …): read the relevant ones for the task at hand

## 🚨 READ @omega.js/client TOO

**@omega.js/web boots `@omega.js/client` as a runtime singleton on every page.** It powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with @omega.js/web.

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`** → `docs/client/index.md`, the @omega.js/client guide: identity, module list, conventions
- **`node_modules/@omega.js/client/docs/`**: module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start           # omega dev: dev server (Eleventy watch + asset rebuild)
npm run build       # omega build: production build → dist/
npm test            # omega test: production build + smoke checks + test/
npm run deploy      # omega deploy: commit + push, then dispatch the build workflow (CI publishes)
npx omega clean     # remove dist/ and .omega/
```

## Project layout

- `src/pages/`: your pages (frontmatter-only files override same-URL default pages). `example.md.txt` is a commented walkthrough of meta-only frontmatter and `{% section %}` composition; its `.txt` suffix keeps it out of the build, so copy it to `<name>.md` to start from it
- `src/_posts/`: blog posts (`YYYY-MM-DD-slug.md`)
- `src/_layouts/`: consumer-local layouts (top layout layer)
- `src/assets/js/pages/`, `src/assets/css/pages/`: per-page modules/styles (layered over theme + core)
- `config/omega.json5`: the ONE config file (never put secrets here; use `.env`)
- `dist/`, `.omega/`: build output + machinery (gitignored, never edit)

## Rules

- Only work in `src/` and `config/`, never `dist/`, `.omega/`, or `node_modules/`.
- Framework defaults (this file's Default section, `.gitignore`, `.env`, CI workflow) are re-synced by every omega verb; customize below the Custom marker only.

# ========== Custom Values ==========
<!-- Add your project-specific notes below this line -->
