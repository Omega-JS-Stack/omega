/**
 * Base class for all setup tests
 * Each test should extend this class and implement the `run()` method
 */
class BaseTest {
  constructor(context) {
    this.context = context;
    this.self = context.main;
  }

  /**
   * demo-* project ids are EMULATOR-ONLY by convention — checks that touch
   * live Firebase gate on this (there is no live project to reach).
   * @returns {boolean}
   */
  get isDemoProject() {
    return String(this.self.projectId || '').startsWith('demo-');
  }

  /**
   * `--offline` mode: the run may still READ live cloud state, but nothing may
   * MUTATE it. A check whose fix (or whose check itself) deploys/writes to the
   * brand's live project downgrades to a reported 'warn' instead of spawning
   * `firebase`/`gsutil` — scaffolding a fresh app must never rewrite production
   * infrastructure as a side effect ([#284](https://github.com/Omega-JS-Stack/omega/issues/284)).
   * @returns {boolean}
   */
  get isOffline() {
    return !!(this.self.argv || {}).offline;
  }

  /**
   * Re-stage functions/ from the authored tree. Fixes that write STAGED
   * INPUTS (the app manifest, .env, .nvmrc, service-account.json, config)
   * call this so the already-staged tree reflects the fix within the same
   * setup run — idempotent and cheap (src/dist pillar).
   */
  restage() {
    const { stageFunctions } = require('../../utils/stage-functions');
    stageFunctions({ projectDir: this.self.firebaseProjectPath });
  }

  /**
   * Reload the APP MANIFEST from disk into the SHARED in-memory object
   * (self.package === context.package — one object, every check reads it).
   * npm-driven fixes rewrite the file mid-run, so any fix that WRITES the
   * manifest must start from disk truth: writing the stale snapshot erases
   * the deps npm just added (cp195 journey catch — the project-scripts fix
   * clobbered the firebase-admin/functions installs, and the next setup's
   * re-install raced the monorepo watch and killed the boot).
   *
   * @returns {Object} The live manifest object (same identity as self.package)
   */
  readAppManifest() {
    const jetpack = require('fs-jetpack');
    const fresh = jetpack.read(`${this.self.firebaseProjectPath}/package.json`, 'json') || {};
    const target = this.self.package;
    for (const key of Object.keys(target)) {
      delete target[key];
    }
    Object.assign(target, fresh);
    return target;
  }

  /** Persist the app manifest (call after readAppManifest() + mutation). */
  writeAppManifest() {
    const jetpack = require('fs-jetpack');
    jetpack.write(`${this.self.firebaseProjectPath}/package.json`, JSON.stringify(this.self.package, null, 2));
  }

  /**
   * The npm install command a dependency fix runs, at the APP ROOT (runtime
   * deps live on the app manifest — src/dist pillar). `--ignore-scripts` is
   * load-bearing: in a file:-linked brand, a bare install re-runs the LINKED
   * framework's prepare inside the monorepo — re-staging framework dist
   * mid-run and racing the watch/running stacks (cp195 journey catch: the
   * race rmdir-killed @omega.js/backend's own dist). The packages these
   * fixes install are pre-built registry tarballs; no scripts are needed.
   *
   * @param {string} name - Package name
   * @param {string} [version] - Version suffix ('@^1.2.3'); '@latest' when omitted
   * @param {string} [type] - 'dev'/'--save-dev' for devDependencies
   * @returns {string} The full npm command
   */
  buildInstallCommand(name, version, type) {
    let v;
    if (name.indexOf('file:') > -1) {
      v = '';
    } else if (!version) {
      v = '@latest';
    } else {
      v = version;
    }

    const t = (type === 'dev' || type === '--save-dev') ? ' --save-dev' : '';

    return `npm i ${name}${v}${t} --ignore-scripts`;
  }

  /**
   * Install a package at the app root (via safeInstall/Socket Firewall) and
   * resync the shared in-memory manifest with what npm wrote.
   */
  async installPkg(name, version, type) {
    const { safeInstall } = require('../../utils/safe-install');
    const command = this.buildInstallCommand(name, version, type);

    console.log('Running ', command);
    await safeInstall(command, { log: true, config: { cwd: this.self.firebaseProjectPath } });

    this.readAppManifest();
  }

  /**
   * Override this method in each test
   * @returns {Promise<boolean>} True if test passes, false if it fails
   */
  async run() {
    throw new Error('Test must implement run() method');
  }

  /**
   * Override this method to provide a fix for failed tests
   * @returns {Promise<void>}
   */
  async fix() {
    throw new Error('No automatic fix available for this test');
  }

  /**
   * Override to provide warning details when run() returns 'warn'.
   * @returns {string[]}
   */
  getWarning() {
    return [];
  }

  /**
   * Get the test name (used for logging)
   * @returns {string}
   */
  getName() {
    return this.constructor.name.replace(/Test$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  }
}

module.exports = BaseTest;
