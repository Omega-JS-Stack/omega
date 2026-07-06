# Project Progress Tracker
> Agents and maintainers should update this file regularly to reflect the current state of the project.

## 🎯 Current Focus
* **Goal:** Bootstrap the OMEGA monorepo (Phase 0) — skeleton, workspaces, framework copies, CI, first old-name publish gate
* **Current Phase:** Phase 0 — Bootstrap
* **Priority:** High
* **Last Updated:** 2026-07-05 7:50 PM
* **Notes:** CI written + local pack-smoke green ×4 after fixing a LIVE npm bug (electron-manager@1.12.0 fresh installs fail — missing scripts/ in `files`; fixed in monorepo copy; 1.12.1 publish = natural Task 0.8 gate, needs Ian's go). Suites: client 73 / extension 85 / desktop 751 / backend 2-standalone. Uncommitted: ci.yml + desktop files-fix + tracker updates — awaiting Ian review→commit. Also pending Ian: @omegajs org claim, GitHub remote creation (CI verification needs a push). `mgr` bin alias wrinkle documented.

## 📌 Active Task List
* [ ] Phase 0: Bootstrap the monorepo
  * [x] Task 0.1: Create repo skeleton (packages/, spikes/, apps/, docs/, package.json workspaces, .nvmrc, .gitignore, README, CLAUDE.md, PROGRESS.md, CHANGELOG.md)
  * [x] Task 0.2: Probe @omegajs npm scope (no packages exist; Ian to claim org on npmjs.com)
  * [ ] Task 0.3: Initial commit (awaiting Ian's go — no commits without request)
  * [x] Task 0.4: Install + configure changesets (@changesets/cli ^2.31.0, .changeset/ initialized)
  * [x] Task 0.5: Plain-copy backend-manager, web-manager, browser-extension-manager, electron-manager into packages/{backend,client,extension,desktop} (rsync minus .git/node_modules/.env/logs/lockfiles; secret scan clean — only BEM's demo-project test fixture; MAM excluded as parked)
  * [x] Task 0.6: Workspace install + suites GREEN in-place — client 73 passing; extension 85 passing; desktop 751 passing / 5 designed extended-mode skips (required 2 hoisting fixes: src/test/runners/electron.js + boot.js now resolve electron via require.resolve(paths:[projectRoot]) instead of hardcoded <root>/node_modules/electron — behavior identical for consumers); backend 2 passing = its complete standalone suite (real BEM corpus runs in consumers; emulator stack self-orchestrated successfully from the monorepo, proving java+firebase-tools env)
  * [x] Task 0.7: CI workflow written (.github/workflows/ci.yml — 4 suites w/ xvfb+java, pack→scratch-install smoke; CI verification pending first push to GitHub) + pack-smoke run LOCALLY: all 4 packages pack, scratch-install, and resolve OK
  * [x] Task 0.7b: 🔥 FOUND+FIXED production bug via pack-smoke — electron-manager@1.12.0 ON NPM fails every fresh consumer install (postinstall runs scripts/sync-nvmrc.js but `files` didn't ship scripts/). Fixed in monorepo copy (files += "scripts/"); verified: tarball ships script, install succeeds, postinstall syncs consumer .nvmrc. NOTE: live npm package still broken → 1.12.1 publish is the natural Task 0.8 gate candidate (Ian's go required).
  * [ ] Task 0.8: GATE — publish one old-name patch from the monorepo (candidate: electron-manager@1.12.1 with the files fix); canary consumer behaves identically

## ✅ Completed Task List
