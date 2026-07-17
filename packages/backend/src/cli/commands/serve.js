const BaseCommand = require('./base-command');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const powertools = require('node-powertools');
const WatchCommand = require('./watch');

class ServeCommand extends BaseCommand {
  async execute() {
    const self = this.main;
    const projectDir = self.firebaseProjectPath;
    const { isPortFree, resolvePorts, writePortsFile, clearPortsFile } = require('@omega.js/config');
    const { loadEmulatorPorts } = require('./setup-tests/emulator-config.js');

    // HTTPS: proxy on the public port (classic 5002), firebase serve on an
    // internal port (classic 5443). Disable with --no-https.
    const httpsEnabled = self.argv.https !== false;

    // N7: allocate instead of killing the incumbent — a taken port bumps +1
    // (a second brand's serve just lands next door). An explicit --port (or
    // positional) PINS: busy = hard error, never a silent move.
    const flagPort = parseInt(self.argv.port || self.argv?._?.[1], 10) || null;
    const pins = {};
    if (flagPort) {
      if (!(await isPortFree(flagPort))) {
        throw new Error(`Port ${flagPort} (pinned via --port) is already in use — free it or pick another`);
      }
      pins.public = flagPort;
    }
    const { ports: servePorts, bumped } = await resolvePorts({
      wanted: {
        public: flagPort || loadEmulatorPorts(projectDir).hosting || 5000,
        internal: 5443,
      },
      pins,
    });
    const port = servePorts.public;
    const internalPort = servePorts.internal;
    if (bumped.length) {
      this.log(chalk.yellow(`  Ports bumped (classic taken): ${bumped.map((name) => `${name}→${servePorts[name]}`).join(', ')}\n`));
    }

    // Wipe stale firebase-tools debug logs + any leftover @omega.js/backend logs from older
    // versions. Keeps the project tree clean across runs.
    this.sweepStaleLogs();

    // functions/ is staged output (src/dist pillar): stage fresh + re-stage on
    // src edits — firebase serve watches the functions dir, so a re-stage IS
    // the hot reload. Closed when the firebase child exits below.
    this.ensureStaged();
    const stageWatch = this.startStageWatch();

    // Start @omega.js/backend watcher in background
    const watcher = new WatchCommand(self);
    watcher.startBackground();

    // Start HTTPS proxy if enabled. If certs can't be obtained, fall back to
    // plain HTTP — don't set OMEGA_HTTPS_PORT or redirect to the internal port.
    const httpsReady = httpsEnabled
      ? await this._startHttpsProxy(port, internalPort, projectDir)
      : false;

    // Start Stripe webhook forwarding in background, aimed at the port that
    // actually speaks plain http: the internal firebase-serve port under the
    // https proxy, the public port otherwise. (Pre-N7 it re-derived hosting
    // from firebase.json and pointed http at the TLS proxy — a dead target.)
    this.startStripeWebhookForwarding(httpsReady ? internalPort : port);

    // Publish the resolved map for siblings (N7): `omega dev` composes it
    // into the page chrome, so @omega.js/client's getApiUrl follows even a
    // bumped serve. `https` = the mkcert proxy, `hosting` = wherever hosting
    // speaks plain http. Retracted when the firebase child exits.
    writePortsFile(projectDir, httpsReady
      ? { https: port, hosting: internalPort }
      : { hosting: port });

    // Set up log file in the project directory.
    const logPath = this.getLogsPath('dev.log');
    const resetSentinelPath = this.getTempPath('dev.log.reset');
    const RELOAD_MARKER = /Using node@\d+ from host\./;
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    let currentStream = fs.createWriteStream(logPath, { flags: 'w' });
    let reloadCount = 0;

    function rollLog() {
      try {
        const oldStream = currentStream;
        currentStream = fs.createWriteStream(logPath, { flags: 'w' });
        oldStream.end();
      } catch (e) {
        // Best-effort.
      }
    }

    function writeToLog(data) {
      if (currentStream && !currentStream.destroyed) {
        currentStream.write(stripAnsi(data.toString()));
      }
    }

    // Clean up any stale sentinel from a prior crashed serve run
    try { fs.unlinkSync(resetSentinelPath); } catch (e) { /* not present, ok */ }

    // Poll every 500ms for the reset sentinel
    const resetWatcher = setInterval(() => {
      if (!fs.existsSync(resetSentinelPath)) {
        return;
      }

      try {
        rollLog();
        fs.unlinkSync(resetSentinelPath);
      } catch (e) {
        // Best-effort.
      }
    }, 500);

    this.log(chalk.gray(`  Logs saving to: ${logPath}\n`));

    // demo-* projects are emulator-only by convention: `firebase serve`'s
    // hosting upstream fetches LIVE site config and 403s (there is no live
    // project to reach — BEM 1.4b residue; the serve mechanics themselves
    // are fine, cp90). Functions still serve, so warn-and-continue and point
    // at the hosting EMULATOR for the full surface.
    const { resolveProjectId } = require('./firebase-init');
    const serveProjectId = resolveProjectId(projectDir);
    if (String(serveProjectId || '').startsWith('demo-')) {
      this.log(chalk.yellow(`  ⚠ ${serveProjectId} is a demo-* (emulator-only) project — the hosting upstream will 403 here.`));
      this.log(chalk.yellow(`    Use ${chalk.cyan('omega emulator')} for demo-* hosting (its hosting emulator serves it fine).\n`));
    }

    // Execute with tee to log file
    const firebasePort = httpsReady ? internalPort : port;
    const firebaseEnv = {
      ...process.env,
      FORCE_COLOR: '1',
    };

    if (httpsReady) {
      // Internal calls (getApiUrl → BEMClient) loop through the HTTPS proxy with a self-signed cert
      firebaseEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      firebaseEnv.OMEGA_HTTPS_PORT = String(port);
    }
    // Where hosting speaks plain http (N7 env channel — functions inherit)
    firebaseEnv.OMEGA_HOSTING_PORT = String(firebasePort);

    try {
      await powertools.execute(`firebase serve --port ${firebasePort}`, {
        log: false,
        cwd: projectDir,
        config: {
          stdio: ['inherit', 'pipe', 'pipe'],
          env: firebaseEnv,
        },
      }, (child) => {
        child.stdout.on('data', (data) => {
          process.stdout.write(data);
          const text = data.toString();
          if (RELOAD_MARKER.test(text)) {
            reloadCount++;
            if (reloadCount > 1) {
              rollLog();
            }
          }
          writeToLog(data);
        });

        child.stderr.on('data', (data) => {
          process.stderr.write(data);
          writeToLog(data);
        });

        child.on('close', () => {
          clearInterval(resetWatcher);
          stageWatch.close();
          if (currentStream && !currentStream.destroyed) {
            currentStream.end();
          }
          try { fs.unlinkSync(resetSentinelPath); } catch (e) { /* ok */ }
          // Retract the published port map (clean shutdown)
          clearPortsFile(projectDir);
        });
      });
    } catch (error) {
      this.log(chalk.gray('\n  Server stopped.\n'));
    }
  }

  // The mechanism lives in @omega.js/devkit/local-https (shared with
  // `omega emulator` and web's `omega dev`): mkcert certs in .temp/certs
  // (staleness-checked), TLS proxy on the public port → plain-http target.
  async _startHttpsProxy(httpsPort, httpPort, projectDir) {
    const { ensureLocalHttpsCerts, startLocalHttpsProxy } = require('@omega.js/devkit/local-https');

    const certs = await ensureLocalHttpsCerts({
      certsDir: path.join(this.getTempPath(), 'certs'),
      log: (line) => this.log(chalk.gray(`  ${line}`)),
    });

    if (!certs) {
      this.log(chalk.yellow('  HTTPS disabled — could not obtain certificates.'));
      this.log(chalk.yellow('  Install mkcert for trusted local HTTPS: brew install mkcert && mkcert -install\n'));
      return false;
    }

    startLocalHttpsProxy({
      port: httpsPort,
      targetPort: httpPort,
      certs,
      log: (line) => this.log(chalk.green(`  ${line}`)),
    });

    return true;
  }
}

module.exports = ServeCommand;
