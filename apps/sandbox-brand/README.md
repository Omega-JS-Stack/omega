# Sandbox Brand

The Omega monorepo's **permanent dogfood consumer** — a brand monorepo in the
day-one target format (`package.json` with `apps/*` workspaces, one app per
target type). It exists so every framework/devkit/account/config change can be
verified against a REAL consumer inside this repo, and so the scaffolding path
is continuously dogfooded.

**Rules of this sandbox:**

- **Fresh by construction.** Nothing in here is copied from an existing brand.
  Files come from the frameworks' own scaffolding sources (e.g.
  `packages/backend/templates/` + `src/defaults/` — the same files `mgr setup`
  writes into consumers).
- **Emulator-only, demo everything.** The Firebase project is
  `demo-sandbox-brand` (the `demo-` prefix means the emulator suite runs with
  no real credentials). Every key, secret, and service account in here is a
  fake demo value by design — which is why files a real consumer gitignores
  (`.env`, `service-account.json`, `.firebaserc`, the root-proxy
  `package.json`) are deliberately committed here (re-included in
  `.gitignore`'s Custom Values section).
- **Frameworks link to the monorepo.** `apps/backend/functions` depends on
  `backend-manager` via `file:../../../../../packages/backend`, so the sandbox
  always exercises HEAD.

## Apps

| App | Framework | Notes |
|-----|-----------|-------|
| `apps/backend` | `packages/backend` (backend-manager) | Real BEM consumer: full framework corpus (routes/events/rules/…) runs against the emulator, not just the self-test boot smoke |

`apps/website` arrives with the e2e harness work (the client/auth surface for
cross-stack signin flows), and gets replaced by an `@omegajs/web` consumer in
Phase 2.

## Running

```bash
# Backend: install (functions/ owns the deps), then test against the emulator
cd apps/backend/functions && npm install
npx mgr test            # boots the emulator (demo project) + runs the full corpus

# `npm test` at the brand root proxies to the canonical consumer scripts
# (which include `mgr setup` — that runs live checks; use `mgr test` directly
# for offline/CI runs)
```
