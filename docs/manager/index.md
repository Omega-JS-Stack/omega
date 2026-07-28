# OMEGA Manager (@omega.js/manager)

The package's own long-form reference is [packages/manager/README.md](../../packages/manager/README.md) — the wizard, the manage cycle, the services, and the CLI surface all live there.

The `omega:manager` router skill from the omega Claude plugin loads automatically in any project with `@omega.js/manager` (and inside `packages/manager` here); it points back at this map and the brand guide.

The brand-root guide is [brand.md](brand.md) — what a session inside any consumer brand reads first (anatomy, verbs, brand hard rules, upstream-first). Every consumer brand's root `AGENTS.md` imports `node_modules/@omega.js/AGENTS.md`, a symlink the workspace service maintains at the monorepo's top-level `AGENTS.md` (the map) — contract: [agent-docs.md](../shared/agent-docs.md). No package carries agent docs.
