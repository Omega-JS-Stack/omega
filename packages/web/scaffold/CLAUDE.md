# ========== Default Values ==========
# @omega.js/web — consumer project

## Framework

This project consumes **@omega.js/web** — the OMEGA web framework (Eleventy 3 + LiquidJS). It ships ~60 default pages as virtual templates (nothing copied into this repo), layered themes with zero file copying, a `page.resolved` data cascade, the esbuild/sass/PurgeCSS asset pipeline, and an ESM boot runtime around the @omega.js/client singleton.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, read the framework documentation:**
- **`node_modules/@omega.js/web/README.md`** — architecture, engine facts, conventions

## Quick start

```bash
npm start           # omega dev: dev server (Eleventy watch + asset rebuild)
npm run build       # omega build: production build → dist/
npm test            # omega test: production build + smoke checks + test/
npm run deploy      # omega deploy: build → `npu sync --message='Deploy'`
npx omega setup     # re-scaffold defaults + sync package.json scripts
npx omega clean     # remove dist/ and .omega/
```

## Project layout

- `src/pages/` — your pages (frontmatter-only files override same-URL default pages)
- `src/_posts/` — blog posts (`YYYY-MM-DD-slug.md`)
- `src/_layouts/` — consumer-local layouts (top layout layer)
- `src/assets/js/pages/`, `src/assets/css/pages/` — per-page modules/styles (layered over theme + core)
- `config/omega.json5` — the ONE config file (never put secrets here — use `.env`)
- `dist/`, `.omega/` — build output + machinery (gitignored, never edit)

## Rules

- Only work in `src/` and `config/` — never `dist/`, `.omega/`, or `node_modules/`.
- Framework defaults (this file's Default section, `.gitignore`, `.env`, CI workflow) are re-synced by `omega setup` — customize below the Custom marker only.

# ========== Custom Values ==========
<!-- Add your project-specific notes below this line -->
