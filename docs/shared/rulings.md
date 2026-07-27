# Standing rulings

Ian's durable rulings, migrated verbatim from PROGRESS.md's Rulings lane when the board retired (v4 migration, 2026-07-27). These bind all work in this monorepo; new rulings land here (or in AGENTS.md when they are architecture). Per-item decisions live on their issues.

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

