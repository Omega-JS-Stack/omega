# Project Progress Tracker
> Status board — one line per item. Detail lives in CHANGELOG.md (shipped), docs/ + package READMEs (behavior), and commit messages (journey). Master plan: [plans/omega-redesign-master-plan.md](plans/omega-redesign-master-plan.md) (Phases 0–5 + amendments header).

## 🎯 Now
- **cp198–200 LANDED (sweep → Fable review → Ian's rulings)**: FOUC killed (theme-aware font preloads, deterministic, layer fall-through), permalinkOf frontmatter-only, sandbox e2e in root `npm test`, dead SW cache-warming REMOVED (SW = push + takeover only, NO fetch handler by design) — web 183/0, corpus 7/7, backend 1242, e2e PASSED
- **Both skins await Ian's eyes**: classy (cp147–185, playground) · The Daily Build (cp186–193, dark/light/mobile swept) — stacks not currently running; `npm start` at each brand root boots them; fall-through two-lane direction stands unchallenged; playground CMS creates land once the source repo's `main` is born (arc close)

## 🗺 Next (order = Ian's directives > master plan > this queue; reorder freely)
1. **SKIN PASS remainder (after DRAFT 1)** — showcase → arc close (template repo cut OUTSIDE the monorepo — cp194 pre-cleared the topology; **DON'T FORGET (Ian 2026-07-12): playground source lands on the EXISTING Omega-JS-Stack/omega-playground repo's main + CI workflows — `omega deploy` CI dispatch then REPLACES the direct gh-pages push, nothing manual survives**); showcase touches playground = LOCKED until Ian lifts the theme-arc touch-freeze; C4 sharing DONE (cp104–112); FOUC DONE (cp198); omegajs.dev wiring + api.playground zone-worker parent scope land at arc close; D5 vendored-webfont picks are Ian's call mid-arc
2. **Admin dashboard v2 candidates (Ian queued 2026-07-16 — refine together before building; they land in the cp182 shell)**: API-usage panel (the tracked `usage` collection), feedback inbox card, campaign/newsletter stats, Sentry errors shortcut, MCP token management, richer revenue once real orders accrue
3. Brand rebuilds on the new stack (post-dogfood): somiibo → sweet-saucy — **HARD GATE (Ian 2026-07-11): explicitly ask and wait for his go before starting either**; Ian's password formula → his company hook file at migration (Ian involved)

## ⏸ Blocked / Waiting (Ian-owned)
- **Apple key copy (cp131) — DOWNGRADED by cp142: local signed+notarized desktop builds work TODAY via the Keychain identity + ASC API key.** The copy (legacy `omega-manager/.output/_shared/certificates/apple/csr/*` dirs + the INSTALLER_G2 .cer → playground `.omega/certificates/apple/`) remains the path to PORTABLE/CI signing (.p12 export) + the installer cert for pkg targets; credential copies stay Ian-run
- **Cloudflare purge token gap (cp142 live find)**: CLOUDFLARE_TOKEN is DNS-scoped — add Zone → Cache Purge → Purge at dash.cloudflare.com/profile/api-tokens and post-deploy purges go live (the deploy warn-path + `omega purge` retry already handle the gap)
- **AdSense — TABLED until omega publishes (Ian 2026-07-14: "i cant do this until we publish omega")**; when live: console site-add + the (currently missing) ads.txt from the web parity gaps item
- Payment-adjacent (Ian's named wariness / launch-era): Stripe radar+disputes latches, real Stripe account for account-info. **PayPal + Chargebee legs SKIPPED (Ian 2026-07-14: stop suggesting them)**
- Releases FULLY gated (Ian 2026-07-10, reaffirmed): zero npm publishes AND zero GitHub releases until he says go; old-name releases ship from the LEGACY repos (monorepo `pre-*-rename` tags are backup)
- CI fully paused: dispatch-only workflows, even dispatches are Ian's call (ci.yml is pre-fixed for resumption: always()-post-mortems, src/dist paths)
- PINNED per Ian (2026-07-09): B5 `omega verify` + Phase 4 migrations + ALL migrator tooling (prerequisites of the gated brand rebuilds); audit port (explicit stub in web). MAM parked entirely.
- Auth mechanics SETTLED (Ian 2026-07-12, final): NO ITW CLI login exists or is needed — the manage cycle's cached browser-OAuth + his normal CLI login cover everything; NEVER suggest `firebase login`/`gcloud auth login` as ITW; manage-created projects land on the cached manager token's account inside `gcp.organizationId`. Blessed interactive form = `npm start` from the brand root (npx is npu-piped on his machine — never suggest it for interactive runs).

## 📏 Standing rules
- **Continuous mode (Ian 2026-07-10)**: keep iterating/building/testing autonomously, checkpoint after checkpoint — stop ONLY for serious errors or decisions that are genuinely Ian's.
- **Website target = GH Pages, ALWAYS (Ian 2026-07-12)** — web deploys go to GitHub Pages, never Firebase hosting (that's the backend/api surface only). DNS defaults (GH Pages A/AAAA) are correct as-is.
- **FA Pro supply = the local folder route (Ian 2026-07-12: no npm token)** — Omega/fontawesome-pro via OMEGA_FONTAWESOME_ROOT is THE Pro source; skin designs within solid/regular/brands.
- **Test-brand live policy (Ian 2026-07-11, scoped 2026-07-12)**: do as much as possible FOR REAL on omega-playground/omegajs-playground (Blaze it, break it, delete it — test infrastructure). Playground identity is EXPLICIT: id `omega-playground`, "OMEGA Playground", playground.omegajs.dev — derived surfaces must never claim the real omegajs.dev. **PAYMENT (+related) = Ian's named wariness → gated.** Still gated as truly-dangerous: ad-hoc writes to real ITW resources incl. the slapform/chatsy/replyify/server operator backends (the manage services' own convergence paths are the sanctioned route — 2b mints included, Ian 2026-07-13/14), omegajs.dev DNS/registrar/Cloudflare writes (propose-first each time), live-mode payment keys, mass email sends, seo public-repo creation, GH Actions runs, npm/store publishes. Credential file-to-file copies stay human-only — Ian pastes, Claude runs from there. **Deploys: playground standing-authorized but SPARING — only when a change genuinely needs live verification (and name-the-deploy applies); all other brands deploy ONLY on Ian's explicit ask.**
- **Orgs claimed + locked (Ian 2026-07-10)**: npm org `omega.js` and GH org `Omega-JS-Stack` are Ian's — names final. GH org: full control to create repos/push/try things. npm publishes REMAIN gated.
- **Data-shape preservation (Ian 2026-07-10)**: existing Firestore shapes + backend route semantics are presumed good. Any breaking change requiring data migration needs Ian's explicit OK — flag with a migration plan, don't build.
- Core-changes spec: [plans/omega-core-changes-inbox.md](plans/omega-core-changes-inbox.md) (DECIDED 10/10) is binding alongside the master plan; classy/CMS/admin arcs build systems/extensibility first — visuals are the easy part (Ian).
- Existing repos (omega-manager, all framework + consumer repos) are READ-ONLY — all work happens in this monorepo.
- Live checks NEVER touch real ITW repos/resources outside the sanctioned service paths — sandbox/fixture resources otherwise, creds scrubbed (`env -u`).
- No backwards compat (Ian 2026-07-06: dual-read cancelled) — implement + document the new way only.
- Checkpoint discipline: survey → design (de-ITW, non-interactive, .env creds, dry-run) → implement → tests → sandbox/fixture proof → docs → commit.
- Git: explicit `git -C` always; commit-and-continue is standing for THIS repo; `Co-Authored-By: Claude Fable 5` trailer.
- De-ITW'ing hardcoded company values into config = standard scope; best-implementation-wins normalization is licensed.
- CI runner-minutes: **ALL CI is OPT-IN** — dispatch-only ci.yml; even deliberate dispatches PAUSED without Ian; local suites are the verification.
- npu, never raw npm install/npx. Secrets never in omega.json5 — .env / .omega/secrets only (@omega.js/config hard-fails secret-shaped keys).
- Local-first (Ian 2026-07-09): zero npm publishes until Ian finalizes versions; migrators/verifiers pinned.

## ⚠ Parked findings (detail: the named task's CHANGELOG entry)
- **vert.js sits out of the module-bundle lane (182)**: it imports @omega.js/client, and a standalone IIFE would inline a SECOND client copy (breaks the ESM singleton) — ad units referencing vert.bundle.js stay non-functional until the ads lane gets manifest-driven URLs
- ~~Theme CSS fall-through asymmetry~~ **RESOLVED cp190**: two blessed lanes — partial themes `@forward 'omega:theme'` (self-skip hatch, now test-pinned), full sibling themes import classy's TOKEN-PURE app/auth partials as the floor (newsflash = the live model; classy app-vocab partials must stay token-pure) → docs/theming.md; Ian re-litigates at reconvene if he wants a different direction
- ~~SW can serve a cached 404 for assets (182)~~ **CLOSED cp198**: no fetch handler exists in the SW — it only does cache-warming (`cache.addAll`, which rejects non-ok by spec) and push notifications; the feared cache-serve-404 pattern cannot manifest
- ~~permalinkOf regex (155)~~ **FIXED cp198, hardened cp199**: frontmatter-only scan + quote/comment handling — body-text `permalink:` lines can no longer suppress framework defaults; 15-test pin
- ~~SW cache-warming is write-only (cp199 review find)~~ **REMOVED cp200 (Ian: page speed wins)**: SW = push + takeover + eviction only; NO fetch handler on purpose (header-pinned — fastest SW config, offline deliberately not wanted)
- **Extension background cache is write-only too (cp200 find)**: packages/extension `background.js` warms a cache nothing reads (one `caches.open`, zero reads) — same removal treatment on the extension surface's next pass
- **Sibling-theme builds ship the classy base layer's woff2s (cp199 review find)**: assets fonts-union copies all layers — unreferenced, never fetched, artifact fat only (~350KB in newsflash builds); prune at arc close if it bothers
- **Font-preload breadth = whole-site (cp199 design flag, Ian's call)**: classy preloads Inter 73KB + Newsreader 132KB on EVERY page — right for marketing first-paint, wasted on app-shell pages; per-layout preload lists are the refinement
- ~~First-paint blank flash (116/123)~~ **FIXED cp198**: theme-aware font preloads — engine scans active theme's normal-latin faces and emits `<link rel="preload">` before the stylesheet; both themes pinned + corpus invariant
- blogify/optimize NOT ported (cp140 verdict): blogify = fake-post test generator (the corpus generator covers it), optimize = GPT content-rewrite authoring tool — revisit post-launch if Ian wants them (140)
- devkit e2e-harness rare flake (~1-in-15, mechanism uncaptured): isolated two-pass runner + one retry that SAVES the failing output to .temp/ — the next firing names the mechanism; a real regression still fails twice (124)
- Brand-migration tooling (PINNED) must convert pre-family file formats — `{{ backend-manager }}` rules placeholder, `# BEM>>>` gitignore markers, `///---backend-manager---///` rules markers, and the cp72–74 interim `///---omega---///` flavor — evergreen `mgr setup` only speaks the one marker family now (75)

## ✅ Done (recent — full history: CHANGELOG.md + git log; the fat pre-slim tracker: `git show 99dc015:PROGRESS.md`)
- [x] 200 dead SW cache-warming removed (Ian: page speed wins) · preload layer fall-through pinned · build-meta assets trimmed · SW bundle-proven (no warm, push+takeover intact); web 183/0, corpus 7/7, e2e PASSED → CHANGELOG
- [x] 199 Fable review of cp198 — permalinkOf frontmatter-only + comment/quote handling (5 new pins) · preload order sorted deterministic · SW/e2e/preload mechanics confirmed clean · 3 findings parked; web 183/0, corpus 7/7, backend 1242, e2e PASSED → CHANGELOG
- [x] 198 parked-findings sweep — FOUC killed (theme-aware font preloads, both themes pinned, corpus invariant) · permalinkOf regex fixed (10-test pin) · SW cached-404 CLOSED (no fetch handler) · sandbox e2e promoted to root `npm test` (`OMEGA_SKIP_E2E=1` knob); web 178/0, corpus 7/7, sandbox 1242/0 → CHANGELOG
- [x] 197 brand-SHAPE corpus — 7 offline cells opening `test:corpus`; caught the LATENT cp157 red → swept to JOURNEY_ACCOUNTS, corpus green → CHANGELOG
- [x] 196 Ian's calls: onboard git init · deploy record · testing never-deployed truth table — journey re-proven with EMPTY allowlist → CHANGELOG
- [x] 195 wizard journey = STANDING LANE — 3 catches fixed+pinned; run #3 GREEN ~3.5 min → CHANGELOG
- [x] 194 wizard rehearsal — outside-monorepo brand birth; 7 catches → CHANGELOG
- [x] 192+193 NEWSFLASH skin pass — every surface, dark/light/mobile → CHANGELOG
- [x] 187–191 NEWSFLASH modernization → CHANGELOG
- [x] 186 The Daily Build born — second-skin brand by COPY → CHANGELOG
- [x] 185 round-10d rail/content heights → CHANGELOG
- [x] 184 round-10c 5002-no-redirect + vendor propagation → CHANGELOG
- [x] Phases 0–2 + cp33–183 — bootstrap through account dialect → CHANGELOG + git log

*Last updated: 2026-07-18 (cp200: dead SW cache-warming removed — SW = push + takeover only; preload fall-through pinned)*
