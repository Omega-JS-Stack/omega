# OMEGA

The OMEGA monorepo — a unified full-stack framework ecosystem for launching and operating brands: website, backend, browser extension, and desktop app from one source of truth.

Published packages live under the `@omega.js` npm scope. Private shared internals (`account`, `analytics`, `config`, `devkit`, `template-kit`) are bundled into the frameworks at build time; `@omega.js/client` publishes as a real runtime dependency of the desktop and extension frameworks.

## Layout

| Directory | Contents |
|-----------|----------|
| `packages/` | Framework packages (`web`, `backend`, `extension`, `desktop`) + the orchestration engine (`manager`) + shared internals (`client`, `account`, `analytics`, `config`, `devkit`, `template-kit`) |
| `brands/` | The four in-repo test brands: `naked-brand` (bare fixture for walkthrough QA), `sandbox-brand` (synthetic fixture for the corpus/e2e), `playground-omega` ("OMEGA Playground", classy theme), `newsflash-brand` ("The Daily Build", newsflash theme) — the real brand lives in a sibling repo |
| `docs/` | The knowledge home: cross-framework contracts in `docs/shared/`, each framework's guide in `docs/<framework>/` |
| `agent-plugins/` | Knowledge shipped to coding agents — `claude/` is a Claude Code plugin (skills + hooks) that the committed `.claude/settings.json` auto-installs after one trust prompt |

## Development

`npm start` at the root watches every dist-building package concurrently (src→dist). In a brand repo, `omega dev --local` links all `@omega.js/*` deps from this monorepo and starts the watch for you; `mgr i local` does the same for a single target. See [docs/shared/local-dev.md](docs/shared/local-dev.md).

## Status

Live work is tracked as [GitHub issues](https://github.com/Omega-JS-Stack/omega/issues) (the queue is a query: `gh issue list`); standing rulings live in [docs/shared/rulings.md](docs/shared/rulings.md).

## License

[Elastic License 2.0](LICENSE). The source is free to use and modify; a license key unlocks payments in production deploys and removes the attribution (local dev and test payments are always free); and you may not offer these packages to third parties as a hosted or managed service.
