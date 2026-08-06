# Logging

@omega.js/backend CLI commands automatically save all output to log files while still streaming to the console — in two files per verb, one of which CONTAINS the other.

The **verb's whole run** lands in `<projectDir>/logs/<verb>.log`, the lane every OMEGA framework shares (contract: `docs/shared/logging.md` in the Omega repo). It is a SUPERSET: the verb mirrors every chunk its firebase child pipes over to its own stdout, so this file holds the full child stream plus the verb's own lines:

| File | Source | Lifetime |
|---|---|---|
| `logs/dev.log` | `npx omega serve` / `npx omega emulator` — port allocation, the TLS proxy, the stage watcher, **and** the firebase child's whole stream | Truncated each run |
| `logs/build.log` | `npx omega build` | Truncated each run |
| `logs/test.log` | `npx omega test` — setup lines, the port summary, the emulator boot, **and** the runner/emulator child's stream | Truncated each run |

The **firebase children's** output ALSO lands on its own in `<projectDir>/dist/`, not `logs/` — a deliberate exception so it sits inside the staged tree (which the stage step PRESERVES across re-stages) and can be grepped alongside the runtime it drove, beside firebase-tools' own `*-debug.log` files.

## Log files

The child-only files, all in `<projectDir>/dist/` — the same lines the verb log carries, with none of the verb's own around them (and the only ones that roll mid-run):

| File | Source | Lifetime |
|---|---|---|
| `dev.log` | `npx omega serve` — @omega.js/backend's local dev server (Firebase serve) | Overwritten each run |
| `deploy.log` | `npx omega deploy` — Firebase deployment output (function uploads, hosting deploys, errors) | Overwritten each run |
| `emulator.log` | `npx omega emulator` — full emulator output (Firebase emulator + Cloud Functions logs); also `npx omega test` when it starts its own emulator | Overwritten each run |
| `test.log` | `npx omega test` runner output when running against an already-running emulator | Overwritten each run |
| `production.log` | `npx omega logs:read` / `npx omega logs:tail` — production Cloud Function logs from Google Cloud Logging (raw JSON for `read`, streaming text for `tail`) | Overwritten each run |

The `dev`/`test` names match EM/BXM/UJM for cross-framework parity.

## attach-log-file utility

`src/cli/utils/attach-log-file.js` — shared DRY utility (same pattern as BXM/UJM/EM). Intercepts `process.stdout.write` / `process.stderr.write` to tee all output to a log file while preserving console display. ANSI codes stripped from file output for grep-friendliness.

```js
const attachLogFile = require('../utils/attach-log-file');

attachLogFile(this.getLogsPath('deploy.log'));
// ... run command — all stdout/stderr is now teed to the log file ...
attachLogFile.detach();
```

- **Singleton**: default export is a process-wide singleton (one file at a time)
- **Factory**: `attachLogFile.createTee()` returns an independent tee for stacking, with LIFO detach
- **Idempotent**: attaching the same path twice returns the existing handle
- **Crash-safe**: writes go to an open fd synchronously, so the lines describing a crash survive it
- **Synchronous detach**: `detach()` restores the writers and closes the fd — it returns nothing and there is no buffered tail to flush
- **Truncate on attach**: a new launch clears the previous run's file
- **CI no-op**: under `CI` / `GITHUB_ACTIONS` the tee declines — the runner captures its own output

Every verb attaches it through `BaseCommand#attachVerbLog(verb)` for the `logs/` lane; `deploy.js` attaches a `dist/` path directly. The `serve`/`emulator`/`test` commands additionally pipe their firebase CHILD into `createChildLog()` — the same sink plus the mid-run `roll()` that reset-sentinel polling and reload detection need.

## What gets captured

When `npx omega test` starts its own emulator, logs go to `emulator.log` (it delegates to the emulator command). When running against an already-running emulator, logs go to `test.log`.

All files are gitignored (`logs/` as a directory, `dist/` output via `*.log`). Reset sentinels (`*.log.reset`), the watch trigger file, and `test-mode.json` live separately in `<projectDir>/.temp/` — they're transient internal signals with no debugging value.

## See also

- [cli-logs.md](cli-logs.md) — `npx omega logs:read` / `logs:tail` flag reference (the commands that feed `production.log`)
- [test-framework.md](test-framework.md) — the test runner that feeds `test.log` / `emulator.log`
