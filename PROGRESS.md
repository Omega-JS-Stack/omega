# Project Progress Tracker
> Status board — one line per item. Detail lives in CHANGELOG.md (shipped), docs/ + package READMEs (behavior), and commit messages (journey). Master plan: [plans/omega-redesign-master-plan.md](plans/omega-redesign-master-plan.md) (Phases 0–5 + amendments header).

## 🎯 Now
- N3 wire/env harmonization (cp72) — route prefix `/omega`, functions `omega_*`, runtime-config key `omega`, env `OMEGA_*`; CI runs 2–3 verifying in background

## 🗺 Next (order = Ian's directives > master plan > this queue; reorder freely)
1. N4 migrated-code architecture sweep (DRY/SSOT review of packages/*) + zod route schemas (data shapes + route semantics preserved)
2. N5 emulator-first frontend dev — auto-connect Auth+Firestore emulators in dev, zero flags
3. N6 personas + lifecycle e2e — seeded persona accounts, signup/delete/cancel/refund/export/deletion flows, consumer-authorable brand tests, /account mock fixtures removed
4. N7 port auto-allocation — brand-level port map, bump-if-taken, all url getters aware (fixes BEM 5001/5002)
5. Dogfood arc: template/onboarding polish (cloud-setup walkthrough) → blueprint+pricing-from-config rethink → classy CROSS-TARGET redesign → **the OMEGA brand dogfood** (all four targets, `omega dev --local`)
6. Brand rebuilds on the new stack (post-dogfood): somiibo (easy first real brand) → sweet-saucy (page-count stress test)

## ⏸ Blocked / Waiting (Ian-owned)
- electron-manager@1.12.1/1.13.0 publish — 1.12.0 on npm breaks fresh installs; the LEGACY repo now carries both commits (the other agent's merge), so Ian publishes straight from it — the monorepo pre-rename tag (`pre-desktop-rename`, cp66) is just backup
- Old-name publish lanes generally: every legacy framework repo is the source for old-name releases (web-manager frozen at 4.3.6, backend-manager at 5.12.0); monorepo tags `pre-{backend,client}-rename` are backup
- npm PUBLISHES still gated (orgs are claimed — see standing rules — but versions not finalized; zero publishes until Ian says go)
- PINNED per Ian (2026-07-09): B5 `omega verify` + Phase 4 migrations + ALL migrator tooling; translate/audit ports (explicit stubs in the web package). MAM parked entirely.

## 📏 Standing rules
- **Continuous mode (Ian 2026-07-10)**: keep iterating/building/testing autonomously, checkpoint after checkpoint — stop ONLY for serious errors or decisions that are genuinely Ian's. (Replaces one-checkpoint-per-"continue".)
- **Orgs claimed + locked (Ian 2026-07-10)**: npm org `omega.js` and GH org `Omega-JS-Stack` are Ian's — names are final. GH org is empty; full control granted to create repos/push/try things. npm publishes REMAIN gated (versions not finalized).
- **Data-shape preservation (Ian 2026-07-10)**: existing Firestore shapes (`users/{uid}`, payment orders, …) + backend route semantics are presumed good. Any breaking change that would require migrating existing data needs Ian's explicit OK — flag with a migration plan, don't build.
- Core-changes spec: [plans/omega-core-changes-inbox.md](plans/omega-core-changes-inbox.md) (DECIDED 10/10, 2026-07-10) is binding alongside the master plan; classy/CMS/admin arcs build systems/extensibility first — visuals are the easy part (Ian).
- Existing repos (omega-manager, all framework + consumer repos) are READ-ONLY — all work happens in this monorepo; old-name releases publish FROM the monorepo copies.
- Live checks NEVER touch real ITW repos/resources — not even read-only probes; sandbox/fixture resources only, creds scrubbed (`env -u`).
- No backwards compat (Ian 2026-07-06: dual-read cancelled) — implement + document the new way only.
- Checkpoint discipline (structure unchanged): survey (read-only) → design (de-ITW, non-interactive, .env creds, dry-run) → implement → tests → sandbox/fixture proof → docs → commit.
- Git: explicit `git -C` always (post-incident rule: a checkpoint-5 commit briefly landed in omega-manager via a stray cwd — reverted, nothing pushed); commit-and-continue is standing for THIS repo; `Co-Authored-By: Claude Fable 5` trailer.
- De-ITW'ing hardcoded company values into config = standard scope; best-implementation-wins normalization is licensed (pick the better behavior, don't keep both quirks).
- npu, never raw npm install/npx. Secrets never in omega.json5 — .env / .omega/secrets only (@omega.js/config hard-fails on secret-shaped keys).
- Local-first (Ian 2026-07-09): build the NEW system locally — zero npm publishes until Ian finalizes versions (orgs now claimed; `@omega.js` names land at N2); migrators/verifiers pinned.

## ⚠ Parked findings (detail: the named task's CHANGELOG entry)
- ~~Env prefixes + backend wire format~~ GRADUATED to queue N3 (Ian approved the breaking renames, 70); ~~BEM hardcoded emulator ports~~ GRADUATED to queue N7 (70)
- BXM translate task auto-calls Claude (Agent SDK rides local auth) on cache-miss — one live call burned during the 64 canary before .cache seeded; watch on fresh clones (64)
- BEM: `mgr setup` can't complete on emulator-only demo-* projects (firestore-indexes-synced hits the live API → 403 + stray _firestore.indexes.json); nvmrc fix is two-phase; `mgr test` can orphan java emulator grandchildren (1.4b)
- BEM: the test path filter matches project tests but not corpus paths (1.2a)
- N4 verifies from the cp70 sweep: web's site-wide defaults-style override intent achievable via the data cascade? (powertools 1.8.1 equivalent); packages/config schema needs `devlog`/`seo` keys if ever made strict (70)
- npm 11 script-approval gating skips dep postinstalls on CI runners — puppeteer handled explicitly (70); if electron/canvas/sharp ever misbehave in CI, this is the first suspect

## ✅ Done (recent — full history: CHANGELOG.md + git log; the fat pre-slim tracker: `git show 99dc015:PROGRESS.md`)
- [x] 71 Great Rename — `@omega.js` scope everywhere (650 files; lockfiles regenerated, dists re-vendored, regex gates escaped); universal `omega`/`omg`/`mgr` dispatcher bins (devkit 1.2.0, hoist-winner-proof, bootstrap fallback, live cross-dispatch proof); `window.omega` identifier sweep (127 files; migrate-codemod collision caught + repaired by fixture tests); docs flip to `npx omega`; 10 suites + pack-smoke ×4 green (this commit) → CHANGELOG
- [x] 70 core-changes graduation + N1 re-sync + first real CI — inbox DECIDED 10/10 binding, queue = N1–N7 + dogfood, continuous mode ON; repo live at github.com/Omega-JS-Stack/omega; sweep verdict: monorepo is a superset of ALL legacy repos (one gap: 9 UJM redirect shortlinks → web 0.2.1); desktop webpack `global` fix (2.0.2) + CI env fixes (firebase-tools, puppeteer) (this commit) → CHANGELOG
- [x] 69 local-linking DX (plan §8) — devkit/local + concurrent root `npm start` + `omega dev --local` + `mgr i local` ×3 (desktop/extension were broken since their renames); vendor fix: published runtime deps (client) never vendored; live proofs + 7 suites + pack-smoke ×4 (this commit) → CHANGELOG + docs/local-dev.md
- [x] 68 @omega.js/client cutover (local) — FINAL Phase-3 rename, every package @omega.js-named: 5.0.0, v4.3.5–4.3.6 folded, module-field finding resolved, 5 suites + e2e + pack-smoke green (cc01c38) → CHANGELOG
- [x] 67 @omega.js/backend cutover (local) — third Phase-3 rename: 6.0.0, v5.12.0 folded, boot canary + sandbox corpus 1,252 + cross-stack e2e + pack-smoke green; runner abort-exit-0 bug fixed (be0b2cd) → CHANGELOG
- [x] 66 @omega.js/desktop cutover (local) — second Phase-3 rename: 2.0.0, EM 1.13.0 folded, suite 758/763 incl. real-Electron boot canary, pack-smoke green; devkit vendor self-name fix + boot scoped-symlink fix (f3948be) → CHANGELOG
- [x] 65 upstream sync sweep + devlog port — legacy merges pinned: BXM/web/manager already covered EXCEPT devlog → ported to @omega.js/manager (564 tests); EM/BEM/WM deltas annotated onto their cutovers (this commit) → CHANGELOG
- [x] 64 @omega.js/extension cutover (local) — first Phase-3 rename: 2.0.0, consumer canary builds MV3 ×3 browsers, pack-smoke green; devkit vendor ×2 + gulp5 icons fixes (this commit) → CHANGELOG
- [x] 63 extension port + PSD templates + AI brandmark — omega-manager FULLY ported, nothing parked; company PSD binaries land in ITW's company repo at migration, live MrLogo mint on Ian's go (ec9a223) → CHANGELOG
- [x] 62 disperse remnants — certs into desktop/mobile apps, per-app .env composition, pixel-token paste-in (feb8e36) → CHANGELOG
- [x] 61 verification-poll adoptions — all 7 wait-and-verify sites poll interactively (zone, email-routing, hosting, adsense, recaptcha stamp, sendgrid, search-console) (67b51c6) → CHANGELOG
- [x] 60 onboarding flows — devkit flow primitives + manager config-flow engine; 8 services set themselves up interactively into omega.json5 (dfe4ac5) → CHANGELOG
- [x] 59 config-writeback — comment-preserving omega.json5 editor in @omega.js/config; sendgrid/beehiiv/payment/firebase IDs land in config (fd65c22) → CHANGELOG
- [x] 58 onboarding wizard — `omega-manager onboard` scaffolds the plan-§0 brand monorepo (company/resume/in-place, fill-missing) (3d38e27) → CHANGELOG
- [x] 57 prompting port — devkit prompt module (TTY-safe inquirer), 5 confirm/paste-back flows live (0325d14) → CHANGELOG
- [x] 56 PROGRESS.md → status board; global docs conventions + change-tracker hook reworked (c5c6c25)
- [x] 55 company mode — one manage child per brand, stamps, --brand/--parallel (99dc015) → CHANGELOG
- [x] 54 testing-live checks — omega-manager's SERVICE ORDER FULLY DRAINED, checkpoints 33–54 (76bd830) → CHANGELOG
- [x] 53 migrations · 52 account · 51 seo · 50 certificates · 49 assets · 45–48 slapform/chatsy/replyify/server · 33–44 manager core + github…payment → CHANGELOG
- [x] Phase 2 A0–B4: Eleventy wins the bake-off (3.6s vs 332s Jekyll); @omega.js/web engine + real UJM content + CLI + `omega migrate` (somiibo 2,556 pages ~100s) → CHANGELOG; B5 PAUSED
- [x] Phase 1: devkit slices, @omega.js/account golden-master (BEM + WM adopted), BEM harmonization 1.4a–d, hard omega.json5 flips (EM/BEM/BXM), sandbox brand + 11-step cross-stack e2e → CHANGELOG
- [x] Phase 0: monorepo bootstrap, 4 plain-copies, CI + pack-smoke (caught the live EM 1.12.0 install bug) → CHANGELOG

*Last updated: 2026-07-10 1:25 PM (checkpoint 71 done; 72 = N3 wire/env harmonization in flight)*
