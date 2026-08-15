# Logging — the tag contract and the file contract

Two contracts live here. **What a line says**: every log line carries one identity tag.
**Where a line lands**: every dev server, build, test runner, emulator and watcher tees
its whole run to a greppable file ([#197](https://github.com/Omega-JS-Stack/omega/issues/197)).
The tag contract first, the file contract from [The file tee](#the-file-tee) down.

## The tag contract

Every log line in the ecosystem carries ONE identity tag: `[@omega.js/<package>:<module>]`.
The module segment is the file's identity (`push`, `watcher`, `auth:sync` — sub-modules
join with `:`). Ratified 2026-07-29 ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).

### The debug level (`OMEGA_DEBUG`)

`debug` is the ONE opt-in level ([#230](https://github.com/Omega-JS-Stack/omega/issues/230)): a
backend `ctx.debug(...)` line is dropped whole — console AND the log file — unless
`OMEGA_DEBUG` is set (truthy STRING semantics, the house's `TEST_EXTENDED_MODE` idiom:
`OMEGA_DEBUG=0` reads as on; read live per line). Fat payloads belong there: full user
records, raw webhook bodies. Two related quieting rules from the same issue: boot-time
environment notes (the TEST banner, the resolved-mode line) are suppressed under the
emulator (`FUNCTIONS_EMULATOR`) and latched once-per-process everywhere else, and the
`omega dev` leg output collapses consecutive duplicate lines into one plus a
`(repeated N×)` note.

### The two surfaces

- **Build-time** (CLI, gulp, tests, the manager's services): the devkit logger prints a
  timestamp bracket first — `[HH:MM:SS] [@omega.js/web:watcher] message`. Construction
  stays `new Logger('watcher')`; the package segment derives at construction from the
  constructing file's nearest `package.json` (stack-based, cached, non-throwing —
  fallback `@omega.js/devkit`). Home: `packages/devkit/src/logger.js`.
- **Runtime** (browser, electron renderer/main, extension): NO timestamp — devtools
  stamps lines. Each runtime surface has its own logger emitting its own package
  segment: client `createLogger()` (`packages/client/src/modules/logger.js`), web
  core/js `createLogger()` (`packages/web/core/js/libs/logger.js`), and the
  desktop/extension `logger-lite` lineage.
- **Backend** (Cloud Functions) is server-side runtime: in PRODUCTION Cloud Logging
  stamps every entry, so every level emits the tag ALONE —
  `[@omega.js/backend:<module>] <invocation-id>[ <logPrefix>]: message`. Outside
  production (the emulator's `>` prefix carries no time; plain local runs have
  nothing at all) the same `[HH:MM:SS]` bracket the build-time logger prints opens
  the line ([#130](https://github.com/Omega-JS-Stack/omega/issues/130)). The module
  segment is the invocation's function name, which the context already knows
  (`options.functionName || FUNCTION_TARGET`). Home:
  `packages/backend/src/manager/helpers/context/logging.js`. A shared backend module
  that logs outside a ctx carries its own file identity.

### Markers and exemptions

- `[DRY RUN]` survives as a MARKER after the tag, never as an identity tag (casing
  unified; the lowercase form is retired).
- The manager's reconciliation report is product output, not logging — it stays
  untagged by design (ruling 2026-07-29). That covers ALL its rows: the indented
  `✓ / ~ / +` lines AND the `[DRY RUN]` rows printed through the same report
  (there the marker may open the line, since the report carries no tags at all).
- Backend's record classifiers (`skip`, `expire`, `authenticated`, `test-mode`, …)
  classify one function's records, not modules. They survive as leading WORDS, never
  brackets (`ctx.log('local: Clearing...')`) — a bracket there would read as a second
  identity tag ([#121](https://github.com/Omega-JS-Stack/omega/issues/121)).
- Test harnesses and fixtures are exempt; web's `core/js/pages/test/` demo pages are
  NOT (they ship).

### Enforcement

`scripts/log-tags.test.js` (runs in root `test:packages`) scans `packages/*/src` and
`packages/web/core/js` for any log call whose message starts with a static bracket tag
that is not `@omega.js/…` or the dry-run marker. It self-tests its own red path. New
code uses the surface's shared logger — never a hand-written bracket prefix.

## The file tee

Nothing an OMEGA surface prints is terminal-only. ONE abstraction does it —
`packages/devkit/src/attach-log-file.js`, vendored into every framework — and every
surface attaches it at its entry point.

- **Both sinks, always.** A chunk reaches the terminal exactly as written (colors
  intact) and the file with ANSI escapes stripped, so `grep` and `tail -f` read clean.
- **Synchronous fd writes.** A stream's buffer dies with the process, dropping exactly
  the lines that describe a crash. The per-write syscall buys the crash tail.
- **Truncate on attach.** A new launch clears the previous run's log — no history, no
  rotation (the ruled retention, see below).
- **Stackable.** `createTee()` returns an independent tee; an attach captures the
  CURRENT writers, so tees nest and each detach restores exactly what it found (LIFO).
  The default export is the process-wide singleton, which is what a CLI verb wants.
- **`createChildLog()` for spawned children.** A child's stdout/stderr never pass
  through this process' writers; the caller mirrors each buffer to the terminal —
  which the verb's own tee then catches, making the verb log a SUPERSET of the child
  file — and hands it to a child log, which adds the one thing the tee has no use for — a
  mid-run `roll()`, requested by touching a reset sentinel, so a days-long emulator
  log can be freshened without restarting it.
- **CI is a no-op.** Under `CI=true` / `GITHUB_ACTIONS=true` the tee declines: the
  runner captures its own output and no `logs/` is left in the workspace.
- **A log it cannot open is a lost log, never a lost process.** The tee warns once and
  the run continues untouched.

## Where every log lives

`<appRoot>` is an app dir in a brand (`apps/website`, `apps/backend`, …);
`<brandRoot>` is the brand monorepo root.

| Surface | File | What's in it |
|---|---|---|
| **Per app** — every framework, same three names | | |
| `omega dev` (web) · `omega serve` / `omega emulator` (backend) · `npm start` (desktop, extension) | `<appRoot>/logs/dev.log` | the whole dev run: boot, ports, watcher rebuilds, the crash — plus every child chunk the verb mirrored (see below) |
| `omega build` (web, backend) · production gulp build (desktop, extension) | `<appRoot>/logs/build.log` | the whole production build |
| `omega test` | `<appRoot>/logs/test.log` | suite names, pass/fail, harness boot lines |
| **Backend children** — firebase's own processes, beside firebase-tools' debug logs. The verb mirrors every child chunk to its own terminal, so the `logs/<verb>.log` above is a SUPERSET of these; a child file is the child-ONLY view (and the one that `roll()`s mid-run) | | |
| the firebase emulator child | `<appRoot>/dist/emulator.log` | emulator traffic: function invocations, Firestore/auth calls |
| the `firebase serve` child | `<appRoot>/dist/dev.log` | serve output; rolls on each reload |
| the test runner child | `<appRoot>/dist/test.log` | the runner's own output under `omega test` |
| `omega deploy` | `<appRoot>/dist/deploy.log` | the deploy transcript |
| `omega logs` | `<appRoot>/dist/production.log` | the Cloud Logging tail |
| firebase-tools itself | `<appRoot>/*-debug.log` | `firestore-debug.log`, `firebase-debug.log`, `ui-debug.log`, … — theirs, never swept by us |
| **Desktop extras** | | |
| the running app itself (main + preload + renderer converge) | `<appRoot>/logs/runtime.log` (dev) · the OS log dir (packaged) | lifecycle, window and updater lines — `packages/desktop/docs/logging.md` |
| `npm run release` | `<appRoot>/logs/ci.log` | the GH Actions release run, streamed locally |
| Windows code-signing | `<appRoot>/logs/signing.log` | JSONL signing events (local fallback; on CI it lands in the runner home) |
| **Brand root** | | |
| `omega manage` (the service walk) | `<brandRoot>/logs/manage.log` | the whole service walk |
| `omega dev` (the fan-out) | `<brandRoot>/logs/dev.log` | the boot walk, then every dev leg's prefixed output (consecutive duplicate lines collapse to one `  (repeated N×)` note) |
| the brand's cross-stack e2e (`@omega.js/devkit/test/e2e-harness`) | `<brandRoot>/e2e/.logs/` | `steps.log` (one `PASS` / `FAIL` per step — see below), `emulator.log`, `page.log` |
| **This monorepo** | | |
| every root test lane (`npm test`, `npm run test:packages`, …) | `.temp/logs/<lane>.log` | the lane's own lines plus every child command's output — `test:packages` → `.temp/logs/test-packages.log` |
| `npm start` (the watcher) | `.temp/logs/watch-all.log` | is it alive, did it respawn, what did it rebuild |
| every e2e runner's per-step verdicts | `.temp/<lane>/steps.log` | one `PASS` / `FAIL` line per step — see below |
| every e2e runner's environment | `.temp/<lane>/` | `emulator.log`, `page.log`, `sw.log`, `screenshots/`, the journey's numbered stage logs |

The e2e lane dirs are `.temp/flows-e2e/`, `.temp/auth-token-e2e/`, `.temp/verts-e2e/`,
`.temp/desktop-auth-e2e/`, `.temp/extension-auth-e2e/`, and `.temp/journey/`.

### steps.log — which step failed

Every e2e runner writes its verdicts incrementally
(`packages/devkit/src/test/steps-log.js`, re-exported for the root runners as
`scripts/steps-log.js`, and used by the journey harness and the brand e2e
harness alike), so a SIGKILLed lane still names the step it died on:

```
PASS  the Paperloom emulator boots (hosting :5002, auth :9099)
FAIL  the popup reaches the background SW — timed out after 30s
FAIL  preflight — a playground emulator stack is already running (hosting :5002)
```

`preflight` is the runner dying before or outside any step — the live-stack guard, a
harness throw on the way up. One line, same shape, so one grep finds every failure:

```bash
grep '^FAIL' .temp/*/steps.log apps/*/e2e/.logs/steps.log
```

### Retention (ruled 2026-08-05)

**Clear on launch, sweep what is stale.** Every log truncates when its surface starts;
nothing rotates and no history is kept — the question a log answers is "what did the
run that just happened do?". The backend additionally sweeps its own stale `dist/*.log`
files and reset sentinels at every verb start, and deliberately leaves firebase-tools'
`*-debug.log` files alone (a crashed run is diagnosed from them). `logs/` is gitignored
everywhere, scaffolded brands included.

### Grep the logs — do not re-run the process

The whole point of the tee is that the answer is already on disk. A running dev server,
emulator or watcher belongs to the user: never restart one, and never re-run a suite,
just to see output.

```bash
tail -50 apps/website/logs/dev.log            # is the dev server up, what did it last build
grep -i error apps/backend/dist/emulator.log  # what the emulator actually served
grep '^FAIL' .temp/*/steps.log                # which e2e step broke
tail -100 .temp/logs/test-packages.log        # what the last lane printed
```
