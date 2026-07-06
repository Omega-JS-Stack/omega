# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `@omegajs/devkit` test-runner slice: `test/runner-core.js` (the shared discovery/suite/group/standalone/filter/skip/init/reporting engine — UJM's canonical 3-layer runner, parameterized by title, package name, target alias, suites dir, middle layers, and boot glue), `test/assert.js` (was byte-identical ×3), and a `makeExtendedModeWarning()` factory. Extension adopted: its `runner.js` shrank to ~90 lines of BXM-specific config + layer glue; suite unchanged at 85 passing; devkit suite at 30 tests.
- Vendor tool upgrades: **selective vendoring** (only the modules the host's dist actually requires, plus transitive relative requires — a safe-install-only host ships one file and needs only node-powertools declared) and rewriting of `require.resolve()` forms (the chromium runner inlines devkit's assert SOURCE into the browser harness). CI's self-containment grep widened to match `require.resolve` too.
- `@omegajs/devkit` (private workspace package) — first slice of the shared build-time internals: `logger` (was identical ×4 across UJM/BXM/EM/MAM), `safe-install` (byte-identical ×4), `attach-log-file` (functionally identical ×4, header normalized to `# omega log`). 17 unit tests (node:test).
- Devkit **vendor-on-prepare** mechanism (`packages/devkit/tools/vendor.js`): frameworks require devkit modules by name as a workspace-linked devDependency; each framework's `preparePackage.hooks.after` copies devkit src into `dist/vendor/devkit/` and rewrites the requires to relative paths, so published tarballs stay self-contained while devkit stays private. Guards that hosts declare the runtime deps vendored code needs (chalk, node-powertools).
- `packages/extension` adopted devkit via 3 one-line shims (`src/lib/logger.js`, `src/lib/safe-install.js`, `src/utils/attach-log-file.js`) — suite unchanged at 85 passing; packed tarball verified self-contained.
- `packages/desktop` adopted the same 3 devkit shims (its Electron-specific `logger-lite` stays desktop-owned) — suite unchanged at 751 passing / 5 designed skips; pack-smoke verified (resolves, self-contained, vendored logger runs in a bare consumer, `scripts/sync-nvmrc.js` still ships). Backend adoption deferred until BEM gains its dist layer (harmonization step).
- CI: devkit suite added to the test job; pack-smoke gained a "no raw `@omegajs` requires in shipped dist" self-containment check (the hard gate — prepare-package `after` hooks are non-blocking by design).
- Monorepo skeleton: npm workspaces (`packages/*`, `spikes/*`, `apps/*`), Node pin, base docs (README, CLAUDE.md, PROGRESS.md).
- Changesets (`@changesets/cli`) for independent package versioning.
- Framework packages plain-copied from their (untouched, read-only) source repos: `packages/backend` ← backend-manager@5.11.7, `packages/client` ← web-manager@4.3.4, `packages/extension` ← browser-extension-manager@1.7.3, `packages/desktop` ← electron-manager@1.12.0. Legacy npm names retained until gated cutovers.

### Fixed
- Root `.gitignore` comment claimed `packages/*/dist` is tracked — it never was (each package's own `.gitignore` ignores its dist, matching framework-repo convention; prepare-package regenerates dist on install/pack/publish).
- `packages/desktop` package.json `files`: added `scripts/` — the published electron-manager@1.12.0 declares `postinstall: node scripts/sync-nvmrc.js` but never shipped the script, so every FRESH consumer install fails on npm today. Found by the pack→scratch-install smoke; verified fixed (tarball ships the script; postinstall syncs consumer .nvmrc).
- `packages/desktop` test runners (`src/test/runners/electron.js`, `boot.js`): electron now resolved via `require.resolve('electron', { paths: [projectRoot] })` instead of hardcoded `<root>/node_modules/electron`, so hoisted npm-workspace installs are found. Behavior unchanged for standalone consumers. Result: desktop suite 751 passing (was 299 with 47 hoisting skips).
