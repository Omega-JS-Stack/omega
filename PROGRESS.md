# Project Progress Tracker
> Status board — one line per item. Detail lives in CHANGELOG.md (shipped), docs/ + package READMEs (behavior), and commit messages (journey). Master plan: [plans/omega-redesign-master-plan.md](plans/omega-redesign-master-plan.md) (Phases 0–5 + amendments header).

## 🎯 Now
- **NEXT: the skin pass — waiting ONLY on Ian's theme notes** ("no theme yet… more notes incoming"); meridian direction drafted (Ledger backbone + Fraunces voice); every systems prerequisite is shipped (nav/title/static-assets cp123, theme-once cp109, FA chain cp108/111/112)
- **AWAITING IAN'S NAMED GO: the bundled playground web deploy** (cp123 fixes → playground.omegajs.dev; auto-mode gate correctly held it — deploys are his to name)

## 🗺 Next (order = Ian's directives > master plan > this queue; reorder freely)
1. **SKIN PASS — PAUSED for Ian's theme notes (2026-07-13)** — on resume: DRAFT on playground (home/pricing/signin; meridian direction drafted) → default pages + blueprints, auth/account/payment, showcase → C4 sharing → arc close (template repo cut OUTSIDE the monorepo; **DON'T FORGET (Ian 2026-07-12): playground source lands on the EXISTING Omega-JS-Stack/omega-playground repo's main + CI workflows — `omega deploy` CI dispatch then REPLACES cp116's bootstrap gh-pages push by itself, nothing manual survives**); FOUC critical-CSS/font pass rides skin QA (Ian's re-table); omegajs.dev wiring + api.playground zone-worker parent scope land at arc close
2. **Sentry service (Ian 2026-07-14)** — manager service that creates/ensures a Sentry project PER enabled target and lands the DSNs via comment-preserving writeback (`monitoring.dsn` + per-surface `targets.<type>.monitoring.dsn` are hand-set today)
3. Brand rebuilds on the new stack (post-dogfood): somiibo → sweet-saucy — **HARD GATE (Ian 2026-07-11): explicitly ask and wait for his go before starting either**; Ian's password formula → his company hook file at migration (Ian involved)

## ⏸ Blocked / Waiting (Ian-owned)
- **Playground web deploy** — standing-authorized but SPARING; tonight's bundle (cp123 site fixes) waits on Ian naming it
- **Apple leftovers (agreements ACCEPTED 2026-07-14 — leg ran live)**: DEVELOPER_ID_INSTALLER_G2 needs the Account Holder's manual .cer download (guided path printed); the team DEVELOPMENT cert's private key lives where that cert was first created, so the local .p12 export warns — import the original .p12 or recreate the cert to sign from this machine
- **SEO run** — seeded + ready; creates the PUBLIC omega-playground-seo-demo repo → Ian's go (standing gate on public-repo creation)
- **AdSense** — Ian's 1-minute console site-add, then Google's multi-day approval (service reports state read-only meanwhile)
- Payment-adjacent (Ian's named wariness / launch-era): Stripe radar+disputes latches, PayPal/Chargebee legs, real Stripe account for account-info, offers@omegajs.dev parent-domain sender
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
- First-paint blank flash — mechanism CORRECTED cp123: no JS gate hides content (the page-loading gate only guards buttons); the flash is render-blocking CSS/fonts on a cold cache = exactly the critical-CSS/font pass Ian re-tabled to SKIN-PASS QA (116/123)
- devkit e2e-harness rare flake (~1-in-15, mechanism uncaptured): isolated two-pass runner + one retry that SAVES the failing output to .temp/ — the next firing names the mechanism; a real regression still fails twice (124)
- Brand-migration tooling (PINNED) must convert pre-family file formats — `{{ backend-manager }}` rules placeholder, `# BEM>>>` gitignore markers, `///---backend-manager---///` rules markers, and the cp72–74 interim `///---omega---///` flavor — evergreen `mgr setup` only speaks the one marker family now (75)

## ✅ Done (recent — full history: CHANGELOG.md + git log; the fat pre-slim tracker: `git show 99dc015:PROGRESS.md`)
- [x] 129 config-truth pass — MrLogo brandmark ladder (assets.brandmark options GONE; SA→API-key→token, BEM wire verified), reverse-DNS bundle ids (wizard-derived; playground → com.itwcreativeworks), `gcp` key, targets-last SSOT; Apple terms accepted → leg ran LIVE (bundle id CREATED + 2 profiles minted); mgr 655 / config 109 / corpus 1225 (1952448) → CHANGELOG
- [x] 128 board-clear close-out — root `npm test` made SOUND (npm 11 swallowed workspace failures — new scripts/test-workspaces.js; rotted bakeoff spikes out of the product suite) + all-green; full pipeline **PASS** under the graduated core; certificates leg FIRST EXERCISE (surfaced Apple agreements + bundleIdPrefix → warn ladder shipped incl. the code-vs-title detector gap, prefix seeded); N4 CLOSED rejected-with-evidence; board collapsed (this commit) → CHANGELOG
- [x] 126 2b create-on-missing LIVE — slapform/chatsy/replyify mint brand-OWNED assets (tri-auth: operator SA full create · API key recognized · dashboard paste-back); playground minted forms/POZXbmsFFHOW1I + agents/KJT3xUjlQQVuaC + agents/hkBrbPds9V4U0F via its own product users, borrowed ITW ids retired to template donors; mgr 650 (b6136ed) → CHANGELOG
- [x] 125 pipeline tightenings — search-console/sendgrid/account/recaptcha graduate into CORE; desktop/extension publish legs exist behind --publish (gated); 2 queue items were already-shipped (c2cd921) → CHANGELOG
- [x] 124 parked-findings sweep — vendor.js transactional, pre-boot emulator orphan reaper, serve demo-* gate, devkit two-pass + flake evidence, push-secrets env cascade (D15), ci.yml always()+src/dist paths, Ghostii wire pin → code comment, npm11 note → docs (f39842e) → CHANGELOG
- [x] 123 live-site gaps — nav/footer data bind + JSON5 json-in-_includes (admin sidebar was silently empty too), title/og post-liquify fallbacks, NEW static-asset channel (minted .omega/assets identity + consumer src/assets/images); playground build proof; web 112 (eef1804) → CHANGELOG
- [x] 122 BACKEND SRC/DIST PILLAR — consumers src-first, `dist/` staged output, `omega build` verb + ensureStaged everywhere, SA one-home, ZERO app-layer omega.json5; corpus 1225 / e2e PASS (cp122a–i incl. the fable review: 5 pre-fable defects fixed) → CHANGELOG
- [x] 121+b+c seed-everything + brandmark LIVE + app-layer truth — canonical key order, legacy seeds, brandmark MINTED, payment first light, translate timeout, pipeline mirror law; slapform/chatsy/replyify RAN live; 4 SAs → brand secrets; app-layer file OPTIONAL → CHANGELOG
- [x] 119 FIRST FULL PIPELINE PASS — 24 services exit 0; stack certified → CHANGELOG
- [x] 116 playground website LIVE on GH Pages e2e — repo + Pages + placeholder + service wave; site/api/backend live-200 → CHANGELOG
- [x] Phases 0–2 + cp33–115 — bootstrap, extractions, renames, config/wire/env harmonization, C1–C5, D12–D15, N1–N7, manage-cycle dogfood, live playground provisioning → CHANGELOG + git log

*Last updated: 2026-07-14 (cp129 config-truth pass; Apple terms accepted → bundle id + profiles minted live; skin waits on Ian's theme notes; deploy go awaits Ian)*
