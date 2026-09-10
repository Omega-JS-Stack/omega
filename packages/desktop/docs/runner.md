# Windows Code-Signing Runner

EV code signing for Windows needs a physical USB token plugged into the machine that runs `signtool`. GitHub's hosted Windows runners cannot see your token, and the cloud signing services are a paid alternative you do not need if you already own an EV cert.

So: one Windows box you own, with the token plugged in, registered as a self-hosted GitHub Actions runner. Every brand's `windows-sign` job routes to it by the labels `self-hosted`, `windows`, `ev-token`, and `npx omega sign-windows` runs there against the token.

`npx omega runner` is the command that sets that box up and keeps it honest.

## What the runner install actually is

No Windows services, no Scheduled Tasks, no admin. Four things on disk:

| Thing | Where |
|---|---|
| Runner home | `%LOCALAPPDATA%\omega-runner` (override with `OMEGA_RUNNER_HOME`) |
| One directory per org | `%LOCALAPPDATA%\omega-runner\actions-runner-<org>\` |
| The download template every org dir is cloned from | `%LOCALAPPDATA%\omega-runner\_template\` |
| Install record (timestamp, pinned runner version, labels, registered orgs) | `%LOCALAPPDATA%\omega-runner\config.json` |

Auto-start is a plain `.cmd` file in your Startup folder:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\omega-runner-<host>-<org>.cmd
```

```bat
@echo off
start "" /min /D "C:\Users\<you>\AppData\Local\omega-runner\actions-runner-<org>" "...\run.cmd"
```

Explorer runs it at every interactive logon, so the runner comes up in **your** desktop session — which is the whole point (see [Session 0 vs Session 1](#session-0-vs-session-1-the-reason-for-all-of-this)). `/D` sets the working directory to the runner dir, because actions/runner writes its `update.finished` marker to the current directory and reconnect-loops forever if that write is denied.

The runner is registered against GitHub under the same name as its shortcut: `omega-runner-<host>-<org>`, capped at 64 characters. One name, two places, so debugging stays sane.

## One-time setup on the Windows box

Prerequisites first — none of these are things `omega` can install for you:

1. Node 24+ (`winget install OpenJS.NodeJS.LTS`).
2. Git for Windows (`winget install Git.Git`).
3. Windows SDK or Visual Studio Build Tools 2022 with the "Desktop development with C++" workload, which is what provides `signtool.exe` (`winget install Microsoft.VisualStudio.2022.BuildTools`).
4. The EV USB token plugged in, with its vendor middleware (SafeNet or equivalent) installed.
5. A GitHub classic Personal Access Token with `repo`, `workflow` and `admin:org` — [github.com/settings/tokens](https://github.com/settings/tokens). The registration-token endpoint requires `admin:org` in full; `manage_runners:org` alone returns 403.

Then, in a normal (non-elevated) PowerShell:

1. `npm install -g @omega.js/desktop` (or run from a checkout of this monorepo, or from any brand — every step below works from any directory).
2. `npx omega runner install`. It writes the box's config file, `%LOCALAPPDATA%\omega-runner\.env`, and walks EVERY key of it — `GH_TOKEN`, `OMEGA_RUNNER_ORGS`, `WIN_EV_TOKEN_PATH` (the cert thumbprint), `WIN_CSC_KEY_PASSWORD` (the token PIN, masked), `SIGNTOOL_PATH` (the newest SDK one is offered), `WIN_TIMESTAMP_URL` — each question defaulting to the value that key has now. Enter keeps it, and every answer is written back double-quoted, so one walk brings a file from before that rule up to it. Have the thumbprint ready: `Get-ChildItem Cert:\CurrentUser\My | Format-Table Subject, Thumbprint`.
3. The file is THIS BOX's configuration, never a brand's `.env`. `npx omega runner config` is the SAME walk, run again, or open the file in an editor. A required key left empty, or a run with no terminal to ask in, stops the command naming the file and the keys: the runner never starts half configured.
4. `npx omega sign-windows --smoke` — copies `where.exe` to a temp dir, signs it (the PIN is typed into SafeNet's Token Logon dialog for you), verifies it, cleans up. If this fails, stop and fix it: the runner calls exactly the same `signtool` underneath. Then `npx omega test --extended desktop:build/sign-windows-e2e` from a desktop target: the Windows-gated end-to-end suite, an `--extended` lane because it drives the real token (the bare lane skips its five signing cases everywhere, this box included), which signs, verifies, checks that verify rejects an unsigned file, reads back the event log, and runs one `windows-sign` job's command against the token (it skips itself everywhere but here). That rejection case leans on `where.exe` being catalog-signed rather than embedded-signed, so `signtool verify /pa` reports the unsigned copy as unsigned; if it comes back signed on your box, the sample carries an embedded signature there and the case needs a different one.
5. `npx omega runner install` again. It tears down any prior install (the electron-manager era's included), downloads the pinned `actions/runner`, registers one runner per org in `OMEGA_RUNNER_ORGS` (every org you administer when it is empty), writes each Startup shortcut, and then brings every registered runner online detached, leaving your terminal free. A scripted install ends online too: nothing about that step needs a terminal.
6. `npx omega runner status` — confirm the config keys are set, one Startup shortcut and one live listener per org, and that no listener reports `session=0`.

`install` and `config` are ONE walk, so there is nothing to remember about which command changes what. Every key is asked, in the file's order, required or optional, and each question's DEFAULT is that key's current value: what the file saved, else what the shell or a CI job delivered, else the suggestion (the newest SDK `signtool`). Enter keeps what is there — including a secret, which is never echoed back at you ("Enter keeps the current value"). "Current" means current: a key the file does not have yet but your shell delivered is offered as the default, and Enter writes it into the box's file. Every value the walk ends with is written, the kept ones too (which is how an old file's bare `KEY=value` lines come back as `KEY="value"` without a single value moving), and they are written before the orgs question, so backing out of it never costs you the keys you just typed. A required key with nothing saved and an empty answer is refused, naming the key.

Then the orgs: a checkbox of every org your token administers, in alphabetical order. Ticked by default are the orgs this box already answered for — the saved `OMEGA_RUNNER_ORGS`, else the orgs it actually registered, else NOTHING. A token that administers 35 orgs must never register 35 runners on one Enter. Ticking nothing is refused too — a runner registered against no org is not a runner. Off a TTY the walk asks nothing: `config` says so and stops (edit the file instead), `install` refuses only when a required key is missing, and a blank org list still means every org the token administers, because CI has no keyboard.

`start` is the exception, deliberately: it asks only for MISSING required keys, never the checkbox, and warns when the file's org list is not the one this install registered.

Orgs in `OMEGA_RUNNER_ORGS` you do not administer are named in a warning and skipped.

## The commands

```powershell
npx omega runner status            # registered orgs, Startup shortcuts, live listeners, legacy leftovers
npx omega runner start             # bring EVERY registered org's runner up, detached (idempotent: an org already alive is skipped)
npx omega runner restart           # stop, wait for the listeners to go, then start
npx omega runner stop              # kill every Runner.Listener.exe under the runner home
npx omega runner install           # idempotent full setup — tears down first, so re-running is safe
npx omega runner config            # the same full walk install runs — every key, current values as the defaults, plus the orgs
npx omega runner register-org <org># register one specific org
npx omega runner self-update       # npm i -g @omega.js/desktop@latest
npx omega runner uninstall         # remove everything, legacy services, tasks and the em-runner install included
npx omega runner monitor           # tail the signing event log
```

Notes worth knowing before you use them:

- **`config` is `install`'s configuration step, alone.** Same walk, same defaults, same order — it just does not go on to register anything. A saved org your token no longer administers is named before the checkbox, since it cannot appear in it. Windows-only, and terminal-only (with nothing to ask with it stops and names the file). When the orgs you pick are not the ones this install registered, it says to re-run `install`.
- **Every subcommand tees its output to `<runner home>\logs\runner.log`**, and so does `npx omega sign-windows` — including inside a `windows-sign` job, which is exactly when the box's own record is wanted (the log lives in the runner home, never in a workspace, so the usual "no logs in CI" rule does not apply to it). `runner status` prints the path on its own line. It APPENDS, because more than one process writes it: `start` returns as soon as the runners are spawned, and every `sign-windows` those listeners go on to run adds to the same file. Each run stamps its own `# omega log` header; nothing rotates it, so delete the file when you want a clean one. `uninstall` keeps `.env` and `logs\`, since the log it is writing while it runs is the trail of that uninstall.
- **A refusal writes nothing.** Off Windows every subcommand but `self-update` and `monitor` stops at the platform check before the log file is opened, so running one on a Mac by accident leaves no `.gh-runners/` in the directory you were standing in.
- **The box verbs ignore the project's `.env` cascade.** `runner` and `sign-windows` read the shell and `<runner home>\.env`, nothing else, so running them from inside a brand folder can never hand a brand's `GH_TOKEN` to the box ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)). Every other verb keeps the cascade.
- **`start` brings up EVERY registered org, detached.** It walks the Startup shortcuts in order and spawns one hidden runner per org, so the terminal comes straight back and nothing is lost by not watching it: the listener's output is the JSONL log `monitor` tails. Running it again is safe, which is the point of it: an org whose listener is already alive is named with its PID and skipped, never duplicated and never a refusal. Exit 0 when every org ends up online, 1 when a spawn failed. A listener sitting in session 0 is skipped too, but loudly: it is alive and will fail every job it picks up, so the line names the session and points at `restart`. Killing a listener is `stop`'s job, never a start's.
- **`restart` is `stop` then `start`**, in that order, for the loop you would otherwise run by hand after a config change. It settles two things the two commands typed in sequence do not: the box config walk runs FIRST, so a box missing a required key is refused before anything is killed rather than left stopped, and each org's dir is polled (5 seconds) until no listener stands in it, because `taskkill` returns before the process is gone and a start that raced it would read the dying listener as "already running". A listener still standing after the wait is reported and that org is left alone, exit 1.
- **`stop` leaves the Startup shortcuts in place**, so a logout/login brings the runner back. For a permanent stop, run `uninstall`.
- **Every subcommand except `self-update` and `monitor` refuses on non-Windows.** `OMEGA_RUNNER_FORCE=1` overrides it, for framework tests only.
- **A test process cannot touch a real box.** Every subcommand that changes the machine — `install`, `config`, `register-org`, `start`, `restart`, `stop`, `uninstall`, `self-update` — refuses, before the platform check and naming `OMEGA_TEST_RUNNER`, whenever the run is a test (`omega test` sets that variable; the electron/boot runners set `OMEGA_TEST_MODE`) and a home it could act on is not a scratch one, under a `.temp` directory or the OS temp dir. BOTH homes are checked, the passed one and the module-level `RUNNER_HOME`, because the box's `.env` was already read into the process from the latter when the command module was required; the refusal names whichever is real. The marker is read from the process environment only — an injected environment is a fixture for the config walk, never an answer to "am I a test". The Startup folder is the THIRD surface checked, because no home scopes it — `uninstall` sweeps every `omega-runner-*.cmd` in the folder whatever home it was given, and a case whose two homes were both scratch deleted the box's three real shortcuts. It has its own scratch seam, `OMEGA_RUNNER_STARTUP_DIR`, and a test run against the real folder refuses naming both. The surfaces that no path can redirect at all — the watcher service, the legacy logon tasks, the `actions.runner.*` services, and the legacy `em-runner` homes — are simply not swept under a test run; `uninstall` says so on one line instead. A test run also never kills a process whose ExecutablePath it cannot read: that path belongs to another account, and matching it scopes to no home at all, so `stop` and `uninstall` drop the clause instead of `taskkill /F`-ing a stranger's runner. And it never deregisters on its own: `deregisterOrgRunners` mints a real removal token and runs each org directory's `config.cmd`, neither of them home-scoped, so with a roster to remove a test run refuses, naming the seam, unless `exec` is injected and, while `GH_TOKEN` is set, `getRemoveToken` too. A framework suite that wants to drive these points `OMEGA_RUNNER_HOME` and `OMEGA_RUNNER_STARTUP_DIR` at scratches *before* the command module is required, since both are resolved once, at require time. `sign-windows` follows the same rule for its log: from a test run pointed at a real home it tees nowhere rather than write the box's own record. This exists because a suite once ran a real `install` on the box and registered 34 orgs.
- **`uninstall` deregisters on the GitHub side first, and keeps whatever did not come off.** It walks every `actions-runner-<org>\` directory under the runner home and runs that directory's own `config.cmd remove` before anything is deleted. If a removal exits non-zero — or `GH_TOKEN` is not set, so no removal token can be minted — that runner is still registered, so its directory SURVIVES the uninstall and the summary names the org. Re-running `uninstall` retries it. Belt and braces: `register-org` also deletes every org-side runner starting with this host's prefix before it registers a new one.

## Upgrading from the electron-manager runner

A box that ran `em runner` (the electron-manager era of this command) carries the same design under the old names, and it stays live across the upgrade: the home is `%LOCALAPPDATA%\em-runner` (or `C:\actions-runners` from before v1.2.36), each org's runner is registered on GitHub as `em-runner-<host>-<org>`, and an `em-runner-<host>-<org>.cmd` in the Startup folder relaunches it at every logon. None of that answers to the omega names, so a plain `omega runner status` would call the box empty while the old listener keeps picking up jobs.

It is handled, not ignored:

- `npx omega runner status` names the legacy home, the orgs registered under it, any listener still running out of it, and the `em-runner-*` shortcuts.
- `npx omega runner uninstall` tears it down after the omega home: the `em-runner-*` shortcuts go, then each legacy org directory is deregistered through its own `config.cmd remove`, its processes are killed, and the directory is removed. A registration that does not come off keeps its directory and is named in the summary, exactly like an omega one.
- `npx omega runner install` runs that teardown first whenever a legacy home or shortcut exists, and `register-org` deletes the org-side `em-runner-<host>-<org>` runner before it registers the omega-named one.

So the upgrade on the box is the ordinary one: `npx omega runner install` with `GH_TOKEN` set. Set `GH_TOKEN` — without it the legacy registrations cannot be removed and their directories stay, as the summary will say.

## Adding a new org

Nothing happens automatically — no process is watching for new orgs. Run `npx omega runner install` again (it is idempotent and re-registers everything), or register just the one org:

```powershell
npx omega runner register-org <org-name>
```

`register-org` writes the Startup shortcut but does not launch the runner. Run `npx omega runner start` (it brings up every registered org and skips the ones already alive), or log out and back in.

## Environment variables

Split by who sets them.

**The box's own file** — `%LOCALAPPDATA%\omega-runner\.env`. The runner is a machine, not a brand: the token, the PIN, signtool and the orgs it serves belong to the box, and `omega runner` and `omega sign-windows` read this file from whatever directory they run in (this monorepo, a brand, a global install) — and read NO project `.env`, so a brand's values can never reach the box. `runner install` writes the template; `runner status` names which keys are set; `runner uninstall` keeps the file, and the `logs\` folder beside it. A value already in the shell, or delivered by a CI job, wins over it at RUN time; in the config walk the file's own value is what each question defaults to. Every value is written double-quoted (`KEY="value"`), and a value carrying a `"` is refused naming the key — `.env` has no escape for one.

| Var | Purpose |
|---|---|
| `GH_TOKEN` | Classic PAT with `repo` + `workflow` + `admin:org`. Required by `install` and `register-org` |
| `OMEGA_RUNNER_ORGS` | Comma/space-separated allow-list of orgs to register against. `install` and `config` always ask for it, as a checkbox of your admin orgs ticked to what this box already answered (the saved list, else the orgs it registered, else nothing). Empty — off a TTY, where the question cannot be asked — means every org you administer |
| `WIN_EV_TOKEN_PATH` | The cert reference: a SHA1 thumbprint (SafeNet/eToken, selected with `/sha1`) or a path to a `.pfx` (`/f` + `/p`). This is the ONE name — the `WIN_CSC_LINK` alias was removed in [#337](https://github.com/Omega-JS-Stack/omega/issues/337) |
| `WIN_CSC_KEY_PASSWORD` | Token PIN. Required in `.pfx` mode; in thumbprint mode SafeNet owns it and it is typed into the Token Logon dialog for you (`automately`) |
| `SIGNTOOL_PATH` | Full path to `signtool.exe`. Defaults to `signtool` on `PATH` |
| `WIN_TIMESTAMP_URL` | The RFC 3161 timestamp server. Defaults to `http://timestamp.sectigo.com`; point it elsewhere when Sectigo is having a bad day |

Shell-only (they decide where the file IS, so they cannot live in it): `OMEGA_RUNNER_HOME` overrides the runner home, `OMEGA_RUNNER_STARTUP_DIR` the Startup folder the shortcuts are written to and swept from (framework tests only — it is the folder's scratch seam), and `OMEGA_SIGN_LOG` the signing event log path.

**The runner's own HOME** ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)) is `%LOCALAPPDATA%\omega-runner\home`, and it holds one file: a real `.gitconfig` carrying `[core] autocrlf = false`. `actions/checkout` copies `$HOME\.gitconfig` into the temporary HOME it runs git under, and its copy helper recreates a SYMLINK source as a Windows junction, which is invalid for a file: a box whose `~/.gitconfig` is a dotfiles symlink (and it stays one) failed every git call in every job with `unknown error occurred while reading the configuration files`. HOME wins over the user's home directory in that lookup. It is delivered through each runner's own `<runner dir>\.env` (`HOME=...`, the file GitHub documents for proxy settings, one `KEY=value` per line, read by the listener at startup and applied to every job it runs), written by `install` and healed by `start` and `restart` for every registered org, so the Startup shortcut and the detached spawn both get it. `runner status` prints the path and whether the `.gitconfig` is there. A `.gitconfig` that is already there with different content is left alone and named in the output: it is yours to edit.

The runner belongs to whoever is logged in. There is no service and no scheduled
task, so there is no separate account to configure: `WIN_RUNNER_LOGON_ACCOUNT`,
`WIN_RUNNER_LOGON_PASSWORD` and the `set-credentials` subcommand were retired in
[#337](https://github.com/Omega-JS-Stack/omega/issues/337).

**Delivered by CI, optionally** — a brand MAY push `WIN_EV_TOKEN_PATH`, `WIN_CSC_KEY_PASSWORD` and `SIGNTOOL_PATH` as GitHub Actions secrets (`npx omega push-secrets` from its `.env`); the `windows-sign` job's env block carries them and they win over the box file. A self-hosted box normally holds all three itself, so a brand pushes none — the generated env block delivers them empty, and an empty value counts as absent.

The signing strategy itself is config, not env: `platforms.win.signing.strategy` in `config/omega.json5`, `self-hosted` by default.

## How a signing job runs

1. The mac/linux legs of the brand's `build.yml` package and publish as usual; the Windows leg packages **unsigned** and uploads a `windows-unsigned` artifact.
2. The `windows-sign` job picks up on your box (labels `self-hosted, windows, ev-token`), downloads that artifact, and runs `npx omega sign-windows --in release --out release/signed`.
3. For each `.exe` / `.msi`: copy to the output dir, then `signtool sign` with the resolved cert args, `/tr <timestamp url> /td sha256 /fd sha256`.
4. In thumbprint mode a helper starts alongside the sign call and types the PIN into SafeNet's "Token Logon" dialog if it appears, then watches the dialog for ten seconds: one still open after typing is reported as "the keystrokes did not reach it". Before the first call, a locked console (`LogonUI.exe` running) is refused outright, naming the fix, because the dialog renders behind the lock screen and the PIN lands on the lock screen instead (§ A locked console).
5. **The sign call gets three attempts** with a short backoff, and **each attempt has a three-minute limit**: a healthy sign takes about twenty seconds, so one still running minutes later is waiting on something that never comes, and its process tree is terminated with a message naming the limit (the attempt reads as transient, so the next one gets a fresh PIN watcher). The `windows-sign` job carries a thirty-minute `timeout-minutes` for the same reason. The timestamp server is a third party and a timeout or a 502 from it fixes itself; a failure signtool names as permanent (no matching certificate, wrong password, locked token, malformed file) stops on the first attempt instead of walking the token toward a lockout. Every attempt and every retry lands in the event log.
6. `signtool verify /pa` runs once against the signed file. No retry — it is a local check.
7. `latest.yml` and per-installer `.blockmap` files are written for the signed NSIS `.exe`s, because Windows is split into a post-build sign job and electron-updater has no other way to discover the release.
8. `npx omega finalize-release --signed-dir release/signed` uploads the signed assets to the release the mac/linux legs created.

## Signing without a release

Everything above can be run by hand on the box, which is how you debug it.

```powershell
npx omega sign-windows --smoke                                   # sign a temp copy of where.exe
npx omega sign-windows --target "C:\path\to\installer.exe"       # sign one file
npx omega sign-windows --target "C:\path\to\installer.exe" --verify-only   # report its signature
npx omega sign-windows --in release/ --out release/signed/       # what CI runs
```

## The signing event log

`sign-windows` appends one JSON object per line to a signing event log, and `npx omega runner monitor` tails and pretty-prints it. Run the monitor in a second terminal while a release is in flight.

```powershell
npx omega runner monitor
npx omega runner monitor --follow-only        # skip the replay of existing lines
npx omega runner monitor --file <path>        # watch a specific file
```

On start it prints the file it is watching and one block per registered org — whether that org's runner directory exists, whether its Startup shortcut is installed, and a line per live listener with its PID and session id. It is the same block `npx omega runner status` prints, from the same derivation, so the two never disagree. A listener in session 0 renders as `SESSION_0` with the reason attached rather than as a healthy `RUNNING`. Then it streams:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2026-09-02 12:34:56.789] JOB START my-org/my-app workflow=Build & Release run=12345
[2026-09-02 12:34:57.001] → sign MyApp-Setup.exe (79.4MB) mode=thumbprint
[2026-09-02 12:35:00.512] ✓ signed MyApp-Setup.exe (3.5s)
[2026-09-02 12:35:01.000] JOB END OK (4.2s)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Events: `job-start` / `job-end`, `sign-attempt` and `sign-retry` (one per signtool try), `sign-start`, `sign-done`, `sign-fail`.

The file path resolves in this order, first match wins:

1. `OMEGA_SIGN_LOG`
2. `<OMEGA_RUNNER_HOME>\omega-signing.log`
3. On Windows: `<runner home>\omega-signing.log` — the same `%LOCALAPPDATA%\omega-runner` the install uses
4. `<RUNNER_TOOLSDIRECTORY | RUNNER_WORKSPACE | RUNNER_ROOT>\omega-signing.log`
5. `<cwd>\logs\signing.log`

The first event of a job creates the directory if it is missing, so a fresh box does not lose its first signing run.

## The pitfalls that bite

### Session 0 vs Session 1 — the reason for all of this

An EV certificate on a SafeNet/eToken lives in **your user's** `CurrentUser\My` store, and the token's "Token Logon" PIN prompt is a window that needs a desktop to render on. A Windows service, and a Scheduled Task, both run in Session 0: no desktop, and a different account's certificate store. `signtool` there reports "No certificates were found that met all the given criteria" no matter how correct your configuration is.

The Startup folder is the fix: Explorer launches its contents in the interactive session at logon, as you, with your certificate store and your desktop.

`npx omega runner status` prints the session id of every live listener and warns loudly on `session=0`, and so does `start` when it meets one. If you see one, it is a leftover from an older install: `npx omega runner restart` replaces it.

### A locked console

Session 1 is not enough on its own: the desktop has to be UNLOCKED. Behind the lock screen the Token Logon dialog still exists (the watcher enumerates it) but every keystroke lands on the lock screen, so the PIN never arrives and `signtool` waits for it forever ([#864](https://github.com/Omega-JS-Stack/omega/issues/864): a Windows Update restart at the end of active hours auto-signed the box in, locked, and the sign job hung six hours). `sign-windows` now refuses a locked console before the first call, naming `LogonUI.exe` and the fix: unlock the box and re-run. Keeping the box unlocked across an update restart is the box's own setting, not the framework's: a classic auto-logon (Sysinternals Autologon) signs in without locking, where Windows' own "finish setting up after an update" always locks.

On a dedicated build box, enable Windows auto-logon so a reboot brings the session (and therefore the runner) back without a human.

### Two listeners on one registration

A registration can host exactly one listener. Two `Runner.Listener.exe` processes sharing it start a session-takeover storm against GitHub: each kicks the other off, both reconnect, forever, and jobs sit queued.

This is why `start` enumerates the listeners under each org's runner dir first and skips that org rather than adding a second one, which is what makes it safe to run twice. The usual way to create the situation by hand is double-clicking `run.cmd` while a Startup-launched runner is already up. If it happens: `npx omega runner restart`.

### Piped stdio changes what `config.cmd` does

`config.cmd` is spawned with `stdio: 'inherit'` on purpose. It behaves differently when its output is captured — in the `--runasservice` era it silently skipped the service install when it could not see a console, which cost several rounds of "registered, but no service". The registration output streams straight to your terminal for that reason; do not pipe `omega runner install` through anything that captures it.

It is also spawned as `cmd.exe /c config.cmd <args>` rather than with `shell: true`: `.cmd` files cannot be launched directly by Node's `CreateProcess`, and `shell: true` with an argument array trips Node 24's DEP0190 deprecation warning.

### Files still locked at uninstall

The `cmd.exe` wrapper around `run.cmd` holds the runner directory as its working directory for the listener's whole lifetime, so removing the runner home fails with `EPERM` while anything is alive. `uninstall` kills the listeners, their workers **and** their `cmd.exe` wrappers first, then retries the removal five times with a growing delay. If it still cannot, it names the processes holding handles via Sysinternals `handle.exe` when that is on `PATH`, and tells you how to install it when it is not.

## Debugging signtool errors

### "No certificates were found that met all the given criteria"
The token is not visible to `signtool`. Check, in order: the token is plugged in and SafeNet's tray app lists it; `certutil -store -user My` shows the certificate; the runner is not in Session 0 (`npx omega runner status`); `WIN_EV_TOKEN_PATH` matches the thumbprint `certutil` reports. Then re-run `npx omega sign-windows --smoke` to isolate it from CI.

### "The specified network password is not correct"
Wrong `WIN_CSC_KEY_PASSWORD`, or SafeNet is holding a stale cached PIN. Clear it: SafeNet tray icon → Tools → Advanced View → right-click the token → Clear Token Password. This failure is **not** retried, deliberately — repeated wrong PINs lock the token.

### "The timestamp signature and/or certificate could not be verified or is malformed"
The timestamp server is having a moment. The signer already retries this three times on its own; if all three fail, point `WIN_TIMESTAMP_URL` at another server (`http://timestamp.digicert.com`) and re-run.

### "The hash on the file is malformed"
The file is not a valid PE/COFF binary — usually truncated or zero-byte. Check the artifact that came out of the build.

### `signtool` is not found
Install the Windows SDK or VS Build Tools, add `C:\Program Files (x86)\Windows Kits\10\bin\<sdk-version>\x64\` to `PATH`, or set `SIGNTOOL_PATH` to the full path of the executable.

### `register-org` fails with 403
`GH_TOKEN` lacks `admin:org` on that org. Re-issue the PAT with `admin:org` checked in full.

### After a Windows update, the token disappears
The SafeNet driver sometimes detaches after a major OS update. Open the SafeNet tray app, confirm the token is listed, then `npx omega sign-windows --smoke`.

## Upgrading the actions/runner binary

`ACTIONS_RUNNER_VERSION` in `src/commands/runner.js` pins it. Bump the constant, ship a new `@omega.js/desktop`, then on the box: `npx omega runner self-update` followed by `npx omega runner install`. The install tears down the old tree and lays the new version down cleanly.

## Related

- [`signing.md`](signing.md) — the certificate inventory and the per-platform signing setup
- [`releasing.md`](releasing.md) — the whole release flow, including the Windows signing strategies table
