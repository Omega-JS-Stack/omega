---
name: wm
description: Web Manager (web-manager) library architecture, module patterns, and development workflow — the shared frontend singleton (auth, Firestore, data-wm-bind bindings, utilities) consumed by UJM, BXM, and EM. - Use when working IN the web-manager repo — editing its source, modules, bindings engine, build, or tests. Triggers on "web-manager repo", "web manager source", "edit web-manager", "webManager module", "bindings engine", "binding action", "data-wm-bind internals", "resolveSubscription", "settler pattern", "escapeHTML implementation", "sanitizeURL implementation", "wm utilities module", or any work on files in web-manager/src/. For CONSUMING web-manager from a project, the framework's own router (omega:ujm / omega:bxm / omega:em) applies instead — this skill is for the library itself.
user-invocable: true
---

# Web Manager (WM) Library Patterns

Router skill for **web-manager** — the shared frontend singleton library (auth, reactive `data-wm-bind` bindings, Firestore, storage, push notifications, Sentry, DOM/utilities) embedded by the three frontend frameworks: [UJM](../ujm/SKILL.md) (websites), [BXM](../bxm/SKILL.md) (browser extensions), [EM](../em/SKILL.md) (Electron renderers). It is NOT one of the four build frameworks — it's the runtime library they all initialize once and expose as `manager.webManager`.

## Read these first (SSOT)

This skill points; the repo docs are the single source of truth:

- **In the web-manager repo:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/web-manager/CLAUDE.md` → `docs/*.md`
- **From a consumer/framework** (version-matched): `node_modules/web-manager/CLAUDE.md` → `node_modules/web-manager/docs/*.md` — but consumer-side work is routed by `omega:ujm` / `omega:bxm` / `omega:em`, not this skill.

Always-relevant references: `docs/architecture.md` (singleton + module graph), `docs/modules.md` (API per module), `docs/code-patterns.md` (the code-pattern checklist), `docs/bindings.md` (`data-wm-bind` engine).

## Hard rules

Summaries only — the SSOT for each is the linked doc.

1. **Singleton, always** — `src/index.js` exports one already-initialized instance; never `new Manager()`, never pass `webManager` through function params or module-level variables (`docs/architecture.md`).
2. **It's a LIBRARY, not an app** — no `npm run build` / `serve` here. `npm run prepare` builds once (`src/` → `dist/` ES5), `npm test` runs Mocha. End-to-end behavior is validated from inside a UJM/BXM/EM consumer, never from this repo alone (`CLAUDE.md` Quick Start).
3. 🚫 **NEVER run `npm start`** — it's the user's long-running watch process; if it isn't running, instruct the user to start it. One-shot `npm run prepare` and `npm test` are fine.
4. **Keep Firebase imports lazy** — dynamic imports keep consumer bundles small; don't convert them to static imports (`docs/architecture.md`).
5. 🚫 **NEVER modify `_legacy/`** — frozen historical reference.
6. **Cross-stack parity:** `resolveSubscription()` must stay unified with backend-manager's `User.resolveSubscription()` — subscription-state logic is identical frontend and backend (`docs/modules.md`).
7. **No TypeScript; CommonJS-friendly ES6+** in `src/`; `fs-jetpack` over `fs`; early-return style; no backwards compatibility unless asked (`docs/code-patterns.md`, `docs/dependencies.md`).
8. **Doc parity on every behavioral change** — README + CLAUDE.md + `docs/<topic>.md` + CHANGELOG, after validation.
9. **The OMEGA docs and skills are structurally MIRRORED** — this skill and the repo's CLAUDE.md follow the canonical skeletons (WM = the library subset); shared-concept doc filenames match the sister frameworks. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

Ordered checklists — every step's details live in the linked doc.

### Change a module / add a method
1. Read `docs/modules.md` + `docs/architecture.md` for the module's API and dependency position.
2. Implement in `src/modules/<module>/` per `docs/code-patterns.md`.
3. `npm run prepare` (one-shot build) → `npm test` (Mocha, `docs/testing.md`).
4. Validate end-to-end from a consumer — swap the framework to the local library with the framework's `npm run wm:local` (restore with `wm:prod`).
5. Doc parity audit (rule 8).

### Add a binding action / utility / module / config default
- Follow the recipe in `docs/common-tasks.md` (binding actions also: `docs/bindings.md`).

### Debug consumer-reported behavior
1. Reproduce inside the consuming framework's designated test consumer (see that framework's CLAUDE.md), with `wm:local` pointing at this repo.
2. Fix in `src/`, re-run `npm run prepare` + `npm test`, re-verify in the consumer.
