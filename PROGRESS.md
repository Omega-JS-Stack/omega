# PROGRESS — omega
<!-- board-spec: v2 | spine: cpNNN -->
> Board only — detail lives in CHANGELOG.md, docs/, plans/, commits. Master plan: plans/omega-redesign-master-plan.md. Full pre-v2 board: `_attic/PROGRESS.v1.md`.

## Now
- [fable 2026-07-24] cp270 SHIPPED; remaining Ian input: rekey naming ruling (plans/wave6-review-findings.md — D3/D4 ride it), then triage (35 inbox)

## Next
### Phase A — Ian-ratified queue (2026-07-20)
- Playground CMS creates (arc close) once the source repo's `main` exists
### Website polish backlog (Ian 2026-07-21, "for after the review")
- 28 items: bugs (contact, redirect rebuild, auth kick-out), design/copy (pricing, about, checkout), features (uj_ rename, ad slots, FA-Pro PROPOSE-FIRST) → plans/website-polish-backlog.md
### Ian-queued (2026-07-22)
- Docs+skills revamp (WIDENED 07-22): rewrite all 7 omega:* skills + COMPLETE AGENTS.md rewrite — after waves → plans/agent-docs-skills-reorg.md
- Test harmonization + comprehensiveness pass (real-Chrome extension auth e2e, real-Electron desktop auth e2e, per-package gap table) — after the review waves → plans/test-comprehensiveness.md
### Phase B — Launch wiring (after reviews)
- cp239: single-command launch wired INSIDE existing verbs (manage pipeline DEPLOY_LEGS + Pages/domain/cloudflare/verify; onboarding stays one-time)
- Review waves 2–6: manager+backend → web engine/themes → config+client/account/template-kit → desktop/extension+brands → DX+security (2× Fable medium via Workflow, Ian-gated between waves)
- First 0.1.0 publish-proving: release-check → unlatch private:true → publish order client→backend→dependents → outside verify → `omega i live` flip → docs/publishing.md
- Certificates auto-copy leg: legacy Apple store → brand `.omega/certificates/` (portable/CI signing era)
### Phase C — Tabled (Ian 2026-07-18)
- Admin dashboard v2 candidates (usage panel, feedback inbox, campaign stats, Sentry shortcut, MCP tokens, revenue) — refine with Ian first
- Brand rebuilds somiibo → sweet-saucy — HARD GATE: explicitly ask Ian before starting either; password formula → company hook at migration

## Blocked
- GO publish: first 0.1.0 publish-proving after waves — prereq: npm org `omega.js` rights for itwcw2000 (`npm org ls` 403s; first publish is the definitive test; 2FA surfaces then)
- GO org-move: move project `omegajs` into `itw-creative-works-org` + org-level manage grant (propose-first; project is currently org-less — why API owner grants failed)
- GO skins: both skins await Ian's eyes — classy/Paperloom (cp147–185) + The Daily Build (cp186–193); fall-through two-lane direction stands
- GO apple-certs: cert-store copy for portable/CI signing (local signed builds work today via Keychain; cp131/cp142)
- GO cloudflare-purge: Ian fixed the token scope 2026-07-20 — next website deploy proves purge live
- GO adsense: console site-add + ads.txt — tabled until omega publishes (Ian 2026-07-14)
- GO payment: Stripe radar/disputes latches + real Stripe account (Ian's named wariness; PayPal + Chargebee SKIPPED — never suggest)
- GO ci: all CI dispatch-only and PAUSED; even deliberate dispatches are Ian's call

## Rulings
- Ian 2026-07-21: adblock-safe naming — the ad system speaks vert EVERYWHERE (paths, DOM, collection, API, modules); only ads.txt, Google's own ad* tokens, `advertising` config key say ad
- Ian 2026-07-21: "DO NOT USE EM DASHES… REWRITE EVERYTHING TO MAKE SENSE WITHUT IT" — site/brand copy never uses em dashes; manual rewrites, not deletions
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
- Publish-time checklist (nothing gated; Ian 2026-07-22 "stop reminding"): next backend deploy ships B3 + regenerate omega-brand firestore.rules (pre-B7); live verify sweep after
- Dev-mode `source: 'company'` resolves the LOCAL stack, ignoring company.url (getApiUrl dev branch) — defensible; Ian ratifies or we add a dev override (cp253 finding)
- AdSense slot schema drift: schema documents flat '-slot' keys, client reads spec-shape `slots.*` — its own pass at the GO adsense gate (cp253 finding)
- devkit e2e-harness ~1-in-15 flake (mechanism uncaptured; two-pass runner + retry saves failing output to .temp/) → CHANGELOG 124
- web ships @anthropic-ai/claude-agent-sdk ^0.2.138 as runtime dep (backend ^0.3.153) — diet later (wave-1 finding)
- prepare-package swallows after-hook (vendor) failures as non-blocking — release-check is the net; upstream fix would be in the external package
- blogify/optimize NOT ported (cp140 verdict) — revisit post-launch if Ian wants
- Brand-migration tooling (PINNED) must convert pre-family file formats (legacy markers) — evergreen setup speaks one marker family → CHANGELOG 75

## Done
- cp270 2026-07-24 Ian's wave-6 calls: spikes→_attic, mailchimp/npm-api dropped (devkit npm-registry), remote-scripts OPT-IN (battery EXIT 0) → CHANGELOG
- cp269 2026-07-24 wave-6 remediation: CLI help/unknown contract, TLS gate on desktop remote lanes, alias+docs parity, dependabot triage (battery EXIT 0) → CHANGELOG
- cp268 2026-07-23 authDomain=brand host + self-hosted OAuth handler, @dev-only strip, advertising rekey, CLAUDE.md→AGENTS.md (battery EXIT 0) → CHANGELOG
- cp267 2026-07-23 wave-5 remediation: all 15 desktop/extension/brand defects closed incl. authDomain contract (battery EXIT 0) → CHANGELOG
- cp266 2026-07-23 wave-4 remediation: all 17 config/client/template-kit defects closed (2× Fable review; battery EXIT 0) → CHANGELOG
- cp265 2026-07-23 newsletter wired to marketing/contact + shared recaptcha lib + W16 seeded 10k-30k (battery EXIT 0) → CHANGELOG
- cp264 2026-07-22 wave-3 remediation: 20/21 web engine+theme defects closed (2× Fable review; battery EXIT 0) → CHANGELOG
- cp263 2026-07-22 assistant → RouteContext/ctx: module split, one respond door, report() + auto-Sentry rule (battery EXIT 0) → CHANGELOG
- cp262 2026-07-22 legacy-name sweep: wm/em/bem/bxm/ujm identifiers → omega/current names on every runtime surface (battery EXIT 0) → CHANGELOG
- cp261 2026-07-22 omega.request() harmonized fetch layer + usage/device bindings split + desktop/extension callers (battery EXIT 0) → CHANGELOG
