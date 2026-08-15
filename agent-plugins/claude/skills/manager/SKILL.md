---
name: manager
description: Use when working at a brand monorepo root, on the manage cycle, or on @omega.js/manager itself — the service walk, reconciling a brand to its config/omega.json5, onboarding, deploy and update fan-out, .omega state, disperse, or the agent-docs chain.
user-invocable: true
---

# OMEGA Manager (@omega.js/manager)

`@omega.js/manager` is the orchestration engine for a brand monorepo. `npx omega` at a brand root walks every service in dependency order — workspace, github, cloud, cloudflare, domain, payment, analytics, seo, certificates, disperse, update, and the rest — and reconciles each one to `config/omega.json5`, idempotently: run it twice, get the same result. From a company workspace the same command fans out across every managed brand. It also owns `omega onboard` (create or converge a brand) and the deliberate `omega deploy` / `omega update` fan-outs across a brand's apps.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `packages/manager/README.md` is the package's long-form reference (the wizard, the manage cycle, the three data buckets, every service, company mode, the CLI surface); `docs/manager/index.md` is the short map pointing at it. The brand-monorepo shape and the agent-docs chain are in `docs/shared/agent-docs.md`; cross-framework contracts are in `docs/shared/` (config, deploys, updates, brands, local-dev).
- **Working in a consumer brand** — the brand root's `AGENTS.md` imports `node_modules/@omega.js/AGENTS.md`, a symlink the workspace service maintains at the monorepo's top-level `AGENTS.md` (the map). The brand-root guide itself is `docs/manager/brand.md`: the app-to-target map, the verbs, and the brand hard rules — read it first, then the framework guide for whichever app the work is in. Published installs will carry the map and docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

## Non-negotiables

- **No package carries agent docs.** The repo-root `AGENTS.md` map is the one agent entry; the brand guide is `docs/manager/brand.md`. Never create a `packages/<pkg>/AGENTS.md` or `CLAUDE.md`.
- **Upstream-first, permission first**: a defect the next consumer would hit gets fixed in the framework, not patched in the brand — but a consumer session surfaces the proposed framework change and waits for Ian's go (or files an upstream issue) before editing the monorepo. The rule and its "within reason" line live in `docs/shared/local-dev.md`.
- **Every service is idempotent.** Check before acting; a second run must change nothing.
- **Grep the logs FIRST.** The manage cycle tees to `<brandRoot>/logs/manage.log` and the `omega dev` fan-out to `<brandRoot>/logs/dev.log`, and every app keeps its own `logs/` beside it — truncated per launch, gitignored. What a service walk did, and what a dev leg printed, is on disk: read it instead of re-running a manage or restarting the stack (`docs/shared/logging.md`).
- **Secrets never enter `config/omega.json5`** — `.env` and `.omega/secrets/` only; `.omega/` is gitignored and never committed.
- **Deploys are deliberate** — only `omega deploy` publishes, backend first; a commit never does (`docs/shared/deploys.md`).
