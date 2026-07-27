---
name: ujm
description: UJM frontend patterns and conventions for the ultimate-jekyll-manager framework and its consumer projects. - Use when working with any UJM project. Triggers on "UJM", "Ultimate Jekyll", "create a page", "edit a page", "build a page", "new page", "customize a page", "add a section", "blueprint", "frontmatter", "page.resolved", "uj_icon", "FormManager", "wonderful-fetch", "authorized-fetch", "webManager", "wm-bind", "data-wm-bind", "wm-bindings", "@show auth", "@hide auth", "@text", "purgecss", "purge", "safelist", "SEO", "headline", "sentence case", "action verb", "meta title", "meta description", "$ prefix", "DOM naming", "service pages", "services", "solutions", "alternatives", "competitor comparison", "inline script", "inline scripts", "script tag", "<script>", "page module", "main.js", "init function", "element-existence guard", "Liquid templating in JS", "data-* bridge", "template cloning", "animation studio", "studio", "STUDIO_CLIPS", "animation clips", "demo clips", "audit", "npx mgr audit", "audit the site", "code audit", "full audit", "migrate", "migration", "old format", "config order", "revert posts", "new site", "build out the site", "set up the site", or any work on files in src/pages/, src/assets/js/, src/assets/css/, src/_includes/frontend/, src/_alternatives/.
user-invocable: true
---

# UJM Frontend Patterns

Router skill for **Ultimate Jekyll Manager (UJM)** — a build framework for Jekyll-based marketing sites + authenticated dashboards with webpack/SCSS/Bootstrap, web-manager integration, and theme-adaptive design. Sister project to [BEM](../bem/SKILL.md) (backend), [EM](../em/SKILL.md) (Electron apps), [BXM](../bxm/SKILL.md) (browser extensions) — four mirrored frameworks on one ecosystem, same conventions and config shapes.

## Read these first (SSOT)

This skill points; the repo docs are the single source of truth — they ship with every install and always match the installed version. Read the CLAUDE.md for the context you're in, then the `docs/<topic>.md` files relevant to the task:

- **In a consumer project:** the project's own `CLAUDE.md` (framework section + project notes), then `node_modules/ultimate-jekyll-manager/CLAUDE.md` → `node_modules/ultimate-jekyll-manager/docs/*.md`
- **In the framework repo:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/ultimate-jekyll-manager/CLAUDE.md` → `docs/*.md`
- **web-manager runs on every page** (auth, Firestore, `data-wm-bind`, utilities): `node_modules/web-manager/CLAUDE.md` → `node_modules/web-manager/docs/*.md` (esp. `bindings.md`, `modules.md`)

CLAUDE.md is a table of contents — the meat lives in `docs/`. Always-relevant references: `docs/common-mistakes.md`, `docs/test-framework.md`, `docs/environment-detection.md`, `docs/logging.md`.

## Hard rules

Summaries only — the SSOT for each is the linked doc.

1. 🚫 **NEVER use `npx mgr ...` from the framework repo** — CONSUMER projects only; framework repos use their own `npm` scripts (repo CLAUDE.md § Development Workflow). Applies to ALL four OMEGA frameworks.
2. 🚫 **NEVER run `npm start`** (consumer projects) — it's the user's long-running dev server; assume it's already running, and if it isn't, INSTRUCT the user to start it (don't start it yourself). To see output, read the `logs/*.log` files (`dev.log`, `build.log`, `test.log`) — never tail/attach to the process (`docs/logging.md`). Running `npx mgr test` is fine.
   - **Dev server URL: `https://localhost:4000` — NEVER the LAN IP.** Cert, port discovery (`.temp/_config_browsersync.yml`), and the browser loop: `docs/cdp-debugging.md`.
3. 🚫 **NEVER edit `dist/` or `node_modules/`** — edit `src/`; builds regenerate. For local framework edits use `npx mgr install dev` (`docs/common-mistakes.md`).
4. 🚫 **NEVER set `asset_path` unless sharing a module between pages** — it resolves to an exact `.js` FILE, not a directory's `index.js`. Omit it when JS lives at the default `<pagePath>/index.js`. Wrong `asset_path` fails silently (`docs/jekyll-plugin.md`, `docs/layouts-and-pages.md`).
5. 🚫 **ZERO inline JS in HTML** — no `<script>` bodies in pages/includes/layouts; JS goes in page modules or `main.js` with element-existence guards (`docs/no-inline-scripts.md`).
6. 🚫 **Bootstrap-first; no theme-prefixed classes in markup** — use Bootstrap utilities/components + universal semantic classes; theme SCSS restyles them (`docs/themes.md`, `docs/css.md`).
7. **XSS zero tolerance** — inline `webManager.utilities().escapeHTML(value)` at every sink, `sanitizeURL(url)` for executable URL sinks; never a local helper (`docs/xss-prevention.md`).
8. **web-manager owns Firebase** — `import webManager from 'web-manager'` → `webManager.auth()` / `.firestore()`; no globals, no direct Firebase imports (`docs/javascript-libraries.md`).
9. **Never install framework transitive deps in a consumer** — UJM's webpack `resolve.modules` resolves them (`docs/common-mistakes.md`).
10. **Gate env behavior on the intentional check** — `isProduction()` or `isDevelopment() || isTesting()`, never `!isDevelopment()` (`docs/environment-detection.md`).
11. **Every feature ships tests at every layer it has a surface in, and NEVER mock** — real harness only (`docs/test-framework.md`).
12. **Doc parity on every behavioral change** — README + CLAUDE.md + `docs/<topic>.md` + CHANGELOG, after validation.
13. **The OMEGA docs and skills are structurally MIRRORED** — this skill, the repo's CLAUDE.md, the consumer template (`src/defaults/CLAUDE.md`), and shared-concept doc filenames match the sister frameworks section-for-section, in the same order. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

Ordered checklists — every step's details live in the linked doc. Invoked with an argument naming a process (e.g. `/omega:ujm audit`)? Run that process directly.

### Build a feature
1. Read the relevant `docs/<topic>.md` (find it via the CLAUDE.md index).
2. Implement in `src/` following the conventions there.
3. Confirm the watcher compiled: `tail logs/dev.log` — look for `'sass'/'webpack'/'jekyll' errored` vs `Reloading Browsers...` (`docs/logging.md`).
4. Write tests at every surfaced layer — build / page / boot (`docs/test-framework.md`).
5. Audit doc parity: README, CLAUDE.md, `docs/<topic>.md`, CHANGELOG.

### Create a new page
1. Read `_config.yml` to match brand tone and purpose.
2. Default page exists? Frontmatter-only `.md` with `layout: blueprint/<name>` — read the blueprint first; respect per-page customization levels (`docs/layouts-and-pages.md`).
3. Genuinely custom? `.html` + base layout + `meta.title`/`meta.description` + Bootstrap-first markup (`docs/layouts-and-pages.md`, `docs/css.md`).
4. Content follows the writing rules — action-verb H1s, sentence case, headline/accent structure (`docs/seo.md`).
5. JS goes in `src/assets/js/pages/<pagePath>/index.js` (`docs/no-inline-scripts.md`, `docs/assets.md`); forms use FormManager (`docs/page-loading.md`).
6. Dynamic JS classes? Check the purge safelist (`docs/purgecss.md`).
7. Verify compile via `logs/dev.log`.

### Write SEO/content pages
- Writing rules, Services (3 core pages, nav+footer), Solutions (unlisted long-tail landers), Alternatives (`src/_alternatives/` collection): `docs/seo.md`.

### Author or modify a theme
- Read `docs/themes.md` FIRST — study classy's data contract, write fresh HTML layouts (never copy-and-tweak), no `<themeid>-*` classes in markup.

### Move an inline script
- Follow the step-by-step playbook in `docs/no-inline-scripts.md` — destination rules, Liquid `data-*`/`<template>` bridges, window-global callbacks, verification grep.

### Build out a site (or a scope: defaults / services / solutions / alternatives / nav)
1. Read `_config.yml` for brand identity, purpose, audience.
2. Customize default pages via frontmatter-only `.md` files per the customization-levels table (`docs/layouts-and-pages.md`).
3. Create content pages — Services (3, in nav+footer), Solutions (unlisted), Alternatives (`src/_alternatives/`) (`docs/seo.md`).
4. Nav/footer/account JSON (`docs/assets.md`).
5. Present the plan (which defaults customized, which pages created, rationale) and get approval BEFORE implementing.

### Audit (full project or framework)
- ID'd check catalog — universal U-xx (mirrored across all four frameworks) + UJM-xx + framework-repo F-xx — scope auto-detect, persisted report, severity-ordered TodoWrite fix loop, `npx mgr audit` automated stage: `docs/audit.md`.

### Migrate a legacy site
- Three modes — full (old UJ → latest UJM base via `_legacy/`), quick-fix (`_config.yml` section order), revert-posts (back to old format): `docs/migration.md`.

### Run tests
- `npx mgr test [<path>|mgr:<path>|project:<path>]`, output tees to `logs/test.log`; `--extended` for real external APIs (`docs/test-framework.md`).

### Edit the framework from a consumer
- `npx mgr install dev` (use local UJM source) / `npx mgr install live` (restore published) — designated test consumer + workflow in the framework CLAUDE.md.

### Record animation studio clips
- Consumer supplies ONLY `window.STUDIO_CLIPS` definitions + clip CSS — never touch the studio boilerplate (`docs/animation-studio.md`).
