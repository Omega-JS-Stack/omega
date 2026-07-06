# Project Progress Tracker
> Agents and maintainers should update this file regularly to reflect the current state of the project.

## 🎯 Current Focus
* **Goal:** Test discovery `_`-dir exclusion fix (mirrored from EM)
* **Current Phase:** Complete — shipped as v1.7.2
* **Priority:** Medium
* **Last Updated:** 2026-07-02 2:57 PM PDT
* **Notes:** Shipped 2026-07-02 (npm + GH release). Same fix shipped in UJM v1.9.24 in the same pass. BEM already correct (recursive walker), EM has the fix committed upstream.

## 📌 Active Task List
* [x] One-off: `--extended` boolean-declaration fix in bin (2026-07-02)
  * [x] Bare `yargs(...).parseSync()` let `mgr test --extended some/target` swallow the target as the flag's VALUE (target lost + extended silently off); bin now declares `.boolean(['extended'])` — mirrors BEM's cli fix; same fix applied to UJM + EM in the same pass
  * [x] Verified: parse proof (before/after) + real bin run shows `target="..." +extended` + `build/cli` suite 6 passing; CHANGELOG [Unreleased]
* [x] One-off: Test discovery `_`-dir exclusion fix (2026-07-02)
  * [x] `runner.js` discovery globs ignored only top-level `_` entries (`['_**']`) — files under `_`-prefixed dirs (e.g. `test/_helpers/x.js`) were discovered as suites; both globs now share exported `DISCOVERY_IGNORE = ['**/_*.js', '**/_*/**']` (mirrors EM's fix)
  * [x] TDD: new build-layer `test-discovery.test.js` (red → green against a real temp tree); full suite 85 passing
  * [x] Docs: `docs/test-framework.md` underscore-convention paragraph + CHANGELOG [Unreleased]

## ✅ Completed Task List
