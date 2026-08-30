const chalk = require('chalk').default;
const { confirm } = require('@inquirer/prompts');
const { execSync, spawn } = require('child_process');
const path = require('path');
const jetpack = require('fs-jetpack');
const ui = require('../utils/ui');
const attachLogFile = require('../utils/attach-log-file');

class BaseCommand {
  constructor(main) {
    this.main = main;
    this.firebaseProjectPath = main.firebaseProjectPath;
    this.argv = main.argv;
    this.options = main.options;
    // Shared OMEGA-style CLI styling helpers (dividers, headers, status lines).
    // See src/cli/utils/ui.js. Use `this.ui.*` in any command for consistent output.
    this.ui = ui;
  }

  async execute() {
    throw new Error('Execute method must be implemented');
  }

  /**
   * Resolve a path inside the consumer project's `.temp/` directory. Used for
   * TRULY internal artifacts that have no debugging value: reset sentinels
   * (*.log.reset), the watch command's reload trigger, and `test-mode.json`.
   *
   * For human-readable log files, use `getLogsPath()` instead — those live in
   * `dist/` next to firebase-tools' own *-debug.log files so all log
   * output can be grepped from one directory.
   *
   * Ensures the directory exists.
   * @param {string} [filename] - File name to append (omit to get the dir path).
   * @returns {string} Absolute path.
   */
  getTempPath(filename) {
    const projectDir = this.main.firebaseProjectPath;
    const tempDir = path.join(projectDir, '.temp');
    jetpack.dir(tempDir);
    return filename ? path.join(tempDir, filename) : tempDir;
  }

  /**
   * Resolve a path for a human-readable log file. @omega.js/backend-owned logs (dev.log,
   * emulator.log, test.log, production.log) live in `dist/` alongside
   * firebase-tools' own *-debug.log files so all log output is grep-able from
   * one place. Reset sentinels and other internal-only artifacts use
   * `getTempPath()` instead.
   *
   * @param {string} [filename] - File name to append (omit to get the dir path).
   * @returns {string} Absolute path.
   */
  getLogsPath(filename) {
    const projectDir = this.main.firebaseProjectPath;
    const logsDir = path.join(projectDir, 'dist');
    return filename ? path.join(logsDir, filename) : logsDir;
  }

  /**
   * Tee THIS process' stdout/stderr to `<targetRoot>/logs/<verb>.log` — the
   * cross-framework verb-log lane (#197): every framework's dev/build/test
   * writes its own run there, so an agent greps one predictable path.
   *
   * Distinct from `getLogsPath()`, which is `dist/` — where the firebase CHILD
   * processes' output lands, beside firebase-tools' own *-debug.log files.
   *
   * @param {string} verb - Log base name (`dev`, `build`, `test`).
   * @returns {string} The absolute log path.
   */
  attachVerbLog(verb) {
    const logPath = path.join(this.main.firebaseProjectPath, 'logs', `${verb}.log`);
    attachLogFile(logPath);
    return logPath;
  }

  /**
   * Sweep stale @omega.js/backend-owned logs out of `dist/`. Catches `.log` files
   * from previous runs so each emulator/serve/test boot starts with a clean
   * slate. Also catches stale `.reset` sentinels in `.temp/` that a crashed
   * process may have left behind.
   *
   * Firebase-tools writes its own debug logs (firestore-debug.log,
   * database-debug.log, pubsub-debug.log, firebase-debug.log, ui-debug.log) to
   * cwd and we can't redirect them — we deliberately do NOT touch those, so
   * users can grep them after a crash.
   */
  sweepStaleLogs() {
    const logFiles = [
      'dev.log',
      'deploy.log',
      'emulator.log',
      'test.log',
      'production.log',
    ];
    const resetSentinels = [
      'dev.log.reset',
      'emulator.log.reset',
    ];

    for (const name of logFiles) {
      try { jetpack.remove(this.getLogsPath(name)); } catch (e) { /* best-effort */ }
    }
    for (const name of resetSentinels) {
      try { jetpack.remove(this.getTempPath(name)); } catch (e) { /* best-effort */ }
    }
  }

  /**
   * Stage the authored target tree into dist/ (the src/dist pillar's build step).
   * Every runtime surface calls this before touching dist/ — emulator, serve,
   * test, deploy — so the staged tree is always fresh.
   *
   * The local scaffold runs FIRST (#675): `omega setup` is retired, so every
   * verb heals the target on its way past — idempotent and silent when there
   * is nothing to write.
   *
   * @param {object} [options]
   * @param {boolean} [options.deploy] - Stage for an UPLOAD: the .env loses its
   *   dev-only rows (#586). Every local lane re-stages without it, so a deploy
   *   never leaves the emulator without its dev payment secrets.
   */
  ensureStaged({ deploy = false } = {}) {
    const { ensureTarget } = require('../utils/ensure-target');
    const { stageFunctions } = require('../utils/stage-functions');

    ensureTarget({
      projectDir: this.main.firebaseProjectPath,
      log: (message) => this.log(chalk.gray(`  ${message}`)),
    });

    stageFunctions({
      projectDir: this.main.firebaseProjectPath,
      deploy,
      log: (message) => this.log(chalk.gray(`  ${message}`)),
    });
    this.log(chalk.gray(`  Staged dist/ from src/ (omega build${deploy ? ', deploy: dev-only keys stripped' : ''})`));
  }

  /**
   * Watch src/ and re-stage on change — the Firebase emulator watches dist/
   * natively, so a re-stage IS the hot reload. Returns the watcher handle
   * ({ close }) for shutdown paths.
   */
  startStageWatch() {
    const { watchAndStage } = require('../utils/stage-functions');
    return watchAndStage({
      projectDir: this.main.firebaseProjectPath,
      log: (message) => this.log(chalk.gray(`  ${message}`)),
    });
  }

  log(...args) {
    console.log(...args);
  }

  logError(message) {
    console.log(chalk.red(message));
  }

  logSuccess(message) {
    console.log(chalk.green(message));
  }

  logWarning(message) {
    console.log(chalk.yellow(message));
  }

  /**
   * Check for port conflicts and prompt to kill blocking processes
   * @param {object} emulatorPorts - Object with port numbers { functions, firestore, auth }
   * @returns {boolean} - true if we can proceed, false if user aborted
   */
  async checkAndKillBlockingProcesses(emulatorPorts) {
    const portsToCheck = Object.entries(emulatorPorts)
      .filter(([_, port]) => port)
      .map(([name, port]) => ({ name, port }));

    // Collect ALL processes on each blocked port
    const blockedPorts = [];
    for (const { name, port } of portsToCheck) {
      const processes = this.getProcessesOnPort(port);
      if (processes) {
        blockedPorts.push({ name, port, processes });
      }
    }

    if (blockedPorts.length === 0) {
      return true;
    }

    this.log(chalk.yellow('\n  The following ports are in use:'));
    for (const { name, port, processes } of blockedPorts) {
      for (const { pid, processName, command } of processes) {
        const cmdInfo = command ? ` ${command}` : '';
        this.log(chalk.gray(`    - ${name} emulator (port ${port}) - PID ${pid} (${processName})${cmdInfo}`));
      }
    }

    // Non-interactive environments (CI, agents, piped stdin) have no TTY, so inquirer
    // can't read a keypress — prompting would error or hang. Skip the prompt entirely
    // and auto-confirm the kill so unattended `mgr test` / `mgr emulator` runs proceed.
    if (!process.stdin.isTTY) {
      this.log(chalk.gray('  Non-interactive shell — auto-confirming port cleanup (Y).'));
      return this.killBlockingProcesses(blockedPorts);
    }

    // Auto-confirm (Y) after a few seconds of no input so unattended test/dev loops don't
    // hang. When the timeout fires the prompt is aborted via AbortSignal and we fall back to
    // the default (true). inquirer owns the cursor and can't live-update its own message, so
    // the countdown is shown statically in the prompt.
    const AUTO_CONFIRM_SECONDS = 5;
    let shouldKill;
    try {
      shouldKill = await confirm(
        { message: `Kill these processes to free the ports? (auto-Y in ${AUTO_CONFIRM_SECONDS}s)`, default: true },
        { signal: AbortSignal.timeout(AUTO_CONFIRM_SECONDS * 1000) },
      );
    } catch (error) {
      // Any prompt failure → fall back to the safe default (auto-confirm Y) instead of
      // crashing. This covers:
      //   - AbortPromptError: the 5s timeout fired (no input).
      //   - ExitPromptError / force-close: stdin is present but closed/EOF'd (the
      //     case under `mgr test`, agents, and other wrappers that pipe a non-readable
      //     stdin). inquirer throws "User force closed the prompt with 0 null" here.
      // Anything unexpected is logged but still defaults to Y so unattended runs proceed.
      const name = error?.name || '';
      const known = name === 'AbortPromptError' || name === 'ExitPromptError';
      if (!known) {
        this.log(chalk.gray(`  Prompt unavailable (${name || 'unknown'}) — auto-confirming (Y).`));
      } else {
        this.log(chalk.gray('  No input — auto-confirming (Y).'));
      }
      shouldKill = true;
    }

    if (!shouldKill) {
      this.log(chalk.gray('\n  Aborting. Free the ports and try again.\n'));
      return false;
    }

    return this.killBlockingProcesses(blockedPorts);
  }

  /**
   * Kill every process on the given blocked ports, then wait for release.
   * @param {object[]} blockedPorts - [{ name, port, processes: [{ pid }] }]
   * @returns {Promise<boolean>} - true if all killed (or already dead), false on failure
   */
  async killBlockingProcesses(blockedPorts) {
    // Kill ALL processes on each blocked port
    for (const { name, port, processes } of blockedPorts) {
      for (const { pid } of processes) {
        try {
          process.kill(pid, 'SIGKILL');
          this.log(chalk.green(`    ✓ Killed process ${pid} on port ${port} (${name})`));
        } catch (error) {
          // ESRCH means process already dead - that's fine
          if (error.code !== 'ESRCH') {
            this.logError(`    ✗ Failed to kill process ${pid}: ${error.message}`);
            return false;
          }
        }
      }
    }

    // Wait a moment for ports to be released
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
  }

  /**
   * Get info about ALL processes using a specific port
   * @param {number} port - Port number to check
   * @returns {object[]|null} - Array of process info if port is in use, null otherwise
   */
  getProcessesOnPort(port) {
    try {
      const result = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf8' });
      const pids = result.trim().split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(pid => !isNaN(pid));

      if (pids.length === 0) {
        return null;
      }

      // Get unique PIDs (lsof can return duplicates for multiple connections)
      const uniquePids = [...new Set(pids)];

      const processes = uniquePids.map(pid => {
        let processName = 'unknown';
        let command = '';
        try {
          const psResult = execSync(`ps -p ${pid} -o comm=,args= 2>/dev/null`, { encoding: 'utf8' });
          const parts = psResult.trim().split(/\s+/);
          processName = parts[0] || 'unknown';
          command = parts.slice(1).join(' ').substring(0, 100);
          if (command.length === 100) {
            command += '...';
          }
        } catch (e) {
          // Ignore - just use defaults
        }
        return { pid, processName, command };
      });

      return processes.length > 0 ? processes : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a port is in use.
   *
   * A bind probe, not an lsof read: lsof stats every mounted filesystem before
   * it answers, so on a machine with a network mount this one question cost
   * seconds at the head of every `omega test`
   * ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)). The probe is
   * the same primitive the port allocator resolves with, so the answer here and
   * the answer boot acts on can no longer disagree.
   * @param {number} port - Port number to check
   * @returns {Promise<boolean>} - true if port is in use
   */
  async isPortInUse(port) {
    const { isPortFree } = require('@omega.js/config');

    return !(await isPortFree(port));
  }

  /**
   * Start Stripe CLI webhook forwarding in the background
   * Forwards Stripe test webhooks to the local server
   * Gracefully skips if stripe CLI or STRIPE_SECRET_KEY is missing
   * @param {number} [forwardPort] - The port that speaks plain http to /omega/**
   *   (serve passes internal-under-https/public-otherwise; the emulator passes
   *   its resolved hosting port). Absent → a live sibling's ports file →
   *   firebase.json → classic 5002. (N7)
   * @returns {object|null} - Child process handle or null if skipped
   */
  startStripeWebhookForwarding(forwardPort) {
    const projectDir = this.main.firebaseProjectPath;
    const functionsDir = path.join(projectDir, 'dist');

    // Quit early here because its not supported yet
    this.log(chalk.gray('  (Stripe webhook forwarding is currently disabled - coming soon!)\n'));
    return null;

    // Load the .env cascade so STRIPE_SECRET_KEY and OMEGA_WEBHOOK_KEY are available
    require('@omega.js/config').loadEnv(functionsDir);

    // Check for Stripe secret key
    if (!process.env.STRIPE_SECRET_KEY) {
      this.log(chalk.gray('  (Stripe webhook forwarding disabled - STRIPE_SECRET_KEY not set in .env)\n'));
      return null;
    }

    // Check for OMEGA Backend webhook key
    if (!process.env.OMEGA_WEBHOOK_KEY) {
      this.log(chalk.gray('  (Stripe webhook forwarding disabled - OMEGA_WEBHOOK_KEY not set in .env)\n'));
      return null;
    }

    // Check if stripe CLI is installed
    let stripePath;
    try {
      stripePath = execSync('which stripe', { encoding: 'utf8' }).trim();
    } catch (e) {
      this.log(chalk.gray('  (Stripe webhook forwarding disabled - install Stripe CLI: https://stripe.com/docs/stripe-cli)\n'));
      return null;
    }

    // Resolve the plain-http target (N7): explicit from the caller, else a
    // live sibling's published map, else firebase.json, else classic 5002.
    const { readPortsFile } = require('@omega.js/config');
    const { loadEmulatorPorts } = require('./setup-tests/emulator-config.js');
    const hostingPort = forwardPort
      || readPortsFile(projectDir)?.hosting
      || loadEmulatorPorts(projectDir).hosting
      || 5002;

    const forwardUrl = `http://localhost:${hostingPort}/omega/payments/webhook?provider=stripe&key=${process.env.OMEGA_WEBHOOK_KEY}`;

    this.log(chalk.gray(`  Stripe webhook forwarding -> localhost:${hostingPort}\n`));

    const stripeProcess = spawn(stripePath, [
      'listen',
      '--forward-to', forwardUrl,
      '--api-key', process.env.STRIPE_SECRET_KEY,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Prefix output with [Stripe]
    const prefixStream = (stream) => {
      stream.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          console.log(chalk.gray(`  [Stripe] ${line}`));
        }
      });
    };

    prefixStream(stripeProcess.stdout);
    prefixStream(stripeProcess.stderr);

    stripeProcess.on('error', (error) => {
      this.log(chalk.yellow(`  [Stripe] Error: ${error.message}`));
    });

    stripeProcess.on('close', (code) => {
      if (code !== 0 && code !== null) {
        this.log(chalk.yellow(`  [Stripe] Exited with code ${code}`));
      }
    });

    return stripeProcess;
  }
}

module.exports = BaseCommand;
