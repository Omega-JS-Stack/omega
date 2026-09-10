/**
 * The brand e2e harness — a brand's own browser lane, standing on its REAL
 * local stack ([#775](https://github.com/Omega-JS-Stack/omega/issues/775)).
 *
 * It boots what a developer boots: the backend emulator (persona seeding
 * included) and the website's real `omega dev`. Nothing static, nothing built.
 * That is the whole point of the rewrite: `omega build` is always a PRODUCTION
 * build, so a served build never connects to the emulator, and a lane driving
 * it proves a page nobody will ever load. Dev mode connects to the emulators
 * with zero flags, which is exactly the stack a brand's pages are written for.
 *
 * It owns its stack and never disturbs a live one: every CLASSIC port is HELD
 * for the run, so the N7 allocator in both children bumps past them onto fresh
 * ones. A classic port somebody else already holds is left alone, and the
 * allocator bumps around it just the same.
 *
 * Usage:
 *   const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');
 *   const harness = new E2eHarness(brandRoot);
 *   await harness.boot();
 *   const browser = await harness.launchBrowser();
 *   const page = await browser.newPage();
 *   await harness.preparePage(page);
 *   // ... brand-specific steps via harness.step() ...
 *   await harness.teardown();
 *   harness.exit();
 */
const path = require('path');
const fs = require('fs');
const { readPortsFile, resolvePorts, CLASSIC_PORTS } = require('@omega.js/config');
const { findTarget } = require('../omega-bin.js');
const { startChild, stopChild } = require('./boot-child.js');
const { holdClassicPorts, releasePorts, CLASSIC_HOLD_PORTS } = require('./port-hold.js');
const { launchBrowser } = require('./browser.js');
const { createStepsLog } = require('./steps-log.js');

// Covers emulator boot AND persona seeding (~55 accounts) — the ready marker
// fires after both.
const EMULATOR_READY_TIMEOUT = 300000;
const DEV_READY_TIMEOUT = 300000;

// The emulator marker is the CLI's post-seed line, NOT firebase-tools' "All
// emulators ready": persona seeding runs BETWEEN the two and STARTS with a
// full Firestore wipe + auth bulk-clear, so proceeding on the firebase line
// races the first browser step into that wipe window. The text lives in
// @omega.js/backend's emulator command (cli/commands/emulator.js) — change in
// lockstep. The dev marker carries the ORIGIN as its capture group, protocol
// included, because `omega dev` serves mkcert HTTPS by default.
const EMULATOR_READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;
const DEV_READY_MARKER = /Dev server: (https?:\/\/localhost:\d+)/;

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

/**
 * The local `node_modules/.bin/<name>`, by directory climb from `fromDir`.
 *
 * Spawned DIRECTLY rather than through npx: outside an npm-script PATH the npx
 * shim routes through the Socket Firewall proxy, whose proxy env breaks
 * firebase-tools' internal emulator REST calls.
 *
 * @param {string} name - Bin name ('mgr', 'omega')
 * @param {string} fromDir - Directory to climb from
 * @returns {string} The absolute bin path
 * @throws {Error} When no install above fromDir carries it
 */
function resolveLocalBin(name, fromDir) {
  let dir = path.resolve(fromDir);

  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`no node_modules/.bin/${name} above ${fromDir} — run npm install in the brand`);
    }
    dir = parent;
  }
}

/**
 * The website target's own framework, or a loud refusal.
 *
 * A dev server is the FRAMEWORK's, so the target must declare one. A target
 * that declares none has nothing to boot, and saying so by name beats
 * dispatching `dev` to whatever CLI the node_modules climb happens to find
 * (a brand root's manager, which would boot this whole stack a second time).
 *
 * @param {string} websiteDir - The website target directory
 * @param {string} [brandRoot] - Root the target is reported relative to
 * @returns {object} The findTarget result (kind: 'framework')
 * @throws {Error} When the target declares no web framework
 */
function resolveDevTarget(websiteDir, brandRoot) {
  const target = findTarget(websiteDir);
  if (!target || target.kind !== 'framework') {
    const shown = brandRoot ? path.relative(brandRoot, websiteDir) : websiteDir;
    throw new Error(
      `${shown} declares no web framework dependency, so there is no \`omega dev\` to boot `
      + '(its package.json must depend on @omega.js/web).',
    );
  }
  return target;
}

class E2eHarness {
  constructor(brandRoot, options) {
    options = options || {};
    this.brandRoot = brandRoot;
    this.targets = discoverTargets(brandRoot);
    this.logDir = options.logDir || path.join(brandRoot, 'test', 'e2e', '.logs');

    // Per-step verdicts on disk beside the environment logs (#197), same format
    // the journey harness and the root e2e runners write: the emulator/dev logs
    // say what the stack printed, this says which step broke. `grep '^FAIL'` it
    // after a run that died, or one read back hours later.
    this.stepsLog = createStepsLog(this.logDir);

    this.hold = null;
    this.emulator = null;
    this.emulatorPorts = {};
    this.dev = null;
    this.browser = null;
    this.sitePort = null;
    this._siteUrl = null;
    this.failures = [];
    this.pageConsole = [];
  }

  /**
   * Boot the full stack: hold the classic ports, start the emulator (with
   * persona seeding), then the website's real dev server. Ports self-allocate
   * (N7) past the held classics, and the emulator CLI publishes its resolved
   * map through the ports file.
   */
  async boot() {
    await this.step('the classic ports are held so the stack boots beside a live dev', async () => {
      this.hold = await holdClassicPorts();
      // The website port is allocated HERE because the emulator needs it at
      // BOOT time: the backend builds its checkout confirmation URLs from
      // OMEGA_WEBSITE_PORT, and it starts first.
      const { ports } = await resolvePorts({ wanted: { website: CLASSIC_PORTS.website } });
      this.sitePort = ports.website;
      const busy = this.hold.busy.length ? ` (busy, left alone: ${this.hold.busy.join(', ')})` : '';
      return `held ${this.hold.held.length}/${CLASSIC_HOLD_PORTS.length}${busy}; website :${this.sitePort}`;
    });

    // Boot the emulator (persona seeding happens inside `mgr emulator` by
    // default; the ready marker fires AFTER it, so steps never race the wipe)
    if (this.targets.backend) {
      await this.step('emulator boots + personas seed (functions, firestore, auth, database, hosting, pubsub)', async () => {
        this.emulator = startChild({
          bin: resolveLocalBin('mgr', this.targets.backend),
          args: ['emulator'],
          cwd: this.targets.backend,
          env: this.childEnv,
          logFile: path.join(this.logDir, 'emulator.log'),
          marker: EMULATOR_READY_MARKER,
          timeout: EMULATOR_READY_TIMEOUT,
          relativeTo: this.brandRoot,
        });
        await this.emulator.ready;
        // The CLI published where the emulators ACTUALLY landed — preparePage()
        // forwards this map to the browser so pages connect to THIS stack.
        this.emulatorPorts = readPortsFile(this.targets.backend) || {};
        const hosting = this.emulatorPorts.hosting ? `, hosting :${this.emulatorPorts.hosting}` : '';
        return `auth :${this.emulatorPorts.auth}${hosting}`;
      });
    }

    if (this.targets.website) {
      await this.step('the website serves through the REAL `omega dev`', async () => {
        resolveDevTarget(this.targets.website, this.brandRoot);

        this.dev = startChild({
          bin: resolveLocalBin('omega', this.targets.website),
          args: ['dev', `--port=${this.sitePort}`],
          cwd: this.targets.website,
          env: this.childEnv,
          logFile: path.join(this.logDir, 'dev.log'),
          marker: DEV_READY_MARKER,
          timeout: DEV_READY_TIMEOUT,
          relativeTo: this.brandRoot,
        });
        this._siteUrl = await this.dev.ready;
        return this._siteUrl;
      });
    }
  }

  /**
   * The environment both children inherit. The website port is resolved before
   * either boots, because the backend builds URLs from it and starts first.
   */
  get childEnv() {
    return { ...process.env, ...(this.sitePort ? { OMEGA_WEBSITE_PORT: String(this.sitePort) } : {}) };
  }

  /**
   * The lane's browser, resolved from the brand root (`@omega.js/manager`
   * carries puppeteer, so a brand installs nothing). Closed by teardown().
   *
   * @param {object} [options] - Forwarded to devkit's launcher
   * @returns {Promise<object>} The puppeteer browser
   */
  async launchBrowser(options) {
    this.browser = await launchBrowser({ from: this.brandRoot, ...(options || {}) });
    return this.browser;
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
   * That global is a FALLBACK, never an override (#300). A page served by a
   * real dev server carries the live map in its own chrome, and
   * @omega.js/client lets that baked chrome win — otherwise this side channel
   * (which no real browser has) would hide a broken real one, which is exactly
   * how bumped-port breakage stayed green through every e2e run. It stays
   * wired for the pages that carry no chrome of their own.
   * Call after boot() and before the first page.goto().
   */
  async preparePage(page) {
    this.capturePageConsole(page);
    await page.evaluateOnNewDocument((ports) => { window.__OMEGA_DEV_PORTS__ = ports; }, this.emulatorPorts);
  }

  /**
   * Tear down everything boot() started, newest first: the browser, the dev
   * server, the emulator, then the held ports.
   */
  async teardown() {
    // Write page console log unconditionally — an EMPTY page.log is itself
    // diagnostic signal ("the page produced no console output at all").
    fs.mkdirSync(this.logDir, { recursive: true });
    fs.writeFileSync(path.join(this.logDir, 'page.log'), `${this.pageConsole.join('\n')}\n`);

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    if (this.dev) {
      await stopChild(this.dev.child);
      this.dev = null;
    }

    if (this.emulator) {
      await stopChild(this.emulator.child);
      this.emulator = null;
    }

    if (this.hold) {
      releasePorts(this.hold.servers);
      this.hold = null;
    }
  }

  /**
   * Exit the process based on test results. Call after teardown.
   */
  exit() {
    if (this.failures.length) {
      // A failure a runner pushed itself (the deaths OUTSIDE step()) has no
      // verdict yet; abort() records it as `preflight` and no-ops when a step
      // already failed.
      this.stepsLog.abort(this.failures[this.failures.length - 1].error);
      console.log(`\n  ${this.failures.length} step(s) failed — logs: ${path.relative(this.brandRoot, this.logDir)}/\n`);
      process.exit(1);
    }
    console.log('\n  Cross-stack e2e PASSED\n');
  }

  get siteUrl() {
    return this._siteUrl;
  }
}

module.exports = { E2eHarness, discoverTargets, resolveLocalBin, resolveDevTarget, EMULATOR_READY_MARKER, DEV_READY_MARKER };
