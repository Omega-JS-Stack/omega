# OMEGA

The OMEGA monorepo — a unified full-stack framework ecosystem for launching and operating brands: website, backend, browser extension, and desktop app from one source of truth.

Published packages live under the `@omegajs` npm scope. Shared internals are private workspace packages bundled into the frameworks at build time.

## Layout

| Directory | Contents |
|-----------|----------|
| `packages/` | Framework packages (`web`, `backend`, `extension`, `desktop`) + shared internals (`client`, `account`, `config`, `devkit`, `template-kit`) |
| `spikes/` | Time-boxed experiments (Eleventy vs Astro bake-off) |
| `apps/` | Sandbox brand for dogfooding and cross-stack e2e |
| `docs/` | Shared-concept deep references |

## Status

Early bootstrap — see [PROGRESS.md](PROGRESS.md).
