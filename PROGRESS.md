# Project Progress Tracker
> Status board — one line per item. Detail lives in CHANGELOG.md (shipped), docs/ + package READMEs (behavior), and commit messages (journey). Master plan: `~/.claude/plans/i-need-you-to-jiggly-salamander.md` (Phases 0–5).

## 🎯 Now
- (idle — next queue item starts on Ian's "continue")

## 🗺 Next (order = Ian's directives > master plan > this queue; reorder freely)
1. Prompting port (src/lib/prompt, TTY-safe) — the foundation for onboarding + every parked interactive service flow
2. Onboarding port — brand-creation wizard → the plan-§0 "Use this template" story; unlocks fresh-brand dogfooding
3. Config-serializer writebacks — IDs parked in .omega/state.json (sendgrid list, beehiiv publication, payment products, agent ids) → omega.json5
4. Disperse remnants — cert files into desktop/mobile apps; .env composition
5. Extension port (beehiiv segment automation) + assets PSD template trio (needs company binaries)
6. Master-plan resumption (each on Ian's go): B5 `omega verify` → Phase 4 website migrations (somiibo scale test) → Phase 3 rename cutovers (extension → desktop → backend) → Phase 5 template product

## ⏸ Blocked / Waiting (Ian-owned)
- electron-manager@1.12.1 publish — 1.12.0 on npm breaks fresh installs (files fix sits in the monorepo copy)
- @omegajs npm org claim; GitHub remote creation + first push (ci.yml verification pending)
- PAUSED until Ian asks: B5 verify + ALL migrator tooling; translate/audit ports (explicit stubs in @omegajs/web). MAM parked entirely.

## 📏 Standing rules
- Existing repos (omega-manager, all framework + consumer repos) are READ-ONLY — all work happens in this monorepo; old-name releases publish FROM the monorepo copies.
- Live checks NEVER touch real ITW repos/resources — not even read-only probes; sandbox/fixture resources only, creds scrubbed (`env -u`).
- No backwards compat (Ian 2026-07-06: dual-read cancelled) — implement + document the new way only.
- Rhythm: one checkpoint per "continue" — survey (read-only) → design (de-ITW, non-interactive, .env creds, dry-run) → implement → tests → sandbox/fixture proof → docs → commit.
- Git: explicit `git -C` always (post-incident rule: a checkpoint-5 commit briefly landed in omega-manager via a stray cwd — reverted, nothing pushed); commit-and-continue is standing for THIS repo; `Co-Authored-By: Claude Fable 5` trailer.
- De-ITW'ing hardcoded company values into config = standard scope; best-implementation-wins normalization is licensed (pick the better behavior, don't keep both quirks).
- npu, never raw npm install/npx. Secrets never in omega.json5 — .env / .omega/secrets only (@omegajs/config hard-fails on secret-shaped keys).

## ⚠ Parked findings (detail: the named task's CHANGELOG entry)
- BEM: custom emulator ports unsupported (getApiUrl/getFunctionsUrl hardcode 5001/5002; test/mcp too) — harmonization candidate (1.2a)
- BEM: `mgr setup` can't complete on emulator-only demo-* projects (firestore-indexes-synced hits the live API → 403 + stray _firestore.indexes.json); nvmrc fix is two-phase; `mgr test` can orphan java emulator grandchildren (1.4b)
- BEM: the test path filter matches project tests but not corpus paths (1.2a)
- web-manager tarball ships src/ with bare @omegajs imports — exports-unaware consumers would fail loudly; revisit at the client cutover (1.3b)

## ✅ Done (recent — full history: CHANGELOG.md + git log; the fat pre-slim tracker: `git show 99dc015:PROGRESS.md`)
- [x] 56 PROGRESS.md → status board; global docs conventions + change-tracker hook reworked (this commit)
- [x] 55 company mode — one manage child per brand, stamps, --brand/--parallel (99dc015) → CHANGELOG
- [x] 54 testing-live checks — omega-manager's SERVICE ORDER FULLY DRAINED, checkpoints 33–54 (76bd830) → CHANGELOG
- [x] 53 migrations service — --migration-gated REST runner, notifications + users (47feed4) → CHANGELOG
- [x] 52 account service — derived passwords, admin audit (422f85e) → CHANGELOG
- [x] 51 seo · 50 certificates · 49 assets · 45–48 slapform/chatsy/replyify/server · 34–44 github…payment → CHANGELOG
- [x] 33 @omegajs/manager core — service runner, brand loading, .omega store, workspace/update/testing → CHANGELOG
- [x] Phase 2 A0–B4: Eleventy wins the bake-off (3.6s vs 332s Jekyll); @omegajs/web engine + real UJM content + CLI + `omega migrate` (somiibo 2,556 pages ~100s) → CHANGELOG; B5 PAUSED
- [x] Phase 1: devkit slices, @omegajs/account golden-master (BEM + WM adopted), BEM harmonization 1.4a–d, hard omega.json5 flips (EM/BEM/BXM), sandbox brand + 11-step cross-stack e2e → CHANGELOG
- [x] Phase 0: monorepo bootstrap, 4 plain-copies, CI + pack-smoke (caught the live EM 1.12.0 install bug) → CHANGELOG

*Last updated: 2026-07-09 1:45 PM (checkpoint 56)*
