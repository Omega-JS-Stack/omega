# Multi-instance targets — spec (shape RATIFIED by Ian 2026-07-20; build queued)

> Queue item (c). The real need is proven by legacy `brand.subdomains` (ITW: `["admin","cdn","emails"]`; soundgrail: `["app","music","exhale"]` — each a separate website living on a subdomain of the same brand). The new system must let ONE brand run N instances of the SAME target type without inventing new target types.

## The shape (Ian: "your shape makes the most sense")

`targets` stays an object keyed by type. Each type's value is an **object OR an array of id'd instances**:

```json5
targets: {
  backend: { /* single instance — today's shape, unchanged */ },
  web: [
    { id: 'main',  /* the primary site — omegajs.dev */ },
    { id: 'admin', url: 'admin.omegajs.dev', theme: 'classy' },
    { id: 'cdn',   url: 'cdn.omegajs.dev', sitemap: false },
  ],
}
```

- **Normalization is the whole trick**: a single object normalizes to `[{ id: 'main', ...entry }]` internally — every consumer of target config iterates instances; the single-instance world is just length 1. Zero breaking change for existing brands.
- Array entries MUST carry `id` (validator-enforced, unique per type). `id: 'main'` is the conventional primary.
- Any shared key inside an instance entry overrides brand-shared config for THAT instance only (same override semantics as today's target entry — the instance entry IS the target entry).

## App-dir mapping

| Instance | App dir |
|---|---|
| `main` (or the single object form) | `apps/<canonical dir>` (`apps/website`, unchanged) |
| any other id | `apps/<canonical dir>-<id>` (`apps/website-admin`, `apps/website-cdn`) |

- The manager's workspace `structure` op learns the mapping: enabled instance without its app dir = the same create-this-dir error as today.
- The app dir → instance resolution is the inverse walk: `website-admin` → type `web`, instance `admin`. `@omega.js/config`'s compose gains the instance dimension: `composeTargetConfig(appPath, type)` resolves WHICH instance from the app dir name, merge chain becomes `defaults ← company ← brand shared ← instance entry ← app shared ← app targets.<type>`.

## What iterates instances (the mirrored sweep)

- **manager structure/testing/disperse**: per-instance apps, per-instance live-URL checks (each instance has its own `url`).
- **deploys**: per-app as today — each app deploys its own instance (`omega deploy` in `apps/website-admin` ships admin.omegajs.dev). Deploy records key by app.
- **dev**: per-instance dev ports (brand-root `omega dev` boots the primary; additional instances opt in via flag or run from their app dir; ports offset per instance to allow side-by-side).
- **github/cloudflare/domain services**: DNS + Pages per instance url (subdomain rule already exists — derived surfaces).
- **backend**: normalization applies but stays single-instance in practice until a need appears (Cloud Functions = one project surface); validator warns >1 backend instance unsupported for now.

## Non-goals (v1)

- No cross-instance shared builds (each app builds independently — simple, correct).
- No instance-level Firebase projects (one cloud project per brand stays the rule; instances share it).
- No migration tooling yet (PINNED with the rest of the migrators) — but the CONFIG mapping for legacy `brand.subdomains` → web instances array is recorded here as the conversion rule.

## Sequencing (when built)

1. `@omega.js/config`: normalization + instance resolution + validator (ids unique, backend >1 warn) + tests.
2. Manager workspace structure op + testing service instance iteration + tests.
3. Web dev-port offsets + deploy-record keying proof on a fixture brand (sandbox corpus cell with a 2-instance web brand).
4. Docs (config.md, deploys.md, local-dev.md) + this plan collapses into them.
