# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Monorepo skeleton: npm workspaces (`packages/*`, `spikes/*`, `apps/*`), Node pin, base docs (README, CLAUDE.md, PROGRESS.md).
- Changesets (`@changesets/cli`) for independent package versioning.
- Framework packages plain-copied from their (untouched, read-only) source repos: `packages/backend` ← backend-manager@5.11.7, `packages/client` ← web-manager@4.3.4, `packages/extension` ← browser-extension-manager@1.7.3, `packages/desktop` ← electron-manager@1.12.0. Legacy npm names retained until gated cutovers.

### Fixed
- `packages/desktop` package.json `files`: added `scripts/` — the published electron-manager@1.12.0 declares `postinstall: node scripts/sync-nvmrc.js` but never shipped the script, so every FRESH consumer install fails on npm today. Found by the pack→scratch-install smoke; verified fixed (tarball ships the script; postinstall syncs consumer .nvmrc).
- `packages/desktop` test runners (`src/test/runners/electron.js`, `boot.js`): electron now resolved via `require.resolve('electron', { paths: [projectRoot] })` instead of hardcoded `<root>/node_modules/electron`, so hoisted npm-workspace installs are found. Behavior unchanged for standalone consumers. Result: desktop suite 751 passing (was 299 with 47 hoisting skips).
