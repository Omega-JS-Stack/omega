const BaseCommand = require('./base-command');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const WatchCommand = require('./watch');
const { loadEmulatorPorts } = require('./setup-tests/emulator-config');
const { resolvePorts, writePortsFile, clearPortsFile, portsToEnv } = require('@omega.js/config');
const { EXTENDED_MODE_WARNING } = require('../../test/utils/extended-mode-warning');
const { writeTestMode, captureSyncedEnv } = require('../../test/utils/test-mode-file');
const { seed } = require('../../test/seed.js');
const { createChildLog } = require('../utils/attach-log-file');

// Used by both `npx omega emulator` and `npx omega test` auto-start path.
// Note: `emulators:start` enables the UI by default (controlled by firebase.json's
// `emulators.ui.enabled`), so no `--ui` flag here — that flag only exists on `:exec`.
const EMULATOR_FLAGS = '--only functions,firestore,auth,database,hosting,pubsub';

// The pid record this run writes when its stack is up — the sweep's primary
// ownership proof ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
const PID_RECORD_FILE = 'emulator-pids.json';

// How long a recorded pid stays evidence. The record is rewritten at boot and
// again at shutdown, so a live run's is always seconds old; anything older
// belongs to a run that died without teardown. Pids get RECYCLED, and a
// recorded pid is a kill order the sweep acts on without further proof — past
// this bound the number is no longer known to name the process it named.
const PID_RECORD_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// A command line that belongs to emulator machinery. Deliberately broad: it
// only ever narrows a candidate that ALREADY named this project id.
const EMULATOR_COMMAND = /emulator|firebase/i;

/**
 * Does this command line name the given project as an ARGUMENT?
 *
 * Substring matching would be wrong twice over: `demo-x` appears inside
 * `demo-x-staging` (a different project), and a repo path containing the brand
 * name is not a project id at all. Only `--project <id>` / `--project_id <id>`
 * (space or `=`) counts — the form the firestore emulator actually publishes.
 * @param {string} command - Full command line from ps.
 * @param {string} projectId - The project id to look for.
 * @returns {boolean}
 */
function commandNamesProject(command, projectId) {
  const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`--project(?:_id)?[= ]${escaped}(?:\\s|$)`).test(command);
}

/**
 * Can this process be PROVEN to be an emulator process of THIS project?
 *
 * The sweep used to signal whatever was listening on its ports, which
 * terminated another project's live emulator sharing the hub/storage ports
 * ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)). Occupying a
 * port is not ownership; only these two proofs are:
 *
 *   1. The pid record this run wrote when it spawned the stack. Primary,
 *      because the java emulators name no project on their own — and they
 *      reparent to PID 1 when orphaned, so the record made while they were
 *      still attached is the only surviving link.
 *   2. A command line that is emulator machinery AND names this project id
 *      (the firestore emulator's `--project_id`), which covers a leftover from
 *      an earlier run of the same project that no live record mentions.
 *
 * Anything else is somebody else's process and is left running.
 * @param {object} candidate - { pid, command } as read from ps.
 * @param {object} [ownership] - { pids: number[], projectId: string|null }.
 * @returns {boolean}
 */
function isOwnedEmulatorProcess(candidate, ownership) {
  const pid = Number(candidate?.pid);
  const command = String(candidate?.command || '');

  // PID 1 is init, and a non-numeric row is a parse failure — never candidates.
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }

  if ((ownership?.pids || []).some((recorded) => Number(recorded) === pid)) {
    return true;
  }

  const projectId = ownership?.projectId;

  if (!projectId) {
    return false;
  }

  return EMULATOR_COMMAND.test(command) && commandNamesProject(command, projectId);
}

/**
 * Should the PRE-BOOT reaper SIGKILL this process?
 *
 * Two proofs, both required. ORPHANED: reparented to PID 1, so the firebase
 * parent that would tear it down is gone — a live sibling stack never matches
 * and the allocator bumps around it as before. OURS: the same ownership matcher
 * the post-shutdown sweep runs on. The reaper used to take a command line
 * matching /emulator|firebase/i as sufficient, which is a NAME, not ownership —
 * that killed another session's reload watcher and another brand's orphans
 * ([#293](https://github.com/Omega-JS-Stack/omega/issues/293)).
 * @param {{pid: number|string, ppid: number|string, command: string}} candidate - One ps row.
 * @param {{pids: number[], projectId: string|null}} ownership - This project's evidence.
 * @returns {boolean}
 */
function isReapableOrphan(candidate, ownership) {
  if (Number(candidate?.ppid) !== 1) {
    return false;
  }

  return isOwnedEmulatorProcess(candidate, ownership);
}

/**
 * The ownership a pid record still supports, given its age.
 *
 * The pids are only evidence while they are known to name the processes they
 * named at spawn: the record is never deleted, so a run days later reads the
 * last one, and by then the OS may have handed those numbers to anything. The
 * project id is not pid-based — a command line naming this project proves
 * itself at any age — so it survives an expiry.
 * @param {object|null} record - The parsed pid-record file.
 * @param {number} [now] - Epoch ms to age against (defaults to Date.now()).
 * @returns {{pids: number[], projectId: string|null, rootPid: number|null}}
 */
function ownershipFromRecord(record, now) {
  const startedAt = Date.parse(record?.startedAt);
  const fresh = Number.isFinite(startedAt) && (now || Date.now()) - startedAt < PID_RECORD_MAX_AGE_MS;

  return {
    pids: fresh && Array.isArray(record?.pids) ? record.pids : [],
    projectId: record?.projectId || null,
    rootPid: record?.rootPid || null,
  };
}

/**
 * Every descendant pid of `rootPid`, from one ps snapshot.
 *
 * Taken while the stack is UP: firebase-tools puts each java emulator in its
 * own process group and they reparent to PID 1 once orphaned, so neither the
 * group nor the parent link survives the moment the sweep needs it.
 * @param {number} rootPid - The spawned child's pid.
 * @returns {number[]} rootPid plus every descendant, deduped.
 */
function collectDescendantPids(rootPid) {
  const { execSync } = require('child_process');
  const children = new Map();

  try {
    const rows = execSync('ps -A -o pid=,ppid=', { encoding: 'utf8' }).trim().split('\n');

    for (const row of rows) {
      const [pid, ppid] = row.trim().split(/\s+/).map(Number);

      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;

      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }
  } catch (error) {
    return [rootPid];
  }

  const collected = new Set([rootPid]);
  const queue = [rootPid];

  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) || []) {
      if (collected.has(child)) continue;

      collected.add(child);
      queue.push(child);
    }
  }

  return [...collected];
}

class EmulatorCommand extends BaseCommand {
  async execute() {
    // The emulator IS the backend's dev leg under brand-root `omega dev`, so it
    // shares the dev-log lane with `omega serve` (they never run together — same
    // ports). The firebase CHILD keeps its own dist/emulator.log (#197).
    this.attachVerbLog('dev');

    this.log(chalk.cyan('\n  Starting Firebase emulator (keep-alive mode)...\n'));
    this.log(chalk.gray('  Emulator will stay running until you press Ctrl+C\n'));

    // Boot-time: seed the shared state file with whatever this emulator was
    // started with. Two flows are supported:
    //   - Recommended: start emulator without the flag, set TEST_EXTENDED_MODE
    //     on `npx omega test` instead. The test command writes the file; the
    //     emulator's function workers watch it and flip live.
    //   - Also supported: start emulator with TEST_EXTENDED_MODE=true. We
    //     write the file here as a boot default. Useful for inspecting the
    //     emulator before any tests fire. Note: the next `npx omega test`
    //     overwrites the file regardless of how the emulator booted.
    {
      const projectDir = this.main.firebaseProjectPath;
      const envSubset = captureSyncedEnv(process.env);
      writeTestMode(projectDir, envSubset);
    }

    // Show the standard warning if the emulator boots in extended mode.
    if (process.env.TEST_EXTENDED_MODE) {
      this.log(chalk.yellow.bold(`\n  ${EXTENDED_MODE_WARNING[0]}`));
      EXTENDED_MODE_WARNING.slice(1).forEach((line) => this.log(chalk.yellow(`  ${line}`)));
      this.log(chalk.gray(`  (Tip: you can also flip mode per-run by setting TEST_EXTENDED_MODE on \`npx omega test\`.)`));
      this.log('');
    }

    // Start @omega.js/backend watcher in background. Keep the child handle —
    // interactive Ctrl+C kills it via the terminal process group, but a
    // PROGRAMMATIC signal to this process alone (e2e harness, kill -INT)
    // doesn't, leaving an immortal nodemon re-creating the reload trigger
    // (found live by the cp88 two-emulator proof).
    const watcher = new WatchCommand(this.main);
    const watcherChild = watcher.startBackground();

    // Keep-alive: boot emulators and wait for Ctrl+C. No "command" subprocess —
    // the emulator child IS the foreground process from the user's perspective.
    // HTTPS default-on for the interactive command (--no-https disables); the
    // `omega test` auto-start path never passes it — the harness talks plain
    // http to hosting directly.
    try {
      const { shutdown, emulatorPorts, bumped, exitPromise } = await this.startEmulators({
        https: this.argv.https !== false,
      });

      // Start Stripe webhook forwarding in background — AFTER boot so it
      // targets the RESOLVED hosting port, not a classic that may have bumped
      this.startStripeWebhookForwarding(emulatorPorts.hosting);

      // Seed personas unless --no-seed was passed (yargs boolean negation:
      // `--no-seed` parses as argv.seed === false). seedPersonas is fully
      // non-fatal — any failure logs a warning and the emulator keeps running.
      if (this.argv.seed !== false) {
        await this.seedPersonas(emulatorPorts);
      }

      // NOTE: this line is a readiness MARKER for external drivers (the devkit
      // e2e harness waits for it) — it must print AFTER seeding so drivers
      // don't race the seed wipe. Change the text in lockstep with
      // @omega.js/devkit/test/e2e-harness.js.
      this.log(chalk.gray('\n  Emulator ready. Press Ctrl+C to shut down...\n'));

      // Synchronous SIGINT handler — must NOT be async. In Node, registering any
      // SIGINT listener suppresses the default "exit on signal" behavior, but only
      // if the listener is present when the signal fires. An async handler loses
      // the race: Node starts it, doesn't await it, and the process dies mid-shutdown.
      // So: set a flag synchronously, kick off shutdown (no await), and let the
      // main `await exitPromise` below resolve naturally once shutdown kills the child.
      let sigintCount = 0;
      const onSigint = () => {
        sigintCount++;
        if (sigintCount === 1) {
          this.log(chalk.gray('\n  Shutting down emulator... (Ctrl+C again to force kill)'));
          shutdown();
        } else {
          this.log(chalk.gray('  Force killing emulator...'));
          shutdown();
        }
      };
      process.on('SIGINT', onSigint);

      // Resolve when the emulator exits (via shutdown or crash)
      await exitPromise;
      // Reap the background watcher — it is NOT in the firebase child's
      // process group, so nothing else kills it on a programmatic shutdown.
      if (watcherChild) {
        try { watcherChild.kill('SIGTERM'); } catch (e) { /* already gone */ }
      }
      // Kill any orphaned Java processes left on THIS run's ports.
      // SIGINT listener stays active so Ctrl+C spam during the sweep
      // doesn't kill us before orphans are cleaned up.
      await this.terminateOrphanedEmulatorProcesses(emulatorPorts, { sweepShared: bumped.length === 0 });
      process.removeListener('SIGINT', onSigint);
      this.log(chalk.gray('  Emulator stopped.\n'));
      if (sigintCount > 0) {
        process.exit(0);
      }
    } catch (error) {
      this.logError(`Emulator error: ${error.message || error}`);
      process.exit(1);
    }
  }

  /**
   * Seed the running emulator with test personas so a developer can sign in
   * manually on any emulator-connected dev site (email + TEST_ACCOUNT_PASSWORD).
   * Fully non-fatal — the ENTIRE body is guarded; any failure (config load,
   * firebase-admin init, account creation) logs a warning and the emulator
   * keeps running. execute()'s catch would otherwise process.exit(1).
   */
  async seedPersonas(emulatorPorts) {
    try {
      this.log(chalk.cyan('\n  Seeding test personas...\n'));

      const projectDir = this.main.firebaseProjectPath;
      const functionsDir = path.join(projectDir, 'dist');

      // Load project config (same pattern as test.js loadProjectConfig)
      const { hasOmegaConfig, loadConfig, loadEnv } = require('@omega.js/config');
      loadEnv(functionsDir);

      let config = {};
      let domain = '';
      if (hasOmegaConfig(functionsDir)) {
        config = loadConfig(functionsDir, 'backend').config;
        const contactEmail = config.brand?.contact?.email || '';
        domain = contactEmail.includes('@') ? contactEmail.split('@')[1] : '';
      }

      // Persona emails are `_test.<id>@{domain}` — without a domain every
      // createUser call fails with an invalid email. Skip cleanly instead.
      if (!domain) {
        this.logWarning('Skipping persona seeding: no brand.contact.email in config/omega.json5 (personas need a domain for their emails)');
        return;
      }

      // Point firebase-admin at the emulators. Set AFTER the firebase child was
      // spawned, so only THIS process (and the seed module's emulator-only
      // guards) see them — the emulator child's env is unaffected.
      process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${emulatorPorts.firestore}`;
      process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${emulatorPorts.auth}`;
      process.env.GCLOUD_PROJECT = config.cloud?.config?.projectId || 'demo-test';

      const firebaseAdmin = require('firebase-admin');
      if (firebaseAdmin.apps.length === 0) {
        firebaseAdmin.initializeApp({
          projectId: process.env.GCLOUD_PROJECT,
        });
      }

      const { TEST_ACCOUNT_PASSWORD } = require('../../test/test-accounts.js');
      const result = await seed({
        admin: firebaseAdmin,
        domain,
        config,
        projectDir,
      });

      if (result.accounts) {
        this.log(chalk.green(`\n  ✓ Personas seeded (${result.created} accounts)`));
        this.log(chalk.gray(`    Sign in on any emulator-connected dev site with email + password: ${TEST_ACCOUNT_PASSWORD}\n`));
      } else {
        this.logWarning('Persona seeding completed with errors (see above)');
      }
    } catch (e) {
      this.logWarning(`Persona seeding failed: ${e.message}`);
      this.log(chalk.gray('    The emulator is still running — seeding is non-fatal. Re-run with --no-seed to skip.\n'));
    }
  }

  /**
   * Boot Firebase emulators as a long-running child process.
   * Stdout/stderr are teed to console + emulator.log.
   * Resolves once the emulator hub is listening (i.e., emulators are ready).
   * Caller is responsible for calling shutdown() to send SIGTERM and wait for exit.
   *
   * @param {object} [options]
   * @param {boolean} [options.https] - Front the public hosting port with the
   *   shared mkcert TLS proxy (interactive `omega emulator` default)
   * @returns {Promise<{ child: ChildProcess, shutdown: () => Promise<void>, emulatorPorts: object }>}
   */
  async startEmulators(options) {
    const projectDir = this.main.firebaseProjectPath;

    // dist/ is staged output (src/dist pillar): stage fresh (including
    // dist/public/ for hosting), then keep it fresh — the emulator watches
    // dist/ natively, so a re-stage IS the hot reload. The watcher dies with
    // the emulator child (exitPromise below).
    this.ensureStaged();
    const stageWatch = this.startStageWatch();

    // N7 port allocation: firebase.json values (classic defaults) when free,
    // bump-if-taken — a second brand's stack relocates instead of the old
    // behavior of KILLING the incumbent. Explicit config `ports` pins never
    // bump (busy pin = hard error).
    const wanted = loadEmulatorPorts(projectDir);

    // HTTPS (the classic https://localhost:5002 contract, shared with `omega
    // serve` + web's `omega dev` via @omega.js/devkit/local-https): the PUBLIC
    // hosting port speaks TLS through the mkcert proxy; hosting itself moves
    // to an internal plain-http port. No mkcert → plain http on the classic
    // port, same fallback as serve.
    let httpsCerts = null;
    if (options?.https) {
      const { ensureLocalHttpsCerts } = require('@omega.js/devkit/local-https');
      httpsCerts = await ensureLocalHttpsCerts({
        certsDir: path.join(this.getTempPath(), 'certs'),
        log: (line) => this.log(chalk.gray(`  ${line}`)),
      });

      if (httpsCerts) {
        wanted.https = wanted.hosting;
        wanted.hosting = 5443;
      } else {
        this.log(chalk.yellow('  HTTPS disabled — could not obtain certificates.'));
        this.log(chalk.yellow('  Install mkcert for trusted local HTTPS: brew install mkcert && mkcert -install\n'));
      }
    }

    // Crash leftovers first: a run that died without teardown leaves java
    // emulator grandchildren squatting the classic ports FOREVER — the
    // shutdown sweep only covers that run's RESOLVED map, and allocation
    // just bumps around squatters (95a: two stale generations cross-talking
    // with a live run's functions emulator). Reaped by two proofs together:
    // orphaned (parent gone, so it can't be a sibling's live stack) AND
    // provably this project's — the crashed run's own pid record, or a
    // command line naming this project
    // ([#293](https://github.com/Omega-JS-Stack/omega/issues/293)). Live
    // listeners and other projects' leftovers stay untouched and bump as before.
    const recorded = this.readEmulatorOwnership();
    this.reapOrphanedEmulators(Object.values(wanted), {
      pids: recorded.pids,
      projectId: this.loadProjectId(projectDir) || recorded.projectId,
    });

    const { ports: emulatorPorts, bumped } = await resolvePorts({
      wanted,
      pins: this.loadPortPins(projectDir),
    });

    // Bumped ports can't ride the committed firebase.json — materialize a
    // patched copy NEXT TO it (same dir, so relative paths keep resolving)
    // and boot with --config. The https flip ALWAYS materializes (hosting
    // moved to the internal port). Defaults-free runs spawn exactly as always.
    let configFlag = '';
    if (bumped.length > 0 || httpsCerts) {
      const resolvedName = 'firebase.resolved.json';
      const firebaseConfig = JSON5.parse(jetpack.read(path.join(projectDir, 'firebase.json')));
      for (const [name, port] of Object.entries(emulatorPorts)) {
        if (firebaseConfig.emulators?.[name]) {
          firebaseConfig.emulators[name].port = port;
        }
      }
      jetpack.write(path.join(projectDir, resolvedName), JSON.stringify(firebaseConfig, null, 2));
      configFlag = ` --config ${resolvedName}`;
      if (bumped.length > 0) {
        this.log(chalk.yellow(`  Ports in use — bumped: ${bumped.map((name) => `${name}→${emulatorPorts[name]}`).join(', ')} (booting via ${resolvedName})`));
      }
      if (httpsCerts) {
        this.log(chalk.gray(`  Hosting moves to internal :${emulatorPorts.hosting} under the HTTPS proxy on :${emulatorPorts.https} (booting via ${resolvedName})`));
      }
    }

    // Publish the resolved map: env for our own children (functions workers
    // inherit through the firebase spawn; URL getters read OMEGA_*_PORT) and
    // the ports file for sibling processes of this brand (`omega test`
    // against a running emulator, `omega dev`, the e2e harness).
    Object.assign(process.env, portsToEnv(emulatorPorts));
    writePortsFile(projectDir, emulatorPorts);

    // Start the TLS terminator now — requests 502 until hosting is up, then
    // https://localhost:<https> serves the whole surface. Torn down with the
    // emulator child (close handler below).
    let httpsProxy = null;
    if (httpsCerts) {
      const { startLocalHttpsProxy } = require('@omega.js/devkit/local-https');
      httpsProxy = startLocalHttpsProxy({
        port: emulatorPorts.https,
        targetPort: emulatorPorts.hosting,
        certs: httpsCerts,
        log: (line) => this.log(chalk.green(`  ${line}`)),
      });
    }

    // Wipe stale firebase-tools debug logs + any leftover @omega.js/backend logs from older versions.
    this.sweepStaleLogs();

    // The emulator child's own log, beside firebase-tools' *-debug.log files.
    // The reset sentinel lets `omega test` ask this long-lived log for a fresh
    // slate mid-run; the poll + roll live in the shared child-log sink.
    const logPath = this.getLogsPath('emulator.log');
    const childLog = createChildLog({
      logPath,
      resetPath: this.getTempPath('emulator.log.reset'),
    });

    // Write pre-emulator info to log file
    if (process.env.TEST_EXTENDED_MODE) {
      EXTENDED_MODE_WARNING.forEach((line) => childLog.write(`${line}\n`));
      childLog.write('\n');
    }

    this.log(chalk.gray(`  Logs saving to: ${logPath}`));

    // OMEGA_TEST_MODE=true is passed so Functions skip external API calls (emails, SendGrid)
    // hosting is included so localhost:5002 rewrites work (e.g., /omega -> omega_api)
    // pubsub is included so scheduled functions (omega_cronDaily) can be triggered in tests
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      OMEGA_TEST_MODE: 'true',
    };

    // Internal calls (Manager.getApiUrl) loop through the HTTPS proxy with a
    // mkcert cert Node doesn't trust — same handoff as `omega serve`.
    if (httpsCerts) {
      env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    // Spawn `firebase emulators:start` as a background child. Use `sh -c` so the
    // user's shell PATH resolves `firebase` consistently with the interactive shell.
    //
    // `detached: true` puts the child into its own process group. We need this so that
    // shutdown() can kill the entire group (sh → firebase → java emulators) by
    // signalling the negative pgid. Without it, SIGTERM to the shell doesn't propagate
    // to firebase or its java grandchildren, leaving orphan firestore/pubsub processes.
    const child = spawn('sh', ['-c', `firebase emulators:start ${EMULATOR_FLAGS}${configFlag}`], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    // Wire readiness detection into the stdout/stderr handlers.
    //
    // We watch for firebase-tools' explicit "All emulators ready!" line — that's the
    // signal that function discovery + load is complete and the runtime can serve HTTP.
    // Port-listening alone isn't enough: firebase-tools binds the functions socket
    // ~5-10s before user functions are actually loadable, so HTTP requests fail with
    // ECONNREFUSED / "fetch failed" if we proceed when only the port is open.
    let readyResolve;
    let readyReject;
    const readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    let ready = false;
    const READY_MARKER = /All emulators ready/i;

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
      childLog.write(data);
      if (!ready && READY_MARKER.test(data.toString())) {
        ready = true;
        readyResolve();
      }
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
      childLog.write(data);
      // firebase-tools prints the ready line to stderr sometimes — watch both.
      if (!ready && READY_MARKER.test(data.toString())) {
        ready = true;
        readyResolve();
      }
    });

    // Track exit state so shutdown() can resolve when the process is gone
    let exitPromiseResolve;
    const exitPromise = new Promise((resolve) => {
      exitPromiseResolve = resolve;
    });

    child.on('close', (code, signal) => {
      childLog.close();
      // The TLS proxy lives in THIS process — release the public port with
      // the stack (and drop any keep-alive sockets holding it open)
      if (httpsProxy) {
        httpsProxy.close();
        httpsProxy.closeAllConnections?.();
      }
      // Retract the published port map (clean shutdown). The resolved
      // firebase config is per-run scratch — remove it too.
      clearPortsFile(projectDir);
      try { fs.unlinkSync(path.join(projectDir, 'firebase.resolved.json')); } catch (e) { /* not a bumped run */ }
      exitPromiseResolve({ code, signal });
      // If we exited before becoming ready, fail the readiness wait too
      if (!ready) {
        readyReject(new Error(`Emulator child exited before ready (code=${code}, signal=${signal})`));
      }
    });

    // Race the readiness marker against a 60s timeout
    const readyTimeoutMs = 60000;
    await Promise.race([
      readyPromise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Emulator did not print "All emulators ready" within ${readyTimeoutMs}ms`)),
        readyTimeoutMs,
      )),
    ]);

    // The stack is UP and every java emulator exists — record the pids now, so
    // the post-shutdown sweep can prove which orphans are its own instead of
    // signaling whatever holds a port
    // ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)). Non-fatal:
    // without a record the sweep falls back to command-line proof and spares
    // anything it cannot place.
    try {
      this.writeEmulatorPidRecord(child.pid, this.loadProjectId(projectDir));
    } catch (error) {
      this.logWarning(`Could not record emulator pids (${error.message}) — the orphan sweep will only spare, never over-reach`);
    }

    // shutdown() signals the entire emulator process group (sh + firebase + java
    // grandchildren), waits up to 10s for clean exit, then escalates to SIGKILL.
    //
    // We use `process.kill(-pgid, ...)` instead of `child.kill(...)` because firebase
    // tools spawns several Java subprocesses (firestore + pubsub) that survive if
    // only the sh wrapper is killed. The negative PID targets the whole process group
    // (made possible by `detached: true` above).
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (e) {
        // ESRCH = group already dead. EPERM = macOS kill(2) quirk when the
        // group's remaining members are zombies awaiting reap. Either way the
        // group is unreachable — and killGroup must NEVER throw out of
        // shutdown(): the un-awaited shutdown() in the SIGINT handlers turns
        // a throw into an unhandled rejection that crashes the CLI BEFORE
        // the orphan sweep + ports-file cleanup run (this exact crash leaked
        // 3 java emulators per e2e run). The port-based sweep after shutdown
        // is the safety net for anything a failed signal left behind.
        if (e.code !== 'ESRCH' && e.code !== 'EPERM') {
          this.log(chalk.yellow(`  killGroup(${signal}) failed: ${e.message} — relying on the orphan sweep`));
        }
      }
    };

    let shutdownDone = false;
    const shutdown = async () => {
      if (shutdownDone) {
        return;
      }

      // 0. Re-record the pid set while the tree is still attached. The boot
      // snapshot misses anything spawned since (function runtime workers come
      // and go), and once the parent is gone the descendants reparent to PID 1
      // — this is the last moment ownership is readable
      // ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
      try {
        this.writeEmulatorPidRecord(child.pid, this.loadProjectId(projectDir));
      } catch (error) { /* the boot record still stands */ }

      // 1. Signal the process group (sh + firebase + direct children)
      if (child.exitCode === null && child.signalCode === null) {
        killGroup('SIGTERM');

        // Wait up to 5s for clean exit, then SIGKILL the group
        const exited = await Promise.race([
          exitPromise.then(() => true),
          new Promise((r) => setTimeout(() => r(false), 5000)),
        ]);

        if (!exited) {
          killGroup('SIGKILL');
          await Promise.race([
            exitPromise.then(() => true),
            new Promise((r) => setTimeout(() => r(false), 3000)),
          ]);
        }
      }

      shutdownDone = true;
    };

    // The stage watcher lives exactly as long as the emulator child
    exitPromise.then(() => stageWatch.close());

    return { child, shutdown, emulatorPorts, bumped, exitPromise };
  }

  /**
   * Boot emulators and run a single command against them. Sends SIGTERM to the emulator
   * when the command exits (or this process is interrupted) and waits for clean shutdown.
   *
   * Used by `npx omega emulator` for the keep-alive flow (command is a no-op sleep).
   * `npx omega test`'s auto-start path uses startEmulators() directly so it can tee the
   * test command's output to its own log (test.log) separate from emulator.log.
   *
   * @param {string} command - shell command to run while emulators are up
   */
  async runWithEmulator(command) {
    const { shutdown, emulatorPorts, bumped, exitPromise } = await this.startEmulators();
    const sweepOptions = { sweepShared: bumped.length === 0 };

    // Same synchronous SIGINT pattern as execute() — see comment there.
    let sigintCount = 0;
    const onSigint = () => {
      sigintCount++;
      shutdown();
    };
    process.on('SIGINT', onSigint);

    try {
      // Run the user command; when it exits we tear down the emulator.
      const cmdChild = spawn('sh', ['-c', command], {
        cwd: this.main.firebaseProjectPath,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: 'inherit',
      });

      const cmdExit = await new Promise((resolve) => {
        cmdChild.on('close', (code, signal) => resolve({ code, signal }));
      });

      process.removeListener('SIGINT', onSigint);
      await shutdown();
      await exitPromise;
      await this.terminateOrphanedEmulatorProcesses(emulatorPorts, sweepOptions);

      if (cmdExit.code !== 0) {
        throw Object.assign(new Error(`Command exited with code ${cmdExit.code}`), { code: cmdExit.code });
      }
    } catch (e) {
      process.removeListener('SIGINT', onSigint);
      await shutdown();
      await this.terminateOrphanedEmulatorProcesses(emulatorPorts, sweepOptions);
      throw e;
    }
  }

  /**
   * Read explicit port pins from the brand config's `ports` section (N7).
   * Lenient — a missing/broken config means no pins, never a boot failure.
   */
  loadPortPins(projectDir) {
    try {
      const { hasOmegaConfig, loadConfig } = require('@omega.js/config');
      const functionsDir = path.join(projectDir, 'dist');
      if (!hasOmegaConfig(functionsDir)) {
        return {};
      }
      const config = loadConfig(functionsDir, 'backend').config;
      return config.ports && typeof config.ports === 'object' ? config.ports : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * The project this stack serves, read from the brand config. Lenient like
   * loadPortPins() — a missing/broken config means no project id, which the
   * ownership matcher treats as "no evidence", never a boot failure.
   */
  loadProjectId(projectDir) {
    try {
      const { hasOmegaConfig, loadConfig } = require('@omega.js/config');
      const functionsDir = path.join(projectDir, 'dist');
      if (!hasOmegaConfig(functionsDir)) {
        return null;
      }
      return loadConfig(functionsDir, 'backend').config.cloud?.config?.projectId || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The ownership evidence this run can offer the sweep: the pids it recorded
   * when its stack came up, and the project it belongs to. Recorded pids age
   * out — see ownershipFromRecord().
   * @returns {{pids: number[], projectId: string|null, rootPid: number|null}}
   */
  readEmulatorOwnership() {
    return ownershipFromRecord(jetpack.read(this.getTempPath(PID_RECORD_FILE), 'json'));
  }

  /**
   * Record the stack's pids while it is UP, so the post-shutdown sweep can
   * prove which orphans are its own
   * ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
   * @param {number} rootPid - The spawned child's pid.
   * @param {string|null} projectId - The project this stack serves.
   */
  writeEmulatorPidRecord(rootPid, projectId) {
    const existing = this.readEmulatorOwnership();

    // UNION with what this run already recorded: a later snapshot can only see
    // what is still attached, and a child that orphaned in between is exactly
    // the one the sweep exists for. Pids of processes that have since exited
    // cost nothing — signaling one is a caught ESRCH.
    const previous = existing.pids.length > 0 && existing.rootPid === rootPid ? existing.pids : [];
    const pids = [...new Set([...previous, ...collectDescendantPids(rootPid)])];

    jetpack.write(this.getTempPath(PID_RECORD_FILE), {
      pids: pids,
      projectId: projectId || null,
      rootPid: rootPid,
      startedAt: new Date().toISOString(),
    });

    return pids;
  }

  /**
   * Terminate processes still listening on THIS RUN's emulator ports after
   * shutdown. Firebase-tools spawns Java emulators (Firestore, Database,
   * PubSub) that often survive SIGTERM/SIGKILL of the firebase node process.
   * This sweep runs AFTER the main child exits, so anything still on these
   * ports is orphaned.
   *
   * Ownership is PROVEN per process, never inferred from the port: the sweep
   * used to signal whatever was listening and took down another project's live
   * emulator on the shared hub/storage ports
   * ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)). A port only
   * decides where to LOOK; isOwnedEmulatorProcess() decides what to signal.
   *
   * N7: the sweep takes the RESOLVED port map — no map → no sweep. The shared
   * hub (4400) + storage (9199) ports are looked at only on a defaults run
   * (`sweepShared`); on a bumped run they belong to the incumbent.
   */
  terminateOrphanedEmulatorProcesses(emulatorPorts, { sweepShared = true } = {}) {
    if (!emulatorPorts) {
      return;
    }

    // `https` is OUR in-process TLS proxy (closed with the child), never an
    // orphaned java emulator — sweeping it would signal this very process
    // on a close-timing race.
    const { https: _httpsPort, ...sweepable } = emulatorPorts;
    const ports = Object.values(sweepable);
    if (sweepShared) {
      ports.push(4400, 9199);
    }

    const ownership = this.readEmulatorOwnership();

    // Synchronous sweep — no async delays that Ctrl+C spam can interrupt.
    const { execSync } = require('child_process');
    let terminated = 0;
    let spared = 0;

    for (const port of ports) {
      try {
        const pids = execSync(`lsof -ti TCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' })
          .trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            const command = execSync(`ps -o command= -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();

            if (!isOwnedEmulatorProcess({ pid: pid, command: command }, ownership)) {
              spared++;
              continue;
            }

            process.kill(Number(pid), 'SIGKILL');
            terminated++;
          } catch (e) { /* vanished mid-check, or already gone */ }
        }
      } catch (e) { /* no process on this port */ }
    }

    if (terminated > 0) {
      this.log(chalk.gray(`  Cleaned up ${terminated} orphaned emulator process${terminated > 1 ? 'es' : ''}.`));
    }

    if (spared > 0) {
      this.log(chalk.gray(`  Left ${spared} process${spared > 1 ? 'es' : ''} on these ports alone — not this project's emulator.`));
    }
  }

  /**
   * Pre-boot reaper for CRASHED-run leftovers: kill processes squatting the
   * wanted ports (plus the shared hub/storage ports) that are reparented to
   * PID 1 — the firebase parent that spawned them is gone, so nothing will
   * ever tear them down — AND can be PROVEN to be this project's.
   *
   * Ownership is the same bar the post-shutdown sweep clears: a name matching
   * /emulator|firebase/i is not evidence, so the reaper no longer kills
   * another brand's orphans or another session's reload watcher on ports it
   * merely wants ([#293](https://github.com/Omega-JS-Stack/omega/issues/293)).
   * A sibling brand's LIVE emulator keeps its parent and never matches either;
   * the allocator bumps around both exactly as before.
   * @param {number[]} ports - The wanted port map's values.
   * @param {{pids: number[], projectId: string|null}} ownership - This project's evidence.
   */
  reapOrphanedEmulators(ports, ownership) {
    const { execSync } = require('child_process');
    let reaped = 0;
    let spared = 0;

    for (const port of [...new Set([...(ports || []), 4400, 9199])]) {
      try {
        const pids = execSync(`lsof -ti TCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' })
          .trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            const info = execSync(`ps -o ppid=,command= -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
            const match = info.match(/^\s*(\d+)\s+(.*)$/s);
            if (!match) continue;

            if (!isReapableOrphan({ pid: pid, ppid: match[1], command: match[2] }, ownership)) {
              spared++;
              continue;
            }

            process.kill(Number(pid), 'SIGKILL');
            reaped++;
          } catch (e) { /* vanished mid-check */ }
        }
      } catch (e) { /* port free */ }
    }

    if (reaped > 0) {
      this.log(chalk.gray(`  Reaped ${reaped} orphaned emulator process${reaped > 1 ? 'es' : ''} left by a previous crashed run.`));
    }

    if (spared > 0) {
      this.log(chalk.gray(`  Left ${spared} process${spared > 1 ? 'es' : ''} on these ports alone — not this project's crash leftovers.`));
    }
  }
}

// Static, alongside Middleware's precedent — the ownership decision is pure,
// so tests exercise it directly with real `ps` rows instead of live processes.
EmulatorCommand.isOwnedEmulatorProcess = isOwnedEmulatorProcess;
EmulatorCommand.isReapableOrphan = isReapableOrphan;
EmulatorCommand.ownershipFromRecord = ownershipFromRecord;
EmulatorCommand.collectDescendantPids = collectDescendantPids;

module.exports = EmulatorCommand;
