---
name: client
description: Use when working in @omega.js/client or on any frontend behavior it owns: the browser base class, auth and the User, data-omega-bind bindings, the Firestore, storage, notifications and Sentry modules, omega.request(), verts, icons, motion, or anything in packages/client/.
user-invocable: true
---

# OMEGA Client (@omega.js/client)

`@omega.js/client` exports the browser base class `Omega` and no instance. Each frontend framework subclasses it and exports the one ready-made `omega`: `@omega.js/web/runtime` for every page, `@omega.js/desktop/renderer` in the renderer, and `@omega.js/extension/{popup,sidepanel,options,page}` in the four page contexts. The instance carries storage, auth, bindings, firestore, notifications, serviceWorker, sentry, dom, utilities, device, request, verts, triggers, icons and motion as plain properties (`omega.auth.user`, `omega.utilities.escapeHTML()`), and `omega.auth.user` is always a `User` from `@omega.js/account`. It is a library, not an app: real behavior is proved from inside a consuming framework.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/client/index.md` is the guide (identity, the module list, file conventions). The meat lives in `packages/client/docs/*.md`: architecture, modules, bindings, code-patterns, common-tasks, build-system, cdp-debugging, testing. Cross-framework contracts live in `docs/shared/`.
- **Working in a consumer project** — read `docs/client/index.md` in the framework monorepo (the local era links `node_modules/@omega.js/client` straight into it; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64))). Consumer-side work is normally routed by the embedding framework's skill — `omega:web`, `omega:desktop`, or `omega:extension` — with this one for the runtime's own behavior.

## Non-negotiables

- **One instance per surface, built by its framework.** A consumer never writes `new`; every client module receives the instance in its constructor (`new Auth(omega)`), and nothing imports a live instance from `@omega.js/client`. Accessors are properties, never zero-arg methods.
- **Keep Firebase imports lazy** — the dynamic imports are what keeps consumer bundles small; do not convert them to static imports.
- **The `User` class is shared with `@omega.js/backend`.** `@omega.js/account` owns it: the same getters (`plan`, `active`, `trialing`, `cancelling`, `everPaid`) answer on both sides, so a change to subscription-state logic is a cross-stack change.
- **The runtime is what makes the page paint contract possible** — bindings fill at auth settle, `bindings.update()` defers by ROOT key, and `FormManager`'s gates hold a submit control until its answers land. Read `docs/web/page-contract.md` before changing any of the three.
- **Prove changes from a consumer.** `npm run prepare` plus the package tests are necessary, not sufficient; verify end to end inside a linked web, desktop, or extension app (`docs/shared/local-dev.md`).
