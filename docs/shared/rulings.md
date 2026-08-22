# Standing rulings

Ian's durable rulings, migrated verbatim from PROGRESS.md's Rulings lane when the board retired (v4 migration, 2026-07-27). These bind all work in this monorepo; new rulings land here (or in AGENTS.md when they are architecture). Per-item decisions live on their issues.

- Ian 2026-07-21: adblock-safe naming — the ad system speaks vert EVERYWHERE (paths, DOM, collection, API, modules); only ads.txt, Google's own ad* tokens, `advertising` config key say ad
- Ian 2026-07-21: "DO NOT USE EM DASHES… REWRITE EVERYTHING TO MAKE SENSE WITHUT IT" — site/brand copy never uses em dashes; manual rewrites, not deletions. Operating home with scope + exemptions: docs/shared/theming.md § Copy register (2026-08-15)
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
- Ian 2026-07-12 (final): NO ITW CLI login — cached browser-OAuth + normal CLI login cover all; never suggest firebase/gcloud login as ITW; npm start = the blessed form *(command superseded 2026-08-13 by [#227](https://github.com/Omega-JS-Stack/omega/issues/227): the blessed reconcile form is now `npm run manage`; `npm start` boots the dev stack)*
- Ian 2026-07-10: data-shape preservation — Firestore shapes + route semantics presumed good; breaking changes needing migration = flag with plan, don't build
- Ian 2026-07-06: no backwards compat (dual-read cancelled) — new way only
- Ian 2026-07-09: legacy repos READ-ONLY (omega-manager, all framework + consumer repos); migrators/verifiers/B5 verify/audit port PINNED; MAM parked
- Ian 2026-07-20: per-target docs retire in brand context — the brand root is the ONE home (AGENTS.md chain + one README/docs/CHANGELOG)
- Standing: secrets never in omega.json5 (.env only; config hard-fails); npu never raw npm/npx; explicit `git -C`; commit-and-continue; de-ITW to config = standard scope
- Standing: checkpoint discipline — survey → design → implement → tests → sandbox/fixture proof → docs → commit; live checks never touch real ITW resources outside sanctioned paths
- Ian 2026-07-30: uniformity — commands/surfaces of the same TYPE act the SAME; no split defaults within one family (the CLI read/write emulator split was the offense: every backend CLI subcommand now defaults to the emulator, `--production` the only path to live)
- Ian 2026-07-30: NO legacy accommodations in the new system — no code path accepting a superseded form; breaking changes get DOCUMENTED (register: #148) and migrated once, manually (playbook: #149); the config-convert input lane is the one sanctioned legacy-reading exception
- Ian 2026-07-30: company membership is the `.omega/company.json` stamp POINTER — brands never physically nest inside a company folder; anything resolving the company must follow the stamp, never the directory tree
- Ian 2026-08-06: harmonize at BUILD time, never in a later pass — when a mechanism lands in one framework, its shared home (devkit) and the mirroring evaluation happen in the same work item; "wait for the harmonization pass" is not an accepted answer (first application: the #200 captured-read helper lifted to devkit pre-ship)
- Ian 2026-08-20: migrations converge by SHAPE, not by version steps — each fix detects its legacy pattern in the doc itself, converged docs are proven no-ops, still-invalid docs surface loudly in the audit; every future doc reshape adds its convergent fix to the migrations pipeline in the SAME work item (register: docs/shared/breaking-changes.md)
- Ian 2026-08-20: writing real data is OPT-IN for one-off scripts/processes — any standalone script that mutates live data (Firestore docs, mailing lists, provider accounts) previews by default and writes only under an explicit `--execute`; the manage/reconciliation services (own `--dry-run` + convergence) and scripts that only write tracked files (git diff is the review) are out of scope; template: the migrations service (#394)

