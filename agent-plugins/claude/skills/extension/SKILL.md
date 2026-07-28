---
name: extension
description: Router for @omega.js/extension — the cross-browser MV3 extension framework: per-context Manager singletons, the component architecture, cross-context auth sync, auto-translation, and the multi-browser package/publish pipeline. - Use when working on a brand's extension app or on the extension framework itself. Triggers on "@omega.js/extension", "omega extension", "extension app", "apps/extension", "chrome extension", "firefox extension", "MV3", "manifest.json", "manifest v3", "background service worker", "popup", "options page", "sidepanel", "content script", "offscreen document", "chrome.runtime", "chrome.storage", "chrome.tabs", "cross-context auth", "syncAuth", "packaged/", "gulp", "webpack", "_locales", "auto-translation", "build hook", "build:pre", "build:post", "OMEGA_BUILD_MODE", "OMEGA_IS_PUBLISH", "chrome web store", "store publish", "targets.extension", or any work in an extension app's src/views/, src/assets/js/components/, or packages/extension/.
user-invocable: true
---

# OMEGA Extension (@omega.js/extension)

`@omega.js/extension` builds cross-browser MV3 extensions (Chrome, Firefox, Edge, Opera, Brave): a one-line-import bootstrap per extension context, a component-based architecture across background, popup, options, sidepanel, content, pages, and offscreen, cross-context auth synchronization with the background service worker as the source of truth, auto-translation across 16 languages, a gulp/webpack build into `packaged/<browser>/`, and a four-layer test framework. It is the BXM successor.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/extension/index.md` is the guide (per-context singletons, the component table, auth sync, build system and modes, themes, defaults, translations, hooks, environment detection, the CLI table). The per-subsystem meat lives in `packages/extension/docs/*.md`. Cross-framework contracts live in `docs/shared/` (config, theming, icons, translation, testing, deploys, updates, local-dev).
- **Working in a consumer project** — read `docs/extension/index.md` in the framework monorepo (the local era links `node_modules/@omega.js/extension` straight into it; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).
- **`@omega.js/client` comes with it.** The client singleton runs in every context, so any task touching auth, Firestore, subscriptions, notifications, or `data-omega-bind` is client work too — `docs/client/index.md` and the `omega:client` skill.

## Non-negotiables

- **Read the guide before editing.** Which context owns a concern — background is the auth source of truth, everything else reflects it over `chrome.runtime` messaging — is the first thing to get right.
- **Gate behavior on the intentional environment check** (`isProduction()`, or `isDevelopment() || isTesting()`) — never `!isDevelopment()`.
- **Secrets never enter `config/omega.json5`** — `.env` only; the config validator hard-fails secret-shaped keys.
- **Deploys are deliberate** — only `omega deploy` (and an explicit `OMEGA_IS_PUBLISH` run) reaches a store; a commit never does (`docs/shared/deploys.md`).
