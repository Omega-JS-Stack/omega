/**
 * Generalized brand e2e harness — boots the real stack (emulator + website),
 * provides step/teardown primitives, and lets each brand author its own
 * browser-driven test steps. Puppeteer stays in the brand's devDeps.
 *
 * Usage:
 *   const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');
 *   const harness = new E2eHarness(brandRoot, { sitePort: 4600 });
 *   await harness.boot();
 *   // ... brand-specific puppeteer steps via harness.step() ...
 *   await harness.teardown();
 *   harness.exit();
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { resolvePorts, readPortsFile } = require('@omega.js/config');
const { createStepsLog } = require('./steps-log.js');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Covers emulator boot AND persona seeding (~55 accounts) — the ready marker
// fires after both (see _startEmulator's watch comment).
const EMULATOR_READY_TIMEOUT = 240000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Discover the brand's targets by directory naming convention.
 * Returns { backend, website } with the paths that exist.
 */
function discoverTargets(brandRoot) {
  const targetsDir = path.join(brandRoot, 'targets');
  const targets = { backend: null, website: null };

  if (!fs.existsSync(targetsDir)) {
    return targets;
  }

  for (const entry of fs.readdirSync(targetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name === 'backend') targets.backend = path.join(targetsDir, entry.name);
    if (entry.name === 'website') targets.website = path.join(targetsDir, entry.name);
  }

  return targets;
}

class E2eHarness {
  constructor(brandRoot, options) {
    options = options || {};
    this.brandRoot = brandRoot;
    this.sitePort = options.sitePort || 4600;
    this.targets = discoverTargets(brandRoot);
    this.logDir = options.logDir || path.join(brandRoot, 'e2e', '.logs');

    // Per-step verdicts on disk beside the environment logs (#197), same format
    // the journey harness and the root e2e runners write: the emulator/page logs
    // say what the stack printed, this says which step broke. `grep '^FAIL'` it
    // after a run that died, or one read back hours later.
    this.stepsLog = createStepsLog(this.logDir);

    this.emulator = null;
    this.emulatorPorts = {};
    this.siteServer = null;
    this.failures = [];
    this.pageConsole = [];
  }

  /**
   * Boot the full stack: build website, start emulator (with persona
   * seeding), serve the built site. Ports self-allocate (N7): the emulator
   * CLI bumps taken ports and publishes its resolved map via the ports file;
   * the site port bumps here. No pre-flight free-check needed.
   */
  async boot() {
    // Build website
    if (this.targets.website) {
      await this.step('website builds', async () => {
        const buildPath = path.join(this.targets.website, 'build.js');
        if (!fs.existsSync(buildPath)) {
          throw new Error(`No build.js found at ${buildPath}`);
        }
        await require(buildPath)();
      });
    }

    // Boot emulator (persona seeding happens inside `npx mgr emulator` by
    // default; the ready marker fires AFTER it, so steps never race the wipe)
    if (this.targets.backend) {
      await this.step('emulator boots + personas seed (functions, firestore, auth, database, hosting, pubsub)', async () => {
        this.emulator = this._startEmulator();
        await this.emulator.ready;
        // The CLI published where the emulators ACTUALLY landed (classic
        // defaults or bumped) — preparePage() forwards this map to the
        // browser so pages connect to THIS stack, never a neighbor's.
        this.emulatorPorts = readPortsFile(this.targets.backend) || {};
        const hosting = this.emulatorPorts.hosting ? `, hosting :${this.emulatorPorts.hosting}` : '';
        return `log: ${path.relative(this.brandRoot, path.join(this.logDir, 'emulator.log'))}${hosting}`;
      });
    }

    // Serve website
    if (this.targets.website) {
      await this.step('website serves', async () => {
        const { ports } = await resolvePorts({ wanted: { website: this.sitePort } });
        this.sitePort = ports.website;
        const distDir = path.join(this.targets.website, 'dist');
        this.siteServer = await this._startSiteServer(distDir);
        const body = await new Promise((resolve, reject) => {
          http.get(`http://localhost:${this.sitePort}/`, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => resolve(data));
          }).on('error', reject);
        });
        if (!body || body.length < 50) {
          throw new Error('served page is empty or suspiciously short');
        }
        return this.siteUrl;
      });
    }
  }

  /**
   * Run a named step with pass/fail logging. Throws on failure (caller
   * should wrap in try/catch if it wants to continue past failures). The
   * verdict lands in steps.log as it happens, so a SIGKILLed run still names
   * the step it died on.
   */
  async step(name, fn) {
    try {
      const detail = await fn();
      this.stepsLog.pass(name, detail);
      console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      this.failures.push({ name, error });
      this.stepsLog.fail(name, error);
      console.log(`  ✗ ${name}\n      ${error.message}`);
      throw error;
    }
  }

  /**
   * Hook a puppeteer page's console + error events into this.pageConsole.
   */
  capturePageConsole(page) {
    page.on('console', (message) => this.pageConsole.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => this.pageConsole.push(`[pageerror] ${error.message}`));
  }

  /**
   * Wire a puppeteer page into the harness: console capture + the resolved
   * emulator port map as `window.__OMEGA_DEV_PORTS__`.
   *
   * That global is a FALLBACK, not an override (#300). This harness serves a
   * STATIC build made before the emulator booted, so its pages carry no
   * `dev.ports` chrome at all and the injection is the only map they can get.
   * A page served by a real dev server carries the live map itself, and
   * @omega.js/client lets that baked chrome win — otherwise this side channel
   * (which no real browser has) would hide a broken real one, which is exactly
   * how bumped-port breakage stayed green through every e2e run.
   * Call after boot() and before the first page.goto().
   */
  async preparePage(page) {
    this.capturePageConsole(page);
    await page.evaluateOnNewDocument((ports) => { window.__OMEGA_DEV_PORTS__ = ports; }, this.emulatorPorts);
  }

  /**
   * Tear down all infrastructure started by boot().
   */
  async teardown() {
    // Write page console log unconditionally — an EMPTY page.log is itself
    // diagnostic signal ("the page produced no console output at all").
    fs.mkdirSync(this.logDir, { recursive: true });
    fs.writeFileSync(path.join(this.logDir, 'page.log'), `${this.pageConsole.join('\n')}\n`);

    if (this.siteServer) {
      this.siteServer.close();
      this.siteServer = null;
    }

    if (this.emulator) {
      await this._stopEmulator(this.emulator.child);
      this.emulator = null;
    }
  }

  /**
   * Exit the process based on test results. Call after teardown.
   */
  exit() {
    if (this.failures.length) {
      // A failure a runner pushed itself (puppeteer.launch, preparePage — the
      // deaths OUTSIDE step()) has no verdict yet; abort() records it as
      // `preflight` and no-ops when a step already failed.
      this.stepsLog.abort(this.failures[this.failures.length - 1].error);
      console.log(`\n  ${this.failures.length} step(s) failed — logs: ${path.relative(this.brandRoot, this.logDir)}/\n`);
      process.exit(1);
    }
    console.log('\n  Cross-stack e2e PASSED\n');
  }

  get siteUrl() {
    return `http://localhost:${this.sitePort}`;
  }

  // -- Internal helpers -------------------------------------------------------

  _startEmulator() {
    fs.mkdirSync(this.logDir, { recursive: true });
    const emulatorLog = path.join(this.logDir, 'emulator.log');
    const logStream = fs.createWriteStream(emulatorLog);

    // Backend commands run from the TARGET ROOT (src/dist pillar) — the CLI
    // stages dist/ itself before booting the emulator.
    const child = spawn('npx', ['mgr', 'emulator'], {
      cwd: this.targets.backend,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`emulator not ready after ${EMULATOR_READY_TIMEOUT / 1000}s (log: ${emulatorLog})`));
      }, EMULATOR_READY_TIMEOUT);

      const watch = (chunk) => {
        const text = chunk.toString();
        logStream.write(text);
        // Wait for the CLI's post-seed marker, NOT firebase-tools' "All
        // emulators ready" — persona seeding runs BETWEEN the two and STARTS
        // with a full Firestore wipe + auth bulk-clear. Proceeding on the
        // firebase line races browser steps (e.g. signup) into that wipe
        // window. The marker text lives in @omega.js/backend's emulator
        // command (cli/commands/emulator.js) — change in lockstep.
        if (/Emulator ready\. Press Ctrl\+C/i.test(text)) {
          clearTimeout(timer);
          resolve();
        }
      };

      child.stdout.on('data', watch);
      child.stderr.on('data', watch);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`emulator exited early (code ${code}, log: ${emulatorLog})`));
      });
    });

    return { child, ready };
  }

  async _stopEmulator(child) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try { process.kill(-child.pid, 'SIGINT'); } catch (e) { return; }
    const result = await Promise.race([exited.then(() => 'clean'), sleep(20000)]);
    if (result !== 'clean') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
    }
  }

  _startSiteServer(distDir) {
    const server = http.createServer((request, response) => {
      const urlPath = new URL(request.url, `http://localhost:${this.sitePort}`).pathname;
      const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const filePath = path.normalize(path.join(distDir, relative));

      if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(response);
    });

    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.sitePort, () => resolve(server));
    });
  }
}

module.exports = { E2eHarness, discoverTargets };
