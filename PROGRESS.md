# Project Progress Tracker
> Agents and maintainers should update this file regularly to reflect the current state of the project.

## 🎯 Current Focus
* **Goal:** Phase 1 — foundation packages. First slice of @omegajs/devkit (logger, safe-install, attach-log-file + vendor-on-prepare mechanism) landed and proven on extension; next: adopt in backend/desktop, then the test-runner/Chromium-runner slice, sandbox brand + `omega e2e` harness.
* **Current Phase:** Phase 1 — Foundation packages (Phase 0 complete except the publish gate, which Ian owns)
* **Priority:** High
* **Last Updated:** 2026-07-05 10:55 PM
* **Notes:** Devkit vendoring proven on extension (checkpoint 5, commit 585d7cc) AND desktop (checkpoint 6). Backend adoption waits for BEM harmonization (no dist layer yet). Next slice: devkit test runner + Chromium runner (Task 1.1d), then sandbox brand + omega e2e (1.2). INCIDENT (resolved): checkpoint-5 commit initially ran in omega-manager by accident (stray shell cwd) — undone via mixed reset, Ian's working tree fully restored, nothing pushed; all git commands now use explicit `git -C`. Pending Ian: electron-manager@1.12.1 publish (his session), @omegajs org claim, GitHub remote creation.

## 📌 Active Task List
* [ ] Phase 0: Bootstrap the monorepo
  * [x] Task 0.1: Create repo skeleton (packages/, spikes/, apps/, docs/, package.json workspaces, .nvmrc, .gitignore, README, CLAUDE.md, PROGRESS.md, CHANGELOG.md)
  * [x] Task 0.2: Probe @omegajs npm scope (no packages exist; Ian to claim org on npmjs.com)
  * [x] Task 0.3: Initial commit (b9d9aed) + per-checkpoint commits on Ian's go
  * [x] Task 0.4: Install + configure changesets (@changesets/cli ^2.31.0, .changeset/ initialized)
  * [x] Task 0.5: Plain-copy backend-manager, web-manager, browser-extension-manager, electron-manager into packages/{backend,client,extension,desktop} (rsync minus .git/node_modules/.env/logs/lockfiles; secret scan clean — only BEM's demo-project test fixture; MAM excluded as parked)
  * [x] Task 0.6: Workspace install + suites GREEN in-place — client 73 passing; extension 85 passing; desktop 751 passing / 5 designed extended-mode skips (required 2 hoisting fixes: src/test/runners/electron.js + boot.js now resolve electron via require.resolve(paths:[projectRoot]) instead of hardcoded <root>/node_modules/electron — behavior identical for consumers); backend 2 passing = its complete standalone suite (real BEM corpus runs in consumers; emulator stack self-orchestrated successfully from the monorepo, proving java+firebase-tools env)
  * [x] Task 0.7: CI workflow written (.github/workflows/ci.yml — 4 suites w/ xvfb+java, pack→scratch-install smoke; CI verification pending first push to GitHub) + pack-smoke run LOCALLY: all 4 packages pack, scratch-install, and resolve OK
  * [x] Task 0.7b: 🔥 FOUND+FIXED production bug via pack-smoke — electron-manager@1.12.0 ON NPM fails every fresh consumer install (postinstall runs scripts/sync-nvmrc.js but `files` didn't ship scripts/). Fixed in monorepo copy (files += "scripts/"); verified: tarball ships script, install succeeds, postinstall syncs consumer .nvmrc. NOTE: live npm package still broken → 1.12.1 publish is the natural Task 0.8 gate candidate (Ian's go required).
  * [ ] Task 0.8: GATE — publish one old-name patch from the monorepo (electron-manager@1.12.1 with the files fix). **Ian is handling this himself in another session**; Phase 1 proceeds in parallel per his go ("commit and continue").
* [ ] Phase 1: Foundation packages
  * [x] Task 1.1a: @omegajs/devkit first files — logger (identical ×4, EM's cleaned copy canonical), safe-install (byte-identical ×4), attach-log-file (functionally identical ×4; header normalized to `# omega log`). Private workspace package, 17 unit tests green (node:test until the shared runner slice lands).
  * [x] Task 1.1b: Vendor-on-prepare mechanism (packages/devkit/tools/vendor.js) — copies devkit src → dist/vendor/devkit + rewrites requires to relative paths + guards that hosts declare vendored modules' runtime deps. Proven on extension: 3 shims adopted, suite 85 passing (unchanged), pack→scratch-install resolves + runs the vendored logger, shipped dist has zero raw @omegajs requires. CI: devkit suite added; pack-smoke gained the self-containment grep (the hard gate, since prepare-package after-hooks are non-blocking).
  * [x] Task 1.1c: Adopt devkit shims in packages/desktop — logger + safe-install + attach-log-file shimmed (Electron-specific logger-lite stays EM-owned); suite 751 passing / 5 designed skips (unchanged); pack-smoke resolves + self-contained + vendored logger runs in a bare consumer + scripts/sync-nvmrc.js still ships. **Backend deferred to its harmonization step (Task 1.3-adjacent)** — BEM has no dist layer yet, so there's nothing for the vendor hook to rewrite (its bin requires src/ directly).
  * [ ] Task 1.1d: devkit test-runner slice — shared runner core + Chromium runner extracted from UJM's 3-layer model; frameworks adopt
  * [ ] Task 1.2: Sandbox brand monorepo (fresh, via scaffolding path) + `omega e2e` cross-stack harness in CI
  * [ ] Task 1.3: @omegajs/account extraction (golden-master gate)

## ✅ Completed Task List
