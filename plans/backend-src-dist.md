# Backend src/dist restructure (cp122 arc)

**Directive (Ian, boarded 2026-07-13, promoted same day):** @omega.js/backend consumers gain
src/→dist like every other target — build step, `functions/` becomes staged output, the LAST
app-layer omega.json5 dies, setup-tests + deploy compose + emulator re-anchor on the staged tree.
This deliberately retires docs/build-system.md's "no consumer build" outlier.

## The model

**Authored tree** (consumer-owned, committed):

```
apps/<brand>/apps/backend/
  package.json            # THE app manifest: scripts + runtime deps (@omega.js/backend, firebase-admin, firebase-functions)
  .env                    # app-layer env (D15 cascade home; brand/company layers above)
  .nvmrc
  service-account.json    # secret (gitignored) — authored at app root now
  src/
    index.js              # Manager.init entry
    routes/** schemas/** hooks/** mcp.js   # consumer code (unchanged shapes)
  test/                   # project tests (unchanged)
  firebase.json  .firebaserc  *.rules  firestore.indexes.json  remoteconfig.template.json
  public/  docs/  CLAUDE.md  .gitignore
  config/omega.json5      # STANDALONE ESCAPE HATCH ONLY (no brand root above) — brand apps carry none
```

**Staged tree** (`functions/` — generated, gitignored WHOLESALE, disposable):

- `src/**` copied 1:1 (no transforms — CJS as-is, mirrors framework prepare-package)
- `package.json` derived from the app manifest (name, main, engines, dependencies only)
- `config/omega.json5` composed brand⊕app via `composeTargetConfig` — ALWAYS written; the
  deploy-time write-then-restore dance (stage-resolved-config) dies
- `.env` composed for the app (existing disperse composition retargets here)
- `.nvmrc`, `service-account.json` copied in
- `node_modules` NOT staged: local runs resolve up to the app root's install; deploy keeps
  cp100d stage-local-packages (pack file: deps + lockfile) now writing into the staged tree
  with no restore

**Runtime semantics unchanged:** deployed cwd is still the functions dir with a self-contained
composed config + .env beside it — production behavior is byte-equivalent to cp100e's staging.

## Mechanics

1. **`@omega.js/config`**: `composeTargetConfig` works with NO app file (brand-only compose —
   mirror loadConfig's cp121c optional-app rule). Standalone keeps requiring a file.
2. **Stage engine** (`src/cli/utils/stage-functions.js`): idempotent full re-stage (clean copy,
   preserve functions/node_modules + *.log if present), exported for tests.
3. **cwd contract**: commands run from the APP ROOT (cli/index.js already strips a trailing
   /functions — muscle-memory cwds keep working). setup's "run from functions/" gate dies.
4. **Command flow**: new `omega build` = stage verb; setup/emulator/serve/test/deploy ensure a
   fresh stage first. Dev watch: serve/emulator watch src/ → re-stage → touch the existing
   reload trigger.
5. **Scaffold**: setup seeds `src/index.js` (not functions/index.js), app-root manifest bits;
   stops seeding any app-layer omega.json5 in brand mode (standalone template → app root).
   Defaults tree's `functions/_.env` merge target moves to app-root `_.env`.
6. **Gitignore**: consumer .gitignore's granular functions/*.log lines collapse to `functions/`.

## Re-anchor sweep

- **setup-tests (~40)**: functions-package → app manifest + staged derivation; env-file,
  nvmrc, node-version, gitignore, npm-project-scripts, root-package-json, omega-config,
  project-directories, service-account → app-root anchors; rules/indexes/hosting/firebase-*
  unchanged (root artifacts). Each test reviewed individually during implement.
- **Backend internals**: `${functionsDir}/node_modules/@omega.js/backend` template-requires
  (test.js + fixture) → resolve from app root.
- **Manager services**: disperse/write/env.js (functions/.env → app-root .env; stage composes),
  firebase/ensure/service-account.js (write target → app root), testing target-checks,
  bookmark/sync, analytics pixel-token — audit every `functions/` hit.
- **devkit**: local.js link targets (functions/package.json → app manifest), omega-bin.js
  backend-context detection (app root primary; functions/ stays recognized).
- **Migrations (in-repo, no external consumers exist)**: framework fixture project,
  sandbox-brand backend, omega-playground backend (+ its last omega.json5 DELETED).
- **Docs**: backend build-system.md (outlier reversed), directory-structure.md, CLAUDE.md,
  README, config docs; consumer CLAUDE.md template.

## Slices

- **cp122a**: config compose change + stage engine + build verb + cwd contract + command
  re-anchors + scaffold + setup-tests sweep + fixture migration → backend suite green.
- **cp122b**: sandbox + playground migration (last app omega.json5 dies) + manager/devkit
  re-anchors → corpus + cross-stack e2e green + live emulator proof.
- **cp122c**: docs parity sweep + CHANGELOG; PROGRESS collapse.

Gates: golden behavior = suite parity (backend setup-tests, corpus 1225, e2e 18/18, boot
self-test) + a real `omega deploy --only functions` dry equivalence check on the playground
(staged tree diff vs cp100e's staging output) before any live deploy.
