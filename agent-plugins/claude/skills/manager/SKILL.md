---
name: manager
description: Router for @omega.js/manager — the brand orchestration engine that walks every service in dependency order and reconciles a brand monorepo to its config/omega.json5, plus the brand-root guide every consumer brand imports. - Use when working at a brand monorepo root, on the manage cycle, or on the manager package itself. Triggers on "@omega.js/manager", "omega manager", "packages/manager", "brand monorepo", "brand root", "manage cycle", "reconcile", "npm start at the brand root", "--service=", "--dry-run", "--continue-on-error", "--strict", "omega onboard", "onboarding wizard", "company mode", "--brand=", "omega deploy fan-out", "omega update fan-out", ".omega/state.json", ".omega/runs", "devlog", "disperse", "workspace service", "github service", "cloud service", "cloudflare service", "domain service", "payment service", "seo service", "certificates service", "agent-docs chain", "AGENTS.md import", or any work in a brand's config/omega.json5 or apps/ layout.
user-invocable: true
---

# OMEGA Manager (@omega.js/manager)

`@omega.js/manager` is the orchestration engine for a brand monorepo. `npx omega` at a brand root walks every service in dependency order — workspace, github, cloud, cloudflare, domain, payment, analytics, seo, certificates, disperse, update, and the rest — and reconciles each one to `config/omega.json5`, idempotently: run it twice, get the same result. From a company workspace the same command fans out across every managed brand. It also owns `omega onboard` (create or converge a brand) and the deliberate `omega deploy` / `omega update` fan-outs across a brand's apps.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `packages/manager/README.md` is the package's long-form reference (the wizard, the manage cycle, the three data buckets, every service, company mode, the CLI surface); `docs/manager/index.md` is the short map pointing at it. The brand-monorepo shape and the agent-docs chain are in `docs/shared/agent-docs.md`; cross-framework contracts are in `docs/shared/` (config, deploys, updates, brands, local-dev).
- **Working in a consumer brand** — the brand root's `AGENTS.md` imports `node_modules/@omega.js/manager/AGENTS.md`, the framework-owned brand guide: the app-to-target map, the verbs, and the brand hard rules. Read it first, then the framework guide for whichever app the work is in. In the local era that path is a symlink into this monorepo, so the chain resolves to the live guide; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

## Non-negotiables

- **`packages/manager/AGENTS.md` is the SHIPPED brand guide, not this package's own guide.** It is imported by every brand root — never move it into `docs/`, never rewrite it as a pointer, and never edit it from inside a brand.
- **Upstream-first**: a defect the next consumer would hit gets fixed in the framework, not patched in the brand — the rule and its "within reason" line live in `docs/shared/local-dev.md`.
- **Every service is idempotent.** Check before acting; a second run must change nothing.
- **Secrets never enter `config/omega.json5`** — `.env` and `.omega/secrets/` only; `.omega/` is gitignored and never committed.
- **Deploys are deliberate** — only `omega deploy` publishes, backend first; a commit never does (`docs/shared/deploys.md`).
