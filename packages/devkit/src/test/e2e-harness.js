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
 *   // ... the brand's cases drive the page ...
 *   await harness.teardown();
 *
 * A brand lane is a `defineCases` suite: `boot()` in its `setup`, `teardown()`
 * in its `cleanup`, and each check one case.
 */
const path = require('path');
const fs = require('fs');
const { readPortsFile, resolvePorts, CLASSIC_PORTS } = require('@omega.js/config');
const { findTarget } = require('../omega-bin.js');
const { startChild, stopChild } = require('./boot-child.js');
const { holdClassicPorts, releasePorts, CLASSIC_HOLD_PORTS } = require('./port-hold.js');
const { launchBrowser } = require('./browser.js');
const { targetOfType } = require('./target-of-type.js');

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
 * Run one boot leg, printing its detail; a failure rejects naming the leg.
 *
 * @param {string} name - The leg, as a reader would name it
 * @param {Function} fn - Resolves the leg's detail line
 * @returns {Promise<void>}
 */
async function bootLeg(name, fn) {
  let detail;
  try {
    detail = await fn();
  } catch (error) {
    throw new Error(`boot failed at "${name}": ${error.message}`, { cause: error });
  }
  console.log(`  ${name} (${detail})`);
}

/**
 * Discover the two target dirs this lane boots, by TYPE: a brand NAMES its
 * targets ([#886](https://github.com/Omega-JS-Stack/omega/issues/886)), so the
 * web leg is whichever name carries `type: 'web'`, never the literal folder a
 * template happened to scaffold.
 *
 * @param {string} brandRoot - The brand (repo) root
 * @returns {{ backend: string|null, web: string|null }} The paths that exist
 */
function discoverTargets(brandRoot) {
  const targets = { backend: null, web: null };

  for (const type of Object.keys(targets)) {
    const found = targetOfType(brandRoot, type);
    if (found) targets[type] = found.dir;
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

    this.hold = null;
    this.emulator = null;
    this.emulatorPorts = {};
    this.dev = null;
    this.browser = null;
    this.sitePort = null;
    this._siteUrl = null;
    this.pageConsole = [];
  }

  /**
   * Boot the full stack: hold the classic ports, start the emulator (with
   * persona seeding), then the website's real dev server. Ports self-allocate
   * (N7) past the held classics, and the emulator CLI publishes its resolved
   * map through the ports file. Rejects naming the leg that failed.
   */
  async boot() {
    await bootLeg('the classic ports are held so the stack boots beside a live dev', async () => {
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
      await bootLeg('emulator boots + personas seed (functions, firestore, auth, database, hosting, pubsub)', async () => {
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

    if (this.targets.web) {
      await bootLeg('the website serves through the REAL `omega dev`', async () => {
        resolveDevTarget(this.targets.web, this.brandRoot);

        this.dev = startChild({
          bin: resolveLocalBin('omega', this.targets.web),
          args: ['dev', `--port=${this.sitePort}`],
          cwd: this.targets.web,
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

  get siteUrl() {
    return this._siteUrl;
  }
}

module.exports = { E2eHarness, bootLeg, discoverTargets, resolveLocalBin, resolveDevTarget, EMULATOR_READY_MARKER, DEV_READY_MARKER };
