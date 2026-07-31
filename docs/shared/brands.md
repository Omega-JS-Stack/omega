# Brands — topology, history, and the local era

> The SSOT for who the brands are, why each exists, and the local-era dependency contract. Settled with Ian 2026-07-11; real brand born 2026-07-18. AGENTS.md carries only the summary table and points here.

## The four brands

### `apps/sandbox-brand` — the synthetic fixture

Fixture for the AUTOMATED corpus/e2e suites: offline, `demo-*` Firebase, deterministic. Test runs may mangle and reset it. Never touches real cloud. It deliberately carries no agent-docs chain — its files are test output, not a workspace an agent should be guided into.

### `apps/omega-playground` — "Paperloom", the standing live test brand

Renamed from omega-brand (Ian 2026-07-11 — zero ambiguity). Born through the real wizard: id `omega-playground`, url playground.omegajs.dev — a SUBDOMAIN so derived surfaces never claim the real omegajs.dev. Points at the real-but-throwaway Firebase project `omegajs-playground` (ITW-org-owned since 2026-07-11; sanctioned for live proofs — Blaze it, break it, delete it; it is TEST INFRASTRUCTURE, never production).

REBRANDED **Paperloom** (Ian 2026-07-19): a fictional quiet-writing-studio brand — now that the real omegajs.dev exists, the playground stops posing as "here's the OMEGA framework" so drift never reads as a broken copy. Infra identity unchanged; name/copy/color/catalog display are the fiction (forest-ink green, classy theme).

Secrets live only in `.env`/`.omega/secrets` (gitignored; the config loader hard-fails secret-shaped keys) — the committed omega.json5 carries public-by-design values only.

### `apps/newsflash-brand` — "The Daily Build", the second skin

Added with Ian 2026-07-17. Id `daily-build`, url dailybuild.omegajs.dev (same subdomain rule). The standing SECOND-SKIN brand: a fictional dev-news publication wearing the newsflash theme permanently, so both first-party skins stay alive in real consumers (classy = playground, newsflash = here). Born by COPY of the playground — the wizard rehearsal is a separate queued exercise. OFFLINE-only (demo-* Firebase, no real cloud/services, never production); website + backend targets only; website dev port pinned 4100 for side-by-side, backend rides N7 bumps.

### `../omega-brand` — the REAL brand (sibling repo)

BORN 2026-07-18 (cp229), LIVE 2026-07-19 (cp232). Lives outside the monorepo with its own git history; folder + repo renamed from omegajs.dev per Ian 2026-07-19 — consistent with the `*-brand` family, and bare "omega" is the monorepo. GitHub: `itw-creative-works/omega-brand` via the `targets.backend.github.repo` slug (the legacy orgWebsite housing).

Id `omega`, name "OMEGA", url omegajs.dev (LIVE — GitHub Pages + Cloudflare), classy theme, website port 4200, website + backend targets. Born by FORKING the playground's polished content 1:1 (never a promotion of the test project; stale es caches dropped and re-translated fresh). It is the first SUB-BRAND of Ian's eventual company umbrella — the config `company` layer models this.

**Backend config is real** (flipped 2026-07-19): project `omegajs`, sdkconfig baked, `.firebaserc` real, Blaze linked to the Main Billing Account. authDomain = the BRAND host per cp268 — `omega build` self-hosts Firebase's `/__/auth/*` helper files (what the 2026-07-19 live 404 was actually missing), and a first-party authDomain keeps sign-in redirects working under browser storage partitioning.

**The identity seam SELF-HEALS in the cloud service** (Ian 2026-07-19: "wrapped in npm start — self healing idempotent"): access probe → grant the manage identity via any able local gcloud account (owner first; editor+firebase.admin fallback — no-org projects refuse API owners) → re-probe through propagation. The FIRST healing run must be Ian's own `npm start` from the brand root (the session classifier refuses Claude-fired IAM mutation, even wrapped); every run after is plain reconcile.

**REMAINING GATES**: that first `npm start`; the npm publish; one CI-dispatch exercise.

## The local era

Ian 2026-07-18: "still use local … until we are fully locked on all decisions that may result in breaking changes."

- Every `@omega.js/*` dep in the real brand is a committed relative `file:` spec into THIS monorepo.
- Versions re-reset to 0.1.0 (cp238, supersedes cp228 — Ian: 0.x until live publishes are proven; 1.0.0 is a later deliberate graduation), so the first publish flips them to `^0.1.0` seamlessly.
- All six publishables carry a mechanical `private: true` latch until the proving checkpoint unlatches them ([docs/shared/publishing.md](publishing.md) is the runbook).

## The line that never moves

The in-repo brands and the playground Firebase project stay test-only forever; nothing in this monorepo is ever the production brand.
