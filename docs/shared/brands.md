# Brands — topology, history, and the local era

> The SSOT for who the brands are, why each exists, and the local-era dependency contract. Settled with Ian 2026-07-11; real brand born 2026-07-18. AGENTS.md carries only the summary table and points here.

## The five brands

### `brands/naked-brand` — "Naked Brand", the bare fixture

Added with Ian 2026-08-29 ([#687](https://github.com/Omega-JS-Stack/omega/issues/687), agreed on [#608](https://github.com/Omega-JS-Stack/omega/issues/608)'s QA question): the standing brands are too COMPLETE to QA from-zero behavior, because a brand that already answered every question shows no prompt. This one is the minimum a brand monorepo can declare and still be walked — id `naked-brand`, one enabled web target, and nothing else. No theme, no analytics/payment/monitoring/connections/marketing sections, no agent-docs chain, no `.env`, no second target, no page content: every one of those is something `npx omega manage` is supposed to OFFER, and the walk's ask/skip/disable ladder is the thing under test.

Test-only forever, offline forever: project id `demo-naked-brand` (Firebase's emulator-only convention) is a guardrail rather than a configuration — every cloud-touching service short-circuits on `demo-*` instead of aiming real Google APIs at a project that does not exist, so nothing here provisions real cloud resources. A QA walkthrough may leave it in any state and reset it (`git clean` + `git checkout` on the folder); nothing outside it reads what a run wrote. The automated lanes do not run against it — it is a hand-walk fixture, and the corpus/e2e fixture is still the sandbox.

### `brands/sandbox-brand` — the synthetic fixture

Fixture for the AUTOMATED corpus/e2e suites: offline, `demo-*` Firebase, deterministic. Both targets are REAL framework consumers, `targets/backend` on `@omega.js/backend` and (since [#775](https://github.com/Omega-JS-Stack/omega/issues/775)) `targets/website` on `@omega.js/web`, whose `/e2e` page carries the hooks the brand's own lane drives: the fixture is the brand's content, never a stand-in for the frameworks. Test runs may mangle and reset it. Never touches real cloud. It deliberately carries no agent-docs chain — its files are test output, not a workspace an agent should be guided into.

### `brands/playground-omega` — "OMEGA Playground", the standing live test brand

Renamed from omega-brand (Ian 2026-07-11 — zero ambiguity). Born through the real wizard: id `playground` (shortened on 2026-09-10, [#808](https://github.com/Omega-JS-Stack/omega/issues/808), so the `<brand.id>-<role>` rule derives clean repo names off it), url playground.omegajs.dev — a SUBDOMAIN so derived surfaces never claim the real omegajs.dev. Its two repos both derive from that id, neither typed: `Omega-JS-Stack/playground-omega` (the source repo, and the folder name here, whose `main` every `omega deploy` snapshots this folder onto, [docs/shared/deploys.md](deploys.md)) and `playground-releases` (the public desktop releases + autoupdater feed). The third, the private `playground-rehearsal` snapshot, retired with the rehearsal itself ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). Points at the real-but-throwaway Firebase project `omegajs-playground` (ITW-org-owned since 2026-07-11; sanctioned for live proofs — Blaze it, break it, delete it; it is TEST INFRASTRUCTURE, never production).

REBRANDED **OMEGA Playground** (Ian 2026-08-21, [#433](https://github.com/Omega-JS-Stack/omega/issues/433) — REVERSES the 2026-07-19 fiction ruling, whose invented brand read as a real product in the ad and analytics consoles). The doctrine now: the playground is openly the OMEGA test surface — "we can mess around here, nothing live actually matters" — so drift from the real omegajs.dev site reads as a demo doing its job, never as a broken copy. Infra identity unchanged (id, url, green accent, classy theme); name and voice are the only things that moved, and the catalog's display names stay placeholder demo copy. Cloud-side display names (the Meta pixel, the GA property + streams, the GCP project name) are the manager's follow-up.

Secrets live only in `.env`/`.omega/secrets` (gitignored; the config loader hard-fails secret-shaped keys) — the committed omega.json5 carries public-by-design values only.

### `brands/newsflash-brand` — "The Daily Build", the second skin

Added with Ian 2026-07-17. Id `daily-build`, url dailybuild.omegajs.dev (same subdomain rule). The standing SECOND-SKIN brand: a fictional dev-news publication wearing the newsflash theme permanently, so both first-party skins stay alive in real consumers (classy = playground, newsflash = here). Born by COPY of the playground — the wizard rehearsal is a separate queued exercise. OFFLINE-only (demo-* Firebase, no real cloud/services, never production); website + backend targets only; website dev port pinned 4100 for side-by-side, backend rides N7 bumps.

### `../omega-omega` — the REAL brand (sibling repo)

BORN 2026-07-18 (cp229), LIVE 2026-07-19 (cp232). Lives outside the monorepo with its own git history; folder + repo are `omega-omega` per the `<brand.id>-<role>` rule ([#808](https://github.com/Omega-JS-Stack/omega/issues/808), 2026-09-10; `omega-brand` before that, `omegajs.dev` before 2026-07-19). GitHub: `itw-creative-works/omega-omega` via the `repo.providers.github.repo` slug (the legacy orgWebsite housing).

Id `omega`, name "OMEGA", url omegajs.dev (LIVE — GitHub Pages + Cloudflare), classy theme, website port 4200, website + backend targets. Born by FORKING the playground's polished content 1:1 (never a promotion of the test project; stale es caches dropped and re-translated fresh). It is the first SUB-BRAND of Ian's eventual company umbrella — the config `company` layer models this.

**Backend config is real** (flipped 2026-07-19): project `omegajs`, sdkconfig baked, `.firebaserc` real, Blaze linked to the Main Billing Account. authDomain = the BRAND host per cp268 — `omega build` self-hosts Firebase's `/__/auth/*` helper files (what the 2026-07-19 live 404 was actually missing), and a first-party authDomain keeps sign-in redirects working under browser storage partitioning.

**The identity seam SELF-HEALS in the cloud service** (Ian 2026-07-19: "wrapped in npm start — self healing idempotent"; since [#227](https://github.com/Omega-JS-Stack/omega/issues/227), 2026-08-13, that wrapper is `npm run manage`): access probe → grant the manage identity via any able local gcloud account (owner first; editor+firebase.admin fallback — no-org projects refuse API owners) → re-probe through propagation. The FIRST healing run must be Ian's own `npm run manage` from the brand root (the session classifier refuses Claude-fired IAM mutation, even wrapped); every run after is plain reconcile.

**REMAINING GATES**: that first `npm run manage`; the npm publish; one CI-dispatch exercise.

## The local era

Ian 2026-07-18: "still use local … until we are fully locked on all decisions that may result in breaking changes."

- Every `@omega.js/*` dep in the real brand is a committed relative `file:` spec into THIS monorepo.
- Versions re-reset to 0.1.0 (cp238, supersedes cp228 — Ian: 0.x until live publishes are proven; 1.0.0 is a later deliberate graduation), so the first publish flips them to `^0.1.0` seamlessly.
- All seven publishables carry a mechanical `private: true` latch until the proving checkpoint unlatches them ([docs/shared/publishing.md](publishing.md) is the runbook).

## The line that never moves

The in-repo brands and the playground Firebase project stay test-only forever; nothing in this monorepo is ever the production brand.
