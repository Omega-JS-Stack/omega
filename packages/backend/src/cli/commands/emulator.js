const BaseCommand = require('./base-command');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const powertools = require('node-powertools');
const WatchCommand = require('./watch');
const { loadEmulatorPorts } = require('./setup-tests/emulator-config');
const { resolvePorts, writePortsFile, clearPortsFile, portsToEnv, isPortFree } = require('@omega.js/config');
const { EXTENDED_MODE_WARNING } = require('../../test/utils/extended-mode-warning');
const { writeTestMode, captureSyncedEnv } = require('../../test/utils/test-mode-file');
const { seed } = require('../../test/seed.js');
const { createChildLog } = require('../utils/attach-log-file');
const { refuseWhenCustom } = require('../utils/project-type');

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

// How long a recorded emulator process gets to leave on SIGTERM before the
// stop path escalates, and how long its ports get to come back free after the
// last one is gone (a java emulator releases its listener as it unwinds).
const STOP_GRACE_MS = 2000;
const PORT_RELEASE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

// How long the port→pid lookup gets to answer before a sweep gives up on it.
// lsof stats every mounted filesystem first, so a machine with a network mount
// pays for the walk on every call — measured at ~90ms a call here, and a stall
// on the smbfs volume runs to MINUTES
// ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)). The call is
// synchronous, so an unbounded one freezes the whole run: the boot path
// absorbed that in its ready window, and the stop path simply sat there until
// a ship gate's lane budget was gone
// ([#459](https://github.com/Omega-JS-Stack/omega/issues/459)). This is ~50x a
// healthy answer, and the same window the port verdict already waits.
const PORT_LOOKUP_TIMEOUT_MS = 5000;

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
 * The project a command line names as an argument, or null when it names none.
 *
 * Same argument form as commandNamesProject(), read the other way round: not
 * "is it this project" but "which project does it say it is". A jar that names
 * one is self-identifying evidence that outranks a recorded pid number.
 * @param {string} command - Full command line from ps.
 * @returns {string|null}
 */
function commandProjectId(command) {
  const match = /--project(?:_id)?[= ](\S+)/.exec(String(command || ''));

  return match ? match[1] : null;
}

// How long a boot may take before the run declares it dead and shuts the
// partial stack down. The default absorbs a slow port sweep — lsof stalling on
// a network mount takes a real boot past the old 60s cap, which failed every
// self-booting lane on such a machine
// ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)).
const DEFAULT_READY_TIMEOUT_MS = 180000;

/**
 * Resolve the emulator ready deadline from the environment.
 * @param {string} [raw] - The OMEGA_EMULATOR_READY_TIMEOUT value, in ms.
 * @returns {number} The deadline in milliseconds.
 */
function resolveReadyTimeout(raw) {
  if (raw === undefined || raw === '') {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  const parsed = Number(raw);

  // A junk override fails loudly instead of silently racing an unknown
  // deadline — the same rule the #211 lane multiplier follows.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`OMEGA_EMULATOR_READY_TIMEOUT must be a positive number of milliseconds, got "${raw}"`);
  }

  return parsed;
}

/**
 * The subset of `ports` something is actually listening on.
 *
 * The sweeps below need a port to name a pid, and `lsof` is the only tool that
 * maps one. It stats every mounted filesystem before it answers, so a machine
 * with a network mount (an smbfs Time Machine volume) pays seconds per call,
 * and a boot ran one call per port whether or not anything was there: ~96s of
 * pure waste on a run with every port free, which pushed boot past the ready
 * deadline ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)).
 *
 * A port nothing holds cannot have a holder to name, so its lookup could only
 * ever come back empty. Probe first with the same bind primitive the allocator
 * uses (in-process, no shell, no filesystem walk) and look up only the ports
 * that answer. Same ports considered, same decisions, minus the empty calls.
 * @param {number[]} ports - The ports a sweep is about to consider.
 * @param {(port: number) => Promise<boolean>} [isFree] - The probe (injectable).
 * @returns {Promise<number[]>} The held subset, deduped.
 */
async function heldPorts(ports, isFree = isPortFree) {
  const unique = [...new Set(ports || [])].filter((port) => Number.isInteger(port));
  const free = await Promise.all(unique.map((port) => isFree(port)));

  return unique.filter((port, index) => !free[index]);
}

/**
 * The pids LISTENING on a port.
 *
 * The one step with no Node primitive: only lsof maps a port to a process. It
 * is reached solely for a port heldPorts() already proved is held, so a normal
 * boot never shells here at all.
 *
 * And it is BOUNDED, because the tool can stall indefinitely on a network
 * mount (PORT_LOOKUP_TIMEOUT_MS). A lookup that overruns names nobody, which
 * is what every caller already does with a port whose holder it cannot
 * identify: report it, leave it running. The bound can only ever spare a
 * process, never take one.
 * @param {number} port - A port something is known to hold.
 * @returns {string[]} The listening pids, or [] when the read fails or overruns.
 */
function listListeningPids(port) {
  const { execFileSync } = require('child_process');

  try {
    // No shell: the bound has to land on lsof ITSELF, and an `sh -c` wrapper
    // is one more process for the kill to hit instead. stderr is dropped by
    // the stdio map, which is all the old `2>/dev/null` was doing. SIGKILL
    // because a process wedged in a filesystem call is exactly the one that
    // would ignore a polite signal and hold the run past its own timeout.
    return execFileSync('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: PORT_LOOKUP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim().split('\n').filter(Boolean);
  } catch (error) {
    return [];
  }
}

/**
 * Every port the firebase config tells the emulator child to bind.
 *
 * Read from the config, never hard-coded: a brand may declare emulators this
 * CLI's allocator knows nothing about (eventarc, tasks), and those are exactly
 * the ones a boot cannot relocate.
 * @param {object} firebaseConfig - The parsed firebase config the child reads.
 * @returns {object} name to port, for every emulator that names a port.
 */
function declaredEmulatorPorts(firebaseConfig) {
  const declared = {};

  for (const [name, entry] of Object.entries(firebaseConfig?.emulators || {})) {
    if (Number.isInteger(entry?.port)) {
      declared[name] = entry.port;
    }
  }

  return declared;
}

/**
 * The boot's port plan: what the emulator child is about to bind.
 *
 * The resolved map wins over the declared value, because a bumped port is what
 * the child actually receives (via firebase.resolved.json). `https` is left
 * out: that is THIS process's TLS proxy, not the child's listener.
 * @param {object} declared - name to port, from the firebase config.
 * @param {object} resolved - This run's allocated map (already bumped).
 * @returns {Array<{name: string, port: number}>}
 */
function plannedEmulatorPorts(declared, resolved) {
  const plan = [];

  for (const [name, port] of Object.entries({ ...declared, ...resolved })) {
    if (name === 'https') {
      continue;
    }

    plan.push({ name: name, port: port });
  }

  return plan;
}

/**
 * The fail-fast report for a boot whose plan cannot work.
 * @param {Array<{name: string, port: number}>} blocked - The held planned ports.
 * @returns {string}
 */
function formatPortPreflightFailure(blocked) {
  const named = blocked.map(({ name, port }) => `port ${port} (${name})`).join(', ');
  const numbers = blocked.map(({ port }) => port).join(', ');

  return [
    `Port preflight failed: this emulator must bind ${named}, and something already holds ${blocked.length > 1 ? 'them' : 'it'}.`,
    'Another dev stack is in the way: a tower app on that port, another brand\'s `omega dev`, or an emulator a crashed run left behind.',
    `Stop whatever holds ${numbers} and run this again. Nothing was spawned, so there is no partial stack to clean up.`,
  ].join('\n  ');
}

/**
 * Stop the boot BEFORE firebase is spawned when the plan cannot work.
 *
 * The allocator already relocates around a busy port (N7 bump-if-taken), so a
 * plan that still names a held port names one this run cannot move off. Left
 * to firebase, that boot never prints its ready marker and the run burns the
 * whole ready deadline before anything says why
 * ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)).
 * @param {Array<{name: string, port: number}>} planned - What the child will bind.
 * @param {(port: number) => Promise<boolean>} [isFree] - The probe (injectable).
 * @returns {Promise<void>} Rejects with the report when a planned port is held.
 */
async function assertPlannedPortsFree(planned, isFree = isPortFree) {
  const held = await heldPorts(planned.map(({ port }) => port), isFree);

  if (held.length === 0) {
    return;
  }

  throw new Error(formatPortPreflightFailure(planned.filter(({ port }) => held.includes(port))));
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
 * Should the STOP path signal this recorded process?
 *
 * The stop path has no port to narrow by — it walks the record itself — so the
 * recorded pid alone would be the whole proof, and pids get RECYCLED. The live
 * command line is the second half: a recorded number that now names something
 * that is not emulator machinery is a stranger the OS handed our pid to, and
 * it is left running ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
 *
 * Recycling inside the SAME machinery is the harder half: a recorded number
 * that now runs the neighbouring brand's firestore jar reads as ours on the pid
 * alone. A jar that names a project id names it truthfully, so when this run
 * knows its own project id and the live command line disagrees, the number is
 * recycled and the process is left running. A jar that names none (the pubsub
 * emulator) is decided by the record, as before.
 * @param {{pid: number|string, command: string}} candidate - One ps row.
 * @param {{pids: number[], projectId: string|null}} ownership - This run's record.
 * @returns {boolean}
 */
function isStoppableEmulatorProcess(candidate, ownership) {
  const command = String(candidate?.command || '');

  if (!EMULATOR_COMMAND.test(command)) {
    return false;
  }

  const named = commandProjectId(command);

  if (named && ownership?.projectId && named !== ownership.projectId) {
    return false;
  }

  return isOwnedEmulatorProcess(candidate, ownership);
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
 * The command line a pid is running right now, or '' when it is gone.
 * @param {number|string} pid - The pid to read.
 * @returns {string}
 */
function readProcessCommand(pid) {
  const { execSync } = require('child_process');

  try {
    return execSync(`ps -o command= -p ${Number(pid)} 2>/dev/null`, { encoding: 'utf8' }).trim();
  } catch (error) {
    return '';
  }
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
    // Custom-server mode exports no Cloud Functions to emulate (#584)
    if (refuseWhenCustom(this.main.firebaseProjectPath, 'emulator')) return;

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
    // Kept outside the try so the failure path below can stop whatever came up.
    let started = null;

    try {
      started = await this.startEmulators({
        https: this.argv.https !== false,
      });
      const { shutdown, emulatorPorts, exitPromise } = started;

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
      // The handler cannot await, but the run must not exit ahead of the
      // shutdown it started: the jar reap runs AFTER the child is gone, and
      // process.exit() below would cut it off mid-signal
      // ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)). Keep the
      // promise and join it once the child has exited.
      let shutdownRun = null;
      const onSigint = () => {
        sigintCount++;
        if (sigintCount === 1) {
          this.log(chalk.gray('\n  Shutting down emulator... (Ctrl+C again to force kill)'));
          shutdownRun = shutdown();
        } else {
          this.log(chalk.gray('  Force killing emulator...'));
          shutdownRun = shutdown();
        }
      };
      process.on('SIGINT', onSigint);

      // Resolve when the emulator exits (via shutdown or crash)
      await exitPromise;
      // A child that exited on its own (a crash, firebase-tools stopping
      // itself) started no shutdown — run one anyway, so the same reap covers
      // both ways this line is reached. shutdown() owns the whole teardown now:
      // the recorded jars, the orphan sweep, and the port verdict. The SIGINT
      // listener stays active across it so Ctrl+C spam can't cut it short.
      await (shutdownRun || shutdown());
      // Reap the background watcher — it is NOT in the firebase child's
      // process group, so nothing else kills it on a programmatic shutdown.
      if (watcherChild) {
        try { watcherChild.kill('SIGTERM'); } catch (e) { /* already gone */ }
      }
      process.removeListener('SIGINT', onSigint);
      this.log(chalk.gray('  Emulator stopped.\n'));
      if (sigintCount > 0) {
        process.exit(0);
      }
    } catch (error) {
      this.logError(`Emulator error: ${error.message || error}`);
      // A failed boot spawned things too: the stack (startEmulators stops its
      // own before it throws) and this frame's background watcher, which
      // nothing else signals — exiting here left an immortal nodemon behind
      // ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)). Anything
      // that got as far as a handle gets the same stop path.
      if (started) {
        try { await started.shutdown(); } catch (e) { /* the stop path already reported */ }
      }
      if (watcherChild) {
        try { watcherChild.kill('SIGTERM'); } catch (e) { /* already gone */ }
      }
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
    await this.reapOrphanedEmulators(Object.values(wanted), {
      pids: recorded.pids,
      projectId: this.loadProjectId(projectDir) || recorded.projectId,
    });

    const { ports: emulatorPorts, bumped } = await resolvePorts({
      wanted,
      pins: this.loadPortPins(projectDir),
    });

    // Preflight: the allocator has relocated around every busy port it owns,
    // so anything still held is a port this run cannot move off. Report it now,
    // by name, instead of spawning a stack that never comes up and burning the
    // whole ready deadline first
    // ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)).
    try {
      await this.preflightEmulatorPorts(projectDir, emulatorPorts);
    } catch (error) {
      // Nothing is spawned yet, but the stage watcher is: it is normally torn
      // down with the emulator child, and this boot will never have one.
      stageWatch.close();
      throw error;
    }

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

    // The stage watcher lives exactly as long as the emulator child — bound
    // here, before the readiness wait, so a boot that never comes up takes it
    // down too ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)).
    exitPromise.then(() => stageWatch.close());

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

      // 2. Take the jars the group signal cannot reach, by pid, sweep whatever
      // orphaned outside the record, and prove the ports came back
      // ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)). The
      // shared hub/storage ports belong to this run only when nothing bumped.
      await this.terminateRecordedEmulatorProcesses(emulatorPorts, { sweepShared: bumped.length === 0 });

      shutdownDone = true;
    };

    // Race the readiness marker against a deadline. A boot that never comes
    // up has still spawned: the shell, firebase, and any jar it got as far as.
    // Throwing straight out of here left them running and handed the caller no
    // handle to stop them, so a failed boot takes the same stop path a normal
    // one does before it propagates
    // ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)). The
    // deadline is env-tunable and defaults high enough to absorb a slow port
    // sweep ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)).
    const readyTimeoutMs = resolveReadyTimeout(process.env.OMEGA_EMULATOR_READY_TIMEOUT);
    try {
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error(`Emulator did not print "All emulators ready" within ${readyTimeoutMs}ms`)),
          readyTimeoutMs,
        )),
      ]);
    } catch (error) {
      await shutdown();
      throw error;
    }

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
    // shutdown() carries the whole teardown (recorded jars, orphan sweep, port
    // verdict), so both paths below just join it.
    const { shutdown, exitPromise } = await this.startEmulators();

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

      if (cmdExit.code !== 0) {
        throw Object.assign(new Error(`Command exited with code ${cmdExit.code}`), { code: cmdExit.code });
      }
    } catch (e) {
      process.removeListener('SIGINT', onSigint);
      await shutdown();
      throw e;
    }
  }

  /**
   * Sweep the ports this boot is about to bind and fail fast when one is held.
   *
   * The set is read from the firebase config, never hard-coded: the resolved
   * map covers everything the allocator owns, and the config's own `emulators`
   * block covers anything it does not (an eventarc or tasks port a brand
   * declared), which is the half that cannot bump. A lenient read matches
   * loadPortPins(): an unreadable config means no extra ports, never a boot
   * failure on its own.
   * @param {string} projectDir - The firebase project directory.
   * @param {object} emulatorPorts - This run's resolved port map.
   * @param {Function} [isFree] - Port probe (injectable).
   * @returns {Promise<Array<{name: string, port: number}>>} The plan that cleared.
   */
  async preflightEmulatorPorts(projectDir, emulatorPorts, isFree = isPortFree) {
    let declared = {};

    try {
      declared = declaredEmulatorPorts(JSON5.parse(jetpack.read(path.join(projectDir, 'firebase.json'))));
    } catch (error) { /* no readable config, so the resolved map is the whole plan */ }

    const planned = plannedEmulatorPorts(declared, emulatorPorts);
    await assertPlannedPortsFree(planned, isFree);

    return planned;
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
   * Terminate the stack this run RECORDED, then prove its ports came back.
   *
   * The group signal in shutdown() reaches `sh`/firebase and its direct
   * children only: firebase-tools starts each java emulator in its OWN process
   * group, so the jars never see it, and they reparent to PID 1 the moment
   * their parent goes. A stop that escalates to SIGKILL (a firestore emulator
   * that does not finish its graceful stop inside the grace window) therefore
   * leaves the jars running, and the next brand's boot bumps around a squatter
   * that answers on the classic ports forever
   * ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)). The pid
   * record written while the tree was still attached is the only surviving
   * link to them, so the stop path signals what it names, BY PID.
   *
   * Ownership stays proven per process — a recorded number whose live command
   * line is not emulator machinery is a recycled pid, never our jar — and the
   * port check only REPORTS: nothing is signaled for occupying a port
   * ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
   *
   * The owned-orphan sweep runs BEFORE that check, because it can still free a
   * port: a jar the record never named (spawned after the last snapshot, then
   * reparented to PID 1) is the sweep's case, not the record's. Verifying
   * first spent the whole release window on a port the next step was about to
   * clear, then reported it as somebody else's.
   *
   * @param {object} emulatorPorts - This run's resolved port map.
   * @param {object} [options]
   * @param {boolean} [options.sweepShared] - Look at the shared hub/storage
   *   ports too (a defaults run owns them; a bumped run does not).
   */
  async terminateRecordedEmulatorProcesses(emulatorPorts, { sweepShared = true } = {}) {
    const ownership = this.readEmulatorOwnership();
    const targets = [];

    for (const recorded of ownership.pids) {
      const pid = Number(recorded);
      const command = readProcessCommand(pid);

      // Gone already (the group signal took it) or not ours anymore.
      if (!command || !isStoppableEmulatorProcess({ pid: pid, command: command }, ownership)) {
        continue;
      }

      targets.push(pid);
    }

    for (const pid of targets) {
      try { process.kill(pid, 'SIGTERM'); } catch (e) { /* exited between the read and the signal */ }
    }

    // Give them the grace window, then take whatever is still standing.
    const survivors = await this.waitForProcessesToExit(targets, STOP_GRACE_MS);

    for (const pid of survivors) {
      try { process.kill(pid, 'SIGKILL'); } catch (e) { /* gone in the meantime */ }
    }

    if (targets.length > 0) {
      this.log(chalk.gray(`  Stopped ${targets.length} recorded emulator process${targets.length > 1 ? 'es' : ''}${survivors.length > 0 ? ` (${survivors.length} needed SIGKILL)` : ''}.`));
    }

    // Anything of ours the record could not name is the sweep's to take, and
    // it runs while the ports still matter — before the verdict below.
    await this.terminateOrphanedEmulatorProcesses(emulatorPorts, { sweepShared: sweepShared });

    // The ports are the only proof that matters to the NEXT boot.
    const { https: _httpsPort, ...checkable } = emulatorPorts || {};
    const held = await this.waitForPortsReleased(Object.values(checkable));

    if (held.length > 0) {
      this.logWarning(`Emulator ports still in use after shutdown: ${held.join(', ')} (everything this run could prove it owns is stopped; whatever holds them did not prove to be ours)`);
    }
  }

  /**
   * Poll a pid set until every one is gone or the window closes.
   * @param {number[]} pids - The pids to watch.
   * @param {number} timeoutMs - How long to wait in total.
   * @returns {Promise<number[]>} The pids still alive when the window closed.
   */
  async waitForProcessesToExit(pids, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let alive = pids;

    while (alive.length > 0 && Date.now() < deadline) {
      await powertools.wait(POLL_INTERVAL_MS);
      alive = alive.filter((pid) => !!readProcessCommand(pid));
    }

    return alive;
  }

  /**
   * Poll a port set until nothing is listening or the window closes.
   * @param {number[]} ports - The ports this run resolved.
   * @returns {Promise<number[]>} The ports still held when the window closed.
   */
  async waitForPortsReleased(ports, { isFree = isPortFree } = {}) {
    const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
    let held = [...new Set(ports)];

    while (held.length > 0 && Date.now() < deadline) {
      const free = await Promise.all(held.map((port) => isFree(port)));
      held = held.filter((port, index) => !free[index]);

      if (held.length > 0) {
        await powertools.wait(POLL_INTERVAL_MS);
      }
    }

    return held;
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
   * @param {object} emulatorPorts - This run's resolved port map.
   * @param {object} [options]
   * @param {boolean} [options.sweepShared] - Include the shared hub/storage ports.
   * @param {Function} [options.isFree] - Port probe (injectable).
   * @param {Function} [options.listPids] - Port to pid lookup (injectable).
   */
  async terminateOrphanedEmulatorProcesses(emulatorPorts, { sweepShared = true, isFree = isPortFree, listPids = listListeningPids } = {}) {
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

    // The probe is the only await, and it runs before a single signal is sent.
    // The kill loop itself stays synchronous, so Ctrl+C spam cannot land
    // between two signals of the same sweep.
    const { execSync } = require('child_process');
    let terminated = 0;
    let spared = 0;

    for (const port of await heldPorts(ports, isFree)) {
      for (const pid of listPids(port)) {
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
   * @param {object} [probes]
   * @param {Function} [probes.isFree] - Port probe (injectable).
   * @param {Function} [probes.listPids] - Port to pid lookup (injectable).
   */
  async reapOrphanedEmulators(ports, ownership, { isFree = isPortFree, listPids = listListeningPids } = {}) {
    const { execSync } = require('child_process');
    const killedPorts = new Set();
    let reaped = 0;
    let spared = 0;

    for (const port of await heldPorts([...(ports || []), 4400, 9199], isFree)) {
      for (const pid of listPids(port)) {
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
          killedPorts.add(port);
        } catch (e) { /* vanished mid-check */ }
      }
    }

    if (reaped > 0) {
      this.log(chalk.gray(`  Reaped ${reaped} orphaned emulator process${reaped > 1 ? 'es' : ''} left by a previous crashed run.`));

      // A SIGKILLed JVM does not release its socket the instant kill() returns,
      // and the allocator probes these same ports right after this method. The
      // sweep used to be slow enough to hide that race; now it is milliseconds,
      // so wait like shutdown does or the run bumps around a corpse.
      const held = await this.waitForPortsReleased([...killedPorts], { isFree });
      if (held.length > 0) {
        this.log(chalk.gray(`  Port${held.length > 1 ? 's' : ''} ${held.join(', ')} still closing after the reap; the allocator will bump around ${held.length > 1 ? 'them' : 'it'}.`));
      }
    }

    if (spared > 0) {
      this.log(chalk.gray(`  Left ${spared} process${spared > 1 ? 'es' : ''} on these ports alone — not this project's crash leftovers.`));
    }
  }
}

// Static, alongside Middleware's precedent — the ownership decision is pure,
// so tests exercise it directly with real `ps` rows instead of live processes.
EmulatorCommand.resolveReadyTimeout = resolveReadyTimeout;
EmulatorCommand.heldPorts = heldPorts;
EmulatorCommand.listListeningPids = listListeningPids;
EmulatorCommand.PORT_LOOKUP_TIMEOUT_MS = PORT_LOOKUP_TIMEOUT_MS;
EmulatorCommand.plannedEmulatorPorts = plannedEmulatorPorts;
EmulatorCommand.assertPlannedPortsFree = assertPlannedPortsFree;
EmulatorCommand.isOwnedEmulatorProcess = isOwnedEmulatorProcess;
EmulatorCommand.isStoppableEmulatorProcess = isStoppableEmulatorProcess;
EmulatorCommand.isReapableOrphan = isReapableOrphan;
EmulatorCommand.ownershipFromRecord = ownershipFromRecord;
EmulatorCommand.collectDescendantPids = collectDescendantPids;

module.exports = EmulatorCommand;
