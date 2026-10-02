# Contributing to OMEGA

This repo is the OMEGA monorepo: every `@omega.js/*` package, the test brands, the docs and the coding-agent plugin. The rules for working here live in [AGENTS.md](AGENTS.md), and the knowledge lives in [docs/](docs/omega.md). This page is the short tour.

## Layout

| Directory | Contents |
|-----------|----------|
| `packages/` | The frameworks (`web`, `backend`, `extension`, `desktop`), the orchestration engine (`manager`), the shared runtime (`client`), the agent tool router (`mcp-router`), and the private shared internals (`account`, `analytics`, `config`, `devkit`, `monitoring`, `template-kit`) |
| `brands/` | The four in-repo test brands: `naked-brand` (bare fixture for walkthrough QA), `sandbox-brand` (synthetic fixture for the corpus and e2e), `playground-omega` ("OMEGA Playground", classy theme) and `newsflash-brand` ("The Daily Build", newsflash theme). The real brand lives in a sibling repo |
| `docs/` | The knowledge home: cross-framework contracts in `docs/shared/`, each framework's guide in `docs/<framework>/` |
| `agent-plugins/` | Knowledge shipped to coding agents. `claude/` is a Claude Code plugin (skills and hooks) that the committed `.claude/settings.json` installs after one trust prompt |

## What publishes

Published packages live under the `@omega.js` npm scope. The private shared internals never publish: they are bundled into the frameworks at build time. `@omega.js/client` publishes as a real runtime dependency of the frameworks that use it. The full list and the release steps are in [docs/shared/publishing.md](docs/shared/publishing.md).

## Development

`npm start` at the root watches every dist-building package at once (src to dist). At a brand root, `omega i local` links every `@omega.js/*` dependency from this monorepo, brand-wide (`omega i live` restores the registry versions), and `omega dev --local` links first, then boots the stack with the watch. The details are in [docs/shared/local-dev.md](docs/shared/local-dev.md), and the test lanes in [docs/shared/testing.md](docs/shared/testing.md).

## Status

Live work is tracked as [GitHub issues](https://github.com/Omega-JS-Stack/omega/issues): the queue is a query (`gh issue list`). Standing rulings live in [docs/shared/rulings.md](docs/shared/rulings.md).

## The README hero

The README's hero is `.github/assets/hero.gif`. Its generator source is kept outside the repo.
