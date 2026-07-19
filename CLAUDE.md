# OMEGA Monorepo

> Architectural overview only — deep references live in `docs/<topic>.md`. Keep this file under 250 lines.

## Identity

The OMEGA monorepo holds the `@omega.js` framework ecosystem: the successors to backend-manager (BEM), browser-extension-manager (BXM), electron-manager (EM), web-manager (WM), and ultimate-jekyll-manager (UJM — replaced by the new `@omega.js/web`, not ported). One repo, npm workspaces, changesets for independent versioning. Remote: [github.com/Omega-JS-Stack/omega](https://github.com/Omega-JS-Stack/omega) (npm org `omega.js`, GH org `Omega-JS-Stack` — both Ian's, names final).

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Every package here is `@omega.js/*`-named; zero npm publishes until Ian finalizes versions.** Old-name releases (backend-manager@5.x, electron-manager@1.x, …) ship from the LEGACY repos (Ian-owned); the monorepo's `pre-*-rename` tags are the backup lane.
3. **Publish policy — internal by default**: private shared packages (`account`, `config`, `devkit`, `template-kit`) are vendored into published frameworks at prepare time and never publish. Published = frameworks + `@omega.js/manager` + `@omega.js/client` (a real runtime dependency of desktop/extension since the client cutover — never vendored; see [docs/local-dev.md](docs/local-dev.md)).
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## Config: omega.json5

Single config format everywhere: shared sections (brand, firebaseConfig, analytics, payment, sentry, oauth2, theme) + a `targets` object (key presence = target enabled; values = target config; any shared key inside a target entry overrides it). Merge chain: `defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>`. Secrets stay in `.env` — the validator hard-fails secret-shaped keys in config. **No dual-read (Ian's call, 2026-07-06)**: frameworks flip to omega.json5 outright; legacy brands convert once via the mapping tables in [docs/config.md](docs/config.md). Owned by `@omega.js/config`; EM flipped first (desktop settings under `targets.desktop`, per-OS `targets` renamed `platforms`).

## Brand topology (who is who — settled with Ian 2026-07-11)

- **`apps/sandbox-brand`** — synthetic fixture for the AUTOMATED corpus/e2e (offline, `demo-*` Firebase, deterministic; test runs may mangle and reset it). Never touches real cloud.
- **`apps/omega-playground`** (renamed from omega-brand, Ian 2026-07-11 — zero ambiguity) — the hand-dogfood REHEARSAL brand: born through the real wizard, explicitly playground-branded (id `omega-playground`, name "OMEGA Playground", url playground.omegajs.dev — a SUBDOMAIN so derived surfaces never claim the real omegajs.dev) and pointed at the real-but-throwaway Firebase project `omegajs-playground` (ITW-org-owned since 2026-07-11; sanctioned for live proofs — Blaze it, break it, delete it; it is TEST INFRASTRUCTURE, never production). Secrets live only in `.env`/`.omega/secrets` (gitignored; the config loader hard-fails secret-shaped keys) — the committed omega.json5 carries public-by-design values only.
- **`apps/newsflash-brand`** (added with Ian 2026-07-17) — "The Daily Build" (id `daily-build`, url dailybuild.omegajs.dev — same subdomain rule): the standing SECOND-SKIN brand, a fictional dev-news publication wearing the newsflash theme permanently so both first-party skins stay alive in real consumers (classy = playground, newsflash = here). Born by COPY of the playground — the wizard rehearsal is a separate queued exercise; OFFLINE-only (demo-* Firebase, no real cloud/services, never production); website + backend targets only; website dev port pinned 4100 for side-by-side, backend rides N7 bumps.
- **The real OMEGA brand — BORN 2026-07-18 (cp229), LIVE 2026-07-19 (cp232), LOCAL ERA**: lives at `../omega-brand` (sibling repo with its own git history; folder + repo renamed from omegajs.dev per Ian 2026-07-19 — consistent with the `*-brand` family, and bare "omega" is the monorepo; GitHub: `itw-creative-works/omega-brand` via the `github.repo` slug — the legacy orgWebsite housing). Id `omega`, name "OMEGA", url omegajs.dev (LIVE — GitHub Pages + Cloudflare), classy theme, website port 4200, website + backend targets. Born by FORKING the playground's polished content 1:1 (never a promotion of the test project; stale es caches dropped and re-translated fresh), it is the first SUB-BRAND of Ian's eventual company umbrella (the config `company` layer models this). **Local era (Ian 2026-07-18: "still use local … until we are fully locked on all decisions that may result in breaking changes")**: every `@omega.js/*` dep is a committed relative `file:` spec into THIS monorepo; versions pre-reset to 1.0.0 (cp228) so first publish flips them to `^1.0.0` seamlessly. Backend still offline (demo-omega Firebase; the real project `omegajs` is MINTED 2026-07-19 — web app + sdkconfig captured in the brand's `.omega/` — the config flip is a deliberate step gated with Blaze + backend deploy). REMAINING GATES (Ian's): the npm publish; the demo→omegajs firebase flip; one CI-dispatch exercise. The in-repo brands and the playground project stay test-only forever; nothing in this monorepo is ever the production brand. Content/section architecture: [plans/omega-sections-spec.md](plans/omega-sections-spec.md).

## Local dev loop

Root `npm start` watches every dist-building package concurrently (single-instance lock); `omega dev --local` in a brand's website app links every `@omega.js/*` dep brand-wide from this monorepo and starts the watch; `omega i local` does the same per app. Mechanics: `@omega.js/devkit/local`. Full contract: [docs/local-dev.md](docs/local-dev.md).

## CLI bins

Every framework ships `omega` + `omg` + `mgr` — all three are the SAME context-aware dispatcher (`@omega.js/devkit/omega-bin`): the nearest package.json walking up from cwd (incl. a backend's `functions/`) names the framework, and THAT framework's CLI runs via its `./cli` export — so npm's arbitrary hoist-winner in a brand monorepo is always correct. No app context (fresh dir) → falls back to the HOST framework's CLI with a stderr note, which keeps `omega setup` bootstrap working. `omega-<framework>` bins run their own CLI directly, no dispatch. Docs say `npx omega`; `omg`/`mgr` are supported aliases.

## Deliberate deploys (D13)

Commits never auto-publish: scaffolded workflows carry NO push triggers (workflow_dispatch + repository_dispatch only). Publishing is the explicit `omega deploy` verb on every target — web/extension dispatch their CI workflow, desktop delegates to its release flow, backend runs `firebase deploy` directly (`--only hosting` works on Spark). Content-publish implies deploy (the admin post routes dispatch the website build; `deploy: false` opts out). One executor for all surfaces: `@omega.js/devkit/deploy`. Full contract: [docs/deploys.md](docs/deploys.md).

## Icons

One Font Awesome mechanism everywhere: plain `fa-*` markup (static or set via JS — the shared `@omega.js/client` icon-renderer watches both), `uj_icon` for build-time inlining, best-first asset chain with brand-supplied Pro (never redistributed). Full contract: [docs/icons.md](docs/icons.md).

## Theming (classy v2)

One design-system contract: the `--omega-*` token sheet (names = stable API; light+dark plumbing built in), `brand.color` → light + dark accent ramps emitted into every head, the `.omega-shell` app chrome, and the shared motion library (`@omega.js/client` motion engine + `data-omega-*` attributes; no-JS and reduced-motion safe). classy v2 is the flagship skin: warm-paper/charcoal neutrals, zero gradients, ink primaries, serif marketing display; consumers customize colors/vibe/type from their main.scss (or fork `themes/_template`). Full contract: [docs/theming.md](docs/theming.md). Visual spec: [plans/classy-v2/DIRECTION.md](plans/classy-v2/DIRECTION.md).

## Sections & components

Pages are compositions of `{% section %}`/`{% component %}` calls; each entry is a folder owning markup + scss + js + json5 schema (resolution: consumer `_sections` → active theme → classy base, whole-folder first-wins). Markup is context-free (`{ args }` only; call-site liquification), section scss/js ride the §7 asset lanes (main sheet via `omega:sections`, main bundle behind DOM-presence init), and SHARED bands keep neutral json5 defaults — every page owns its copy. Consumer page frontmatter is META-ONLY (layout/permalink/meta/schema/theme/sitemap/append) — content keys FAIL the build; content entries (`_posts`/`_team`/…) keep frontmatter as their document. Full contract: [docs/sections.md](docs/sections.md). Spec/sequencing: [plans/omega-sections-spec.md](plans/omega-sections-spec.md).

## The plan

The full redesign plan (context, architecture, phases, gates, amendments): [plans/omega-redesign-master-plan.md](plans/omega-redesign-master-plan.md) — vendored in-repo so it survives chat resets. Live status: [PROGRESS.md](PROGRESS.md).
