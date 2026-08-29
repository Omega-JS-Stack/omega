---
name: client
description: Use when working in @omega.js/client or on any frontend behavior it owns — the runtime singleton, auth state, data-omega-bind bindings, the Firestore, storage, notifications and Sentry modules, omega.request(), verts, icons, motion, or anything in packages/client/.
user-invocable: true
---

# OMEGA Client (@omega.js/client)

`@omega.js/client` is the runtime singleton every frontend framework embeds — `@omega.js/web` ships it into each page, `@omega.js/desktop` runs it in the renderer, `@omega.js/extension` runs it in every context. One `import omega from '@omega.js/client'` returns the same already-initialized `Manager`, owning storage, auth, bindings, firestore, notifications, service-worker, sentry, dom, utilities, device, request, and verts, alongside the transport-free `icon-core`, `icon-renderer`, and `motion` modules the frameworks boot themselves. It is a library, not an app: real behavior is proved from inside a consuming framework.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/client/index.md` is the guide (identity, the module list, file conventions). The meat lives in `packages/client/docs/*.md`: architecture, modules, bindings, code-patterns, common-tasks, build-system, cdp-debugging, testing. Cross-framework contracts live in `docs/shared/`.
- **Working in a consumer project** — read `docs/client/index.md` in the framework monorepo (the local era links `node_modules/@omega.js/client` straight into it; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64))). Consumer-side work is normally routed by the embedding framework's skill — `omega:web`, `omega:desktop`, or `omega:extension` — with this one for the runtime's own behavior.

## Non-negotiables

- **Singleton, always.** Never `new Manager()`, never pass the instance through function params or module-level variables.
- **Keep Firebase imports lazy** — the dynamic imports are what keeps consumer bundles small; do not convert them to static imports.
- **`resolveSubscription()` stays unified with `@omega.js/backend`'s `User.resolveSubscription()`** — subscription-state logic is identical frontend and backend, so a change here is a cross-stack change.
- **The runtime is what makes the page paint contract possible** — bindings fill at auth settle, `bindings.update()` defers by ROOT key, and `FormManager`'s gates hold a submit control until its answers land. Read `docs/web/page-contract.md` before changing any of the three.
- **Prove changes from a consumer.** `npm run prepare` plus the package tests are necessary, not sufficient; verify end to end inside a linked web, desktop, or extension app (`docs/shared/local-dev.md`).
