# Dogfood friction log — omega-brand first run (cp93, 2026-07-11)

> The C1 work list. Every wart from scaffolding the OMEGA brand (all four targets) via the REAL wizard + framework setups, in the order met (finding 20 added by cp94b's brand-root fan-out). Severity: 🔴 breaks the run · 🟡 wrong result, run continues · ⚪ polish. Each item names its owning slice (C1/C2/C4/N4-flavored). Positive observations at the bottom — the parts that already feel shipfa.st-grade.

## The systemic one

1. 🔴 **Every framework's consumer config seed shadows the brand layer** (C1, the arc's #1 fix). Each setup seeds `config/omega.json5` with FULL shared sections at the app layer — web: `my-brand`/`My Brand`/example.com; backend: the entire 275-line framework-defaults file (placeholder cloud, sandbox's sentry DSN); desktop: `myapp`; extension: **REAL ITW values** (`ultimate-jekyll`, itwcreativeworks.com images — de-ITW miss). App layer wins the cascade, so placeholders SHADOW brand truth: the first omega-brand build rendered "My Brand" 22× and zero "OMEGA" until the seeds were slimmed by hand. **Fix: layer-aware seeding** — inside a brand root (company/brand stamp or config walk-up detects it), seed `targets.<type>`-only (sandbox-brand style); the full file is only right for a STANDALONE consumer. All four omega-brand app configs are now hand-slimmed with a pointer to this finding.

## Wizard / onboarding (C1)

2. 🟡 Scaffolded `apps/<dir>/package.json` has no framework dep and no scripts — "Next steps" says *install each app's framework* but not the dep line, the `file:`/semver choice, or that EM/BXM demand devDependencies (see 12). Onboard should write the dep + let setup sync scripts, or the walkthrough must show the exact lines.
3. 🟡 No `cloud` section seeded → backend/emulator can't boot until the user invents one; nothing mentions the `demo-<id>` emulator-only convention. Wizard should seed `demo-<brand.id>` by default (swap-at-launch comment), or config-flow it.
4. 🟡 No `payment.products` seeded → see 8 (pricing renders fiction). Seeding a commented starter catalog would also teach the schema.
5. 🔴 Wizard never collects `brand.address`/`brand.images`, but BEM's required-key check DEMANDS them → guaranteed first-run backend-setup failure. Also an SSOT break: BEM keeps its own required-key list while the shared schema calls these optional — one of them is wrong; the schema should win.

## Blueprint / pricing (C2)

6. 🟡 **Zero-products brand renders HARDCODED fake plans** — classy's pricing layout falls back to baked-in "Basic"/"Premium" content that looks real and sells nothing. Products must be the ONLY source: empty catalog → honest empty state or a build warning.
7. ⚪ One-time products (`launch-kit`) render on the subscription pricing page with no type distinction — C2 decides presentation per `type`.

## BEM setup on demo-* projects (parked 1.4b, now in full color — C1)

8. 🔴 `firestore-indexes-synced` hits the LIVE API on demo-* → 403, and **writes the error text into `firestore.indexes.json`** (poisoned JSON, breaks later tooling). demo-* must skip live index sync.
9. 🔴 Scaffolded `firebase.json` references `database.rules.json` but setup never creates the file → `omega emulator` dies ENOENT before ready. (Sandbox's copy was hand-made; copied it over.)
10. 🟡 `service-account.json` is required even for emulator-only demo projects — user must hand-craft a fake (generated a throwaway-key one). demo-* should auto-generate it.
11. 🟡 The config auto-fixer resolves conflicts toward STALE ARTIFACTS: it read `.firebaserc`'s `demo-project` (stamped by the placeholder-era first run) and wrote `cloud.config.projectId: 'demo-project'` INTO the app config — shadowing the brand's `demo-omega` — instead of fixing `.firebaserc` from config. It also rewrites the whole file, stripping comments (doesn't use the cp59 comment-preserving editor). Precedence must be config → derived artifacts, never the reverse.
20. 🔴 **Composed `functions/.env` ships every key as `KEY=""` — 24 empty values, each SHADOWING the brand-root `.env` in the cascade** (app layer wins; found by cp94b's first brand-root fan-out: `omega test` failed "Missing backend manager key" while the wizard-minted `OMEGA_ADMIN_KEY` sat one layer up). The `.env` flavor of finding #1. Fix (C1): composition must omit or comment keys it has no value for (`# KEY=` documents without shadowing), and/or the env cascade should treat empty-string in file layers as unset. omega-brand's copy hand-fixed to commented placeholders.

## Cross-framework inconsistencies (C1 polish / N4-flavored)

12. 🟡 Framework dep home: web/backend accept `dependencies`; EM/BXM hard-error unless the framework is in `devDependencies`. Pick one rule.
13. ⚪ Defaults timing: web + desktop scaffold interiors at `omega setup`; BXM scaffolds at first BUILD (gulp defaults task) — extension setup appears to do nothing. Align (setup should scaffold).
14. 🔴 **EM + BXM consumer scripts hardcode `./node_modules/@omega.js/<fw>/dist/gulp/main.js`** — breaks under workspace hoisting, which is EVERY brand monorepo (apps are workspace members; the framework hoists to the brand root). `npm run build` in omega-brand's extension app: "No gulpfile found". Fix: scaffold a `gulpfile.js` shim (`module.exports = require('@omega.js/<fw>/dist/gulp/main.js')`) + plain `gulp` scripts (resolution-safe via the require climb). Worked around with direct `--gulpfile` invocation.
15. 🟡 Node split-brain inside one brand: web pins 24, backend functions pin 22, desktop pins 24 (Electron) — three nvm switches during one brand's setup; setups halt-and-ask instead of completing other checks first (both BEM and EM nvmrc flows are two-phase: write, fail, rerun to pass). Needs a brand-level Node story (manager drives per-app Node like legacy update did, or frameworks converge majors).
16. ⚪ Sass `mixed-decls` deprecation spam ×10 per web build (classy SCSS) — C3 rebuilds those sheets anyway.
17. ⚪ Backend router says "Unable to load route …/index.js" (500) for a method mismatch on a method-file route (`uuid/post.js` + GET probe) — a 405 would be truthful.
17b. 🟡 `omega test em: --layer boot` from a consumer app finds NO framework test files ("No test files found") even though `em:` is a documented source prefix — the framework boot canary can't be invoked from a brand app today. Folds into C5's test-scoping work (cp94).
17c. 🟡 EM apps crash with `TypeError: Cannot read properties of undefined (reading 'setName')` when the shell carries `ELECTRON_RUN_AS_NODE=1` (editor-spawned terminals do this — hit during cp93's launch probe; require('electron') returns the npm stub under that flag). EM's launch/dev paths should scrub the var from the child env (one `delete env.ELECTRON_RUN_AS_NODE`).

## De-ITW misses (C1/C4)

18. 🟡 EM defaults derive `appId` ← `com.itwcreativeworks.<brand.id>` and copyright `© {YEAR}, ITW Creative Works` — hardcoded ITW in framework derivation (omega-brand overrides explicitly: `dev.omegajs.omega`). Should derive from brand url/name.
19. 🟡 BXM branding pipeline: `brand.name` never reaches the manifest/locales — built extension is named "Ultimate Browser Extension - Browser Enhancer" (the defaults' locale message). Extension naming must flow from config (C4 shared-branding work).

## In-monorepo quirks (documented, not bugs)

- `npm install` inside `apps/omega-brand` resolves at the MONOREPO root (root workspaces `apps/*` covers it) — deps land in the root lockfile; the resolution climb serves `@omega.js/*` to the apps with zero `--local` linking. Standalone brands (post-template) use `omega dev --local` or published deps — the arc-close template test must run OUTSIDE the monorepo.
- Placeholders awaiting Ian: domain `omegajs.dev`, `brand.address`, the product catalog (L10 pricing), desktop `appId` `dev.omegajs.omega`, brand name rendering ("OMEGA").

## What already feels right (keep)

- Non-interactive wizard: flags → 9 files → config validates, one shot, correct four-target scaffold.
- The `.env` stub is genuinely excellent — D14 crypto keys pre-provisioned, every external key documented with which service reads it.
- Zero-config web build: 65 virtual default pages in 1.75s, no consumer content required (D8 works).
- `payment.products` → pricing page rendering worked the moment products existed (C2's channel is live).
- `omega dev` allocated :4000 via N7 and served immediately; `.nvmrc` auto-switching per app dir.
- Emulator (once bootable): 10 `omega_*` functions loaded, router + validation chains answering with precise semantic errors.
- MV3 packaging ×3 browsers (chromium/firefox/opera + source.zip) from one build.
- Desktop webpack build clean on first try (main + preload bundles).
