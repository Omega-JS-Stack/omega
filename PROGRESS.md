# PROGRESS — omega
<!-- board-spec: v2 | spine: cpNNN -->
> Board only — detail lives in CHANGELOG.md, docs/, plans/, commits. Master plan: plans/omega-redesign-master-plan.md. Full pre-v2 board: `_attic/PROGRESS.v1.md`.

## Now
- [fable 2026-07-20] Deploy chain armed on healed IAM → gate: Ian's two deploy verbs (see GO deploy), then Claude runs the live verify sweep

## Next
### Phase A — Ian-ratified queue (2026-07-20)
- Ads phase 3: admin dashboard ads CRUD card → plans/ads-system.md
- Ads phase 4: desktop/extension `data-omega-ad` binding via shared client ads module → plans/ads-system.md
- Multi-instance targets build (config normalization → manager iteration → fixture proof) → plans/multi-instance-targets.md
- Per-service `requires: { env, scopes }` preflight with friendly fix walkthroughs (model: cp236 google-auth 403 diagnostics)
- `omega update` verb: installed/current/latest/breaking per dep + 7-day release-age quarantine (npu-update semantics)
- Playground CMS creates (arc close) once the source repo's `main` exists
### Phase B — Launch wiring (after reviews)
- cp239: single-command launch wired INSIDE existing verbs (manage pipeline DEPLOY_LEGS + Pages/domain/cloudflare/verify; onboarding stays one-time)
- Review waves 2–6: manager+backend → web engine/themes → config+client/account/template-kit → desktop/extension+brands → DX+security (2× Fable medium via Workflow, Ian-gated between waves)
- First 0.1.0 publish-proving: release-check → unlatch private:true → publish order client→backend→dependents → outside verify → `omega i live` flip → docs/publishing.md
- Certificates auto-copy leg: legacy Apple store → brand `.omega/certificates/` (portable/CI signing era)
### Phase C — Tabled (Ian 2026-07-18)
- Admin dashboard v2 candidates (usage panel, feedback inbox, campaign stats, Sentry shortcut, MCP tokens, revenue) — refine with Ian first
- Brand rebuilds somiibo → sweet-saucy — HARD GATE: explicitly ask Ian before starting either; password formula → company hook at migration

## Blocked
- GO deploy: Ian runs `cd ../omega-brand/apps/backend && npm run deploy` then `cd ../omega-brand/apps/website && npm run deploy` — classifier refuses Claude-fired production deploys
- GO wave2: resume review waves 2–6 (protocol in Phase B line)
- GO publish: first 0.1.0 publish-proving after waves — prereq: npm org `omega.js` rights for itwcw2000 (`npm org ls` 403s; first publish is the definitive test; 2FA surfaces then)
- GO org-move: move project `omegajs` into `itw-creative-works-org` + org-level manage grant (propose-first; project is currently org-less — why API owner grants failed)
- GO skins: both skins await Ian's eyes — classy/Paperloom (cp147–185) + The Daily Build (cp186–193); fall-through two-lane direction stands
- GO apple-certs: cert-store copy for portable/CI signing (local signed builds work today via Keychain; cp131/cp142)
- GO cloudflare-purge: Ian fixed the token scope 2026-07-20 — next website deploy proves purge live
- GO adsense: console site-add + ads.txt — tabled until omega publishes (Ian 2026-07-14)
- GO payment: Stripe radar/disputes latches + real Stripe account (Ian's named wariness; PayPal + Chargebee SKIPPED — never suggest)
- GO ci: all CI dispatch-only and PAUSED; even deliberate dispatches are Ian's call

## Rulings
- Ian 2026-07-10: continuous mode — iterate/build/test autonomously, checkpoint after checkpoint; stop only for serious errors or genuinely-Ian decisions
- Ian 2026-07-19: "I refuse to run a single command — wrap it in npm start, self healing idempotent" — absorb, never hand back; blocked one-offs = framework gaps; wrapped verbs only
- Ian 2026-07-20: mirrored-implementation rule — same feature, same shape, every framework (cp242 deploys enforced it)
- Ian 2026-07-20: local-omega-in-production is a SUPPORTED feature — deploys auto-detect linked local frameworks and take local-artifact lanes
- Ian 2026-07-18: "still use local … until we are fully locked on all decisions that may result in breaking changes" — the local era (file: specs) holds until then
- Ian 2026-07-19: 0.x until live publishes are proven; 1.0.0 is a later deliberate graduation; zero npm publishes + zero GH releases until GO (old names ship from legacy repos)
- Ian 2026-07-12: website target = GH Pages ALWAYS; Firebase hosting is the backend/api surface only; GH Pages DNS defaults correct as-is
- Ian 2026-07-12: FA Pro = local folder route via OMEGA_FONTAWESOME_ROOT (no npm token); skins design within solid/regular/brands
- Ian 2026-07-11/12: playground = live test infra (Blaze/break/delete); payment+adjacent gated; deploys sparing + named; other brands deploy ONLY on explicit ask
- Ian 2026-07-13/14: ad-hoc writes to real ITW resources stay gated — manage services' own convergence paths are the sanctioned route (2b mints included)
- Ian 2026-07-18: credential copies from existing ITW brands SANCTIONED (brand .envs + omega-manager/.brands); new brands mint fresh identity keys; classifier-blocked copies fall to Ian
- Ian 2026-07-12 (final): NO ITW CLI login — cached browser-OAuth + normal CLI login cover all; never suggest firebase/gcloud login as ITW; npm start = the blessed form
- Ian 2026-07-10: data-shape preservation — Firestore shapes + route semantics presumed good; breaking changes needing migration = flag with plan, don't build
- Ian 2026-07-06: no backwards compat (dual-read cancelled) — new way only
- Ian 2026-07-09: legacy repos READ-ONLY (omega-manager, all framework + consumer repos); migrators/verifiers/B5 verify/audit port PINNED; MAM parked
- Ian 2026-07-20: per-app docs retire in brand context — the brand root is the ONE home (AGENTS.md chain + one README/docs/CHANGELOG)
- Standing: secrets never in omega.json5 (.env only; config hard-fails); npu never raw npm/npx; explicit `git -C`; commit-and-continue; de-ITW to config = standard scope
- Standing: checkpoint discipline — survey → design → implement → tests → sandbox/fixture proof → docs → commit; live checks never touch real ITW resources outside sanctioned paths

## Parked
- vert.js sits out of the module-bundle lane (imports @omega.js/client; standalone IIFE would double the singleton) — dies at ads phase 2 by design → plans/ads-system.md
- devkit e2e-harness ~1-in-15 flake (mechanism uncaptured; two-pass runner + retry saves failing output to .temp/) → CHANGELOG 124
- 61 dependabot alerts on github.com/itw-creative-works/omega → wave-6 security review triages
- web ships @anthropic-ai/claude-agent-sdk ^0.2.138 as runtime dep (backend ^0.3.153) — diet later (wave-1 finding)
- prepare-package swallows after-hook (vendor) failures as non-blocking — release-check is the net; upstream fix would be in the external package
- blogify/optimize NOT ported (cp140 verdict) — revisit post-launch if Ian wants
- Brand-migration tooling (PINNED) must convert pre-family file formats (legacy markers) — evergreen setup speaks one marker family → CHANGELOG 75

## Done
- cp248 2026-07-20 ads phase 2: shared client ads module + `ads/unit` section + detection rewrite (client 141/web 262; root battery EXIT 0) → CHANGELOG
- cp247 2026-07-20 local-dist freshness guard (auto-prepare + re-exec at every CLI boot; 14 pins; root battery EXIT 0) → CHANGELOG
- cp246 2026-07-20 per-app docs retired in brand context (devkit `retire` rule, mirrored ×4, sweeps run; root battery EXIT 0) → CHANGELOG
- cp245 2026-07-20 ads phase 1: backend house-ads module (53 pins; full suite 1295/0 re-verified) → CHANGELOG
- cp244 2026-07-20 brand agent-docs chain (manager-shipped guide + hoist-aware import + heal; live-proven) → CHANGELOG
- cp243 2026-07-20 sibling-theme font prune (~350KB out of newsflash artifacts) → CHANGELOG
- cp242 2026-07-20 auto-local deploys (mirrored rule; findLocalSpecs lanes on all four targets) → CHANGELOG
- cp241 2026-07-20 publish lanes complete — release-check 6/6 GREEN; `omega i live` restore; CI pack-smoke ×6 → CHANGELOG
- cp240 2026-07-20 review-fixes wave 1 (release-check harness, engines pins, git-native sync, diets) → CHANGELOG
- cp238 2026-07-19 every package 0.1.0 + mechanical publish latch → CHANGELOG