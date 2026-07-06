# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Monorepo skeleton: npm workspaces (`packages/*`, `spikes/*`, `apps/*`), Node pin, base docs (README, CLAUDE.md, PROGRESS.md).
- Changesets (`@changesets/cli`) for independent package versioning.
- Framework packages plain-copied from their (untouched, read-only) source repos: `packages/backend` ← backend-manager@5.11.7, `packages/client` ← web-manager@4.3.4, `packages/extension` ← browser-extension-manager@1.7.3, `packages/desktop` ← electron-manager@1.12.0. Legacy npm names retained until gated cutovers.
