const BaseCommand = require('./base-command');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const { loadEmulatorPorts } = require('./setup-tests/emulator-config');
const { readPortsFile, portsToEnv } = require('@omega.js/config');
const { writeTestMode, captureSyncedEnv, SYNCED_ENV_KEYS } = require('../../test/utils/test-mode-file');
const EmulatorCommand = require('./emulator');
// The rules SCHEMA version — setup.js owns it, this is the second generator.
const { RULES_VERSION } = require('./setup');

// The Firebase emulator hub — fixed, not part of the N7-allocated map.
const HUB_PORT = 4400;

// Where a running hub publishes WHO it is: firebase-tools writes
// `${os.tmpdir()}/hub-<projectId>.json` ({version, origins, pid}) for the life
// of the stack. The file name IS the identity — the hub's own
// `GET /emulators` answers a map of emulator → listen info and has never
// carried a project id, so the read that asked it for one always came back
// empty ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)).
const HUB_LOCATOR_PREFIX = 'hub-';
const HUB_LOCATOR_SUFFIX = '.json';

/**
 * Does a process with this pid exist right now?
 *
 * Signal 0 checks for existence without delivering anything. EPERM means it
 * exists and belongs to another user — still alive, which is the question.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * The project id of the emulator whose HUB is listening on `hubPort`, read
 * from the locator files firebase-tools publishes.
 *
 * A locator only counts when it claims THIS port and its pid is still alive —
 * firebase-tools does not always remove the file, so a crashed run's leftover
 * would otherwise name a hub that is long gone. Two live claims on one port
 * mean one of them is a stale file whose pid got recycled, and nothing says
 * which: ambiguous reads as unproven, the same safe fall-through as no file at
 * all ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)).
 * @param {number} hubPort - The hub port to identify.
 * @param {string} [tmpDir] - Where locators live (defaults to os.tmpdir()).
 * @returns {string|null} The project id, or null when unproven.
 */
function readHubLocatorProjectId(hubPort, tmpDir) {
  const dir = tmpDir || os.tmpdir();
  const claimants = new Set();

  for (const name of jetpack.list(dir) || []) {
    if (!name.startsWith(HUB_LOCATOR_PREFIX) || !name.endsWith(HUB_LOCATOR_SUFFIX)) {
      continue;
    }

    const projectId = name.slice(HUB_LOCATOR_PREFIX.length, -HUB_LOCATOR_SUFFIX.length);
    if (!projectId) {
      continue;
    }

    let locator;
    try {
      locator = jetpack.read(path.join(dir, name), 'json');
    } catch (error) {
      continue; // Not a locator, or half-written
    }

    const onThisPort = (locator?.origins || []).some((origin) => {
      try {
        return Number(new URL(origin).port) === Number(hubPort);
      } catch (error) {
        return false;
      }
    });

    if (onThisPort && isProcessAlive(Number(locator.pid))) {
      claimants.add(projectId);
    }
  }

  return claimants.size === 1 ? [...claimants][0] : null;
}

/**
 * Adopt the emulator already listening on our functions port, or allocate
 * fresh ports and boot our own?
 *
 * A bare port probe answered "something is listening", which the run read as
 * "our emulator is up" — so another brand's stack on the classic ports got
 * adopted and the run died on a health fetch against the wrong project
 * ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)). Adoption now
 * needs PROOF of identity: unproven falls through to the N7 bump path, which
 * relocates around the incumbent exactly as a second brand's boot does.
 * @param {object} evidence
 * @param {boolean} evidence.portInUse - Something is listening on the functions port.
 * @param {boolean} [evidence.ownsPortsFile] - This project's own live ports file publishes that port.
 * @param {string|null} evidence.runningProjectId - Project id the listener reports (null when unreadable).
 * @param {string|null} evidence.expectedProjectId - Project id this run belongs to.
 * @returns {{adopt: boolean, reason: string, runningProjectId: string|null}}
 */
function decideEmulatorAdoption({ portInUse, ownsPortsFile, runningProjectId, expectedProjectId }) {
  const decision = { adopt: false, reason: 'no-emulator', runningProjectId: runningProjectId || null };

  if (!portInUse) {
    return decision;
  }

  // This project's .temp/ports.json, written by OUR emulator and read only
  // while its writer is alive. The hub is NOT allocated by N7, so a bumped run
  // shares it with whoever booted first — this is the proof that still holds.
  if (ownsPortsFile) {
    return { ...decision, adopt: true, reason: 'ports-file' };
  }

  if (!runningProjectId || !expectedProjectId) {
    return { ...decision, reason: 'unidentified' };
  }

  if (runningProjectId !== expectedProjectId) {
    return { ...decision, reason: 'project-mismatch' };
  }

  return { ...decision, adopt: true, reason: 'project-match' };
}

class TestCommand extends BaseCommand {
  async execute() {
    const self = this.main;
    const argv = self.argv;

    // Tee THIS process to <appRoot>/logs/test.log (#197) — the setup lines, the
    // port summary and the emulator boot that the runner-child's dist/test.log
    // never sees.
    this.attachVerbLog('test');

    // `--extended` CLI shorthand for the shared, unprefixed TEST_EXTENDED_MODE
    // env var (cross-framework parity with BXM/UJM/EM). Either the flag OR the
    // env var opts into REAL external services (default skipped). Set this
    // BEFORE the captureSyncedEnv/writeTestMode pre-flight below so the flag
    // flows into the emulator's test-mode.json too — making
    // `npx omega test --extended` equivalent to `TEST_EXTENDED_MODE=true npx omega test`.
    if (argv.extended) {
      process.env.TEST_EXTENDED_MODE = 'true';
    }

    // Framework self-test: when `npx omega test` is run from the @omega.js/backend repo
    // (no firebase.json in cwd), boot the bundled fixture project under
    // src/test/fixtures/firebase-project. Mirrors BXM/UJM *_TEST_BOOT_PROJECT.
    const isSelfTest = this.setupSelfTest();

    // functions/ is staged output (src/dist pillar): stage fresh so the run
    // reads current src + composed config. The auto-start emulator path stages
    // again inside startEmulators — idempotent and cheap; THIS call covers the
    // existing-emulator path, where nothing else would refresh the tree.
    this.ensureStaged();

    // Get test paths from CLI args (e.g., "bem test admin/" or "bem test general/generate-uuid")
    const testPaths = (argv._ || []).slice(1); // Remove 'test' from args

    // On self-test with no explicit target, run only the boot smoke suite —
    // the fast inner loop. The FULL suite also passes against the fixture
    // (`npm test -- backend:`): it carries corpus-parity payment config and
    // boot-syncs the canonical rules for exactly that.
    if (isSelfTest && testPaths.length === 0) {
      testPaths.push('backend:boot');
    }

    // Determine the project directory
    const projectDir = self.firebaseProjectPath;
    const functionsDir = path.join(projectDir, 'dist');

    // Pre-flight: write the allowlisted env subset to a shared state file
    // (`<projectDir>/.temp/test-mode.json`). The running emulator watches this
    // file and mutates its own `process.env` to match, eliminating the need
    // to coordinate env vars across both terminals. The test command is the
    // authoritative writer — whatever you pass here becomes the live mode
    // within ~50ms.
    //
    // Allowlist lives in src/test/utils/test-mode-file.js (SYNCED_ENV_KEYS).
    // Today: just TEST_EXTENDED_MODE. Add more keys there to make them
    // live-syncable.
    {
      const envSubset = captureSyncedEnv(process.env);
      writeTestMode(projectDir, envSubset);
      const extended = !!process.env.TEST_EXTENDED_MODE;
      this.log(chalk.gray(`  Test mode: ${extended ? 'extended (real external APIs)' : 'normal (external APIs skipped)'}`));
    }

    // N7: a RUNNING emulator's published port map wins — it may have bumped
    // off the firebase.json values (second-brand boot). No live map →
    // firebase.json/classic (and the auto-start path re-resolves after boot).
    let emulatorPorts = loadEmulatorPorts(projectDir);
    const publishedPorts = readPortsFile(projectDir);
    if (publishedPorts) {
      emulatorPorts = { ...emulatorPorts, ...publishedPorts };
    }

    // Load project configuration
    const projectConfig = this.loadProjectConfig(functionsDir, argv);
    if (!projectConfig) {
      // Config-validation abort must fail the process — a bare return exits 0
      // and reads as a green run to any script chaining on the exit code.
      process.exitCode = 1;
      return;
    }

    // Build unified test config object
    // Use hosting URL for all API requests (rewrites to omega_api function)
    const testConfig = {
      ...projectConfig,
      apiUrl: `http://127.0.0.1:${emulatorPorts.hosting}`,
      projectDir,
      testPaths,
      emulatorPorts,
      isFrameworkSelfTest: isSelfTest, // gates the boot/ smoke layer (excluded for consumers)
    };

    // Adopt the running emulator only when it PROVES it is ours — a listener on
    // the functions port is not evidence of ownership
    // ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)).
    const portInUse = await this.isEmulatorRunning(emulatorPorts);
    const adoption = decideEmulatorAdoption({
      portInUse: portInUse,
      ownsPortsFile: !!publishedPorts && publishedPorts.functions === emulatorPorts.functions,
      runningProjectId: portInUse ? this.readRunningProjectId(emulatorPorts) : null,
      expectedProjectId: projectConfig.cloud?.config?.projectId || null,
    });

    if (adoption.adopt) {
      this.log(chalk.cyan('Running tests against EXISTING emulator'));
      await this.runTestsDirectly(this.buildTestCommand(testConfig), functionsDir, emulatorPorts);
    } else {
      if (adoption.reason === 'project-mismatch') {
        this.log(chalk.yellow(`  Port ${emulatorPorts.functions} belongs to project "${adoption.runningProjectId}", not "${projectConfig.cloud?.config?.projectId}" — booting this project's own emulator on free ports.`));
      } else if (adoption.reason === 'unidentified') {
        this.log(chalk.yellow(`  Port ${emulatorPorts.functions} is in use by a listener that does not identify itself — booting this project's own emulator on free ports.`));
      }

      this.log(chalk.cyan('Starting emulator and running tests...'));
      // The command is built INSIDE runEmulatorTests, after boot — allocation
      // may bump ports, and a pre-built command would bake the stale ones.
      await this.runEmulatorTests(testConfig, functionsDir);
    }
  }

  /**
   * Load project configuration from config/omega.json5 and .env
   */
  loadProjectConfig(functionsDir, argv) {
    const { hasOmegaConfig, loadConfig, loadEnv } = require('@omega.js/config');

    // Load the .env cascade first so env vars are available
    loadEnv(functionsDir);

    // Load config/omega.json5 (resolved — the loader walks up to the brand
    // layer from the functions dir in a brand monorepo)
    if (!hasOmegaConfig(functionsDir)) {
      this.logError('Error: Missing config/omega.json5');
      return null;
    }

    let config;
    try {
      config = loadConfig(functionsDir, 'backend').config;
    } catch (error) {
      this.logError(`Error: Could not load config/omega.json5: ${error.message}`);
      return null;
    }

    // Derive computed values (not in config file)
    const adminKey = argv.key || process.env.OMEGA_ADMIN_KEY;
    const webhookKey = argv.webhookKey || process.env.OMEGA_WEBHOOK_KEY;
    const contactEmail = config.brand?.contact?.email || '';
    const domain = contactEmail.includes('@') ? contactEmail.split('@')[1] : '';

    // Validate required configuration
    if (!config.cloud?.config?.projectId) {
      this.logError('Error: Missing cloud.config.projectId in config/omega.json5');
      return null;
    }

    if (!adminKey) {
      this.logError('Error: Missing admin key');
      this.log(chalk.gray('  Set OMEGA_ADMIN_KEY in your .env file or pass --key flag'));
      return null;
    }

    if (!webhookKey) {
      this.logError('Error: Missing webhook key');
      this.log(chalk.gray('  Set OMEGA_WEBHOOK_KEY in your .env file or pass --webhook-key flag'));
      return null;
    }

    if (!config.brand?.id) {
      this.logError('Error: Missing brand.id in config/omega.json5');
      return null;
    }

    if (!domain) {
      this.logError('Error: Missing brand.contact.email in config/omega.json5');
      return null;
    }

    // Pass entire config + computed values not in config file
    return {
      ...config,
      adminKey,
      webhookKey,
      domain,
    };
  }

  /**
   * Build the test command with environment variables
   */
  /**
   * Framework self-test detection + fixture wiring.
   *
   * When `npx omega test` runs from a directory that is NOT a Firebase project
   * (no firebase.json) AND is the @omega.js/backend repo (or OMEGA_TEST_BOOT_PROJECT
   * is set), point the run at the bundled fixture project and link the local
   * framework + firebase deps into it so the emulator's function workers resolve
   * them. This is @omega.js/backend's equivalent of BXM's OMEGA_TEST_BOOT_PROJECT / UJM's
   * UJ_TEST_BOOT_PROJECT. Returns true if self-test wiring was applied.
   */
  setupSelfTest() {
    const self = this.main;

    // Normal consumer run — cwd is already a Firebase project. Nothing to do.
    if (jetpack.exists(path.join(self.firebaseProjectPath, 'firebase.json'))) {
      return false;
    }

    // Self-test if OMEGA_TEST_BOOT_PROJECT is set, or cwd is the @omega.js/backend repo.
    let isSelfTest = !!process.env.OMEGA_TEST_BOOT_PROJECT;
    if (!isSelfTest) {
      try {
        isSelfTest = require(path.join(process.cwd(), 'package.json')).name === '@omega.js/backend';
      } catch (_) { /* no package.json — not a self-test */ }
    }
    if (!isSelfTest) {
      return false;
    }

    const fixture = process.env.OMEGA_TEST_BOOT_PROJECT
      ? path.resolve(process.env.OMEGA_TEST_BOOT_PROJECT)
      : path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'firebase-project');

    process.env.OMEGA_TEST_BOOT_PROJECT = fixture;
    self.firebaseProjectPath = fixture;

    // The test HTTP client authenticates with the fixture's admin keys (the
    // server reads the same keys from config/omega.json5). Inject them from
    // the fixture config so loadProjectConfig finds them — no committed .env
    // needed (single source = the fixture config). The namespace rides the
    // same mechanism: the uuid route's v5 default reads OMEGA_NAMESPACE in
    // the emulated functions, which inherit this process env.
    try {
      const cfg = require('@omega.js/config').loadConfig(fixture, 'backend').config;
      process.env.OMEGA_ADMIN_KEY = process.env.OMEGA_ADMIN_KEY || cfg.omega?.key;
      process.env.OMEGA_WEBHOOK_KEY = process.env.OMEGA_WEBHOOK_KEY || cfg.omega?.webhookKey;
      process.env.OMEGA_NAMESPACE = process.env.OMEGA_NAMESPACE || cfg.omega?.namespace;
    } catch (_) { /* fixture config unreadable — let the normal key check report it */ }

    // Anonymous HMAC unsubscribe tests sign links with this shared secret; the
    // emulated functions inherit it from this process env (same mechanism as the
    // webhook key above). Test-only value — production sets its own env var.
    process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || '_test-unsubscribe-hmac-key';

    this.ensureFixtureServiceAccount(fixture);
    this.ensureFixtureRules(fixture);
    this.linkFixtureDeps(fixture);
    this.log(chalk.cyan(`  Self-test: booting bundled fixture project (${fixture})`));
    return true;
  }

  /**
   * Write a throwaway service-account.json into the fixture so firebase-admin's
   * `cert()` can parse it. @omega.js/backend's manager uses the cert path when
   * GOOGLE_APPLICATION_CREDENTIALS is unset (as in the functions emulator). The
   * key is a freshly-generated RSA key — emulator-only, never authenticates
   * against Google (the project is a `demo-` project), so it is generated at
   * runtime and gitignored, never committed. Written to the APP ROOT (the
   * authored home under the src/dist pillar) — the stage step carries it into
   * functions/.
   */
  ensureFixtureServiceAccount(fixture) {
    const crypto = require('crypto');
    const saPath = path.join(fixture, 'service-account.json');
    const projectId = 'demo-omega-backend';
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const serviceAccount = {
      type: 'service_account',
      project_id: projectId,
      private_key_id: '0'.repeat(40),
      private_key: privateKey,
      client_email: `fixture@${projectId}.iam.gserviceaccount.com`,
      client_id: '0'.repeat(21),
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/fixture%40${projectId}.iam.gserviceaccount.com`,
    };
    try {
      fs.writeFileSync(saPath, `${JSON.stringify(serviceAccount, null, 2)}\n`);
    } catch (e) {
      this.logWarning(`Could not write fixture service-account.json: ${e.message}`);
    }
  }

  /**
   * Stage the framework's canonical firestore.rules into the fixture — the
   * SAME template `omega setup` ships to consumers (templates/firestore.rules,
   * marker version stamped), so the rules suite exercises the real ruleset.
   * Runtime-derived and gitignored like the service account: the fixture
   * commits no rules copy that could drift from the template. A running
   * emulator hot-reloads the file, so re-writing it every run is safe.
   */
  ensureFixtureRules(fixture) {
    const template = jetpack.read(path.resolve(__dirname, '..', '..', '..', 'templates', 'firestore.rules'));
    jetpack.write(path.join(fixture, 'firestore.rules'), template.replace('(v0.0.0)', `(v${RULES_VERSION})`));
  }

  /**
   * Symlink the local framework + firebase deps into the fixture's APP-ROOT
   * node_modules so the emulator's function workers can resolve them — Node
   * resolution walks up from the staged functions/ tree (which carries no
   * node_modules of its own under the src/dist pillar). Mirrors what
   * `npx omega install dev` does in a real consumer, but for the fixture and
   * without an npm install (firebase-admin/firebase-functions come from
   * @omega.js/backend's own node_modules; @omega.js/backend points at the repo root).
   */
  linkFixtureDeps(fixture) {
    const fnNodeModules = path.join(fixture, 'node_modules');
    jetpack.dir(fnNodeModules);

    const frameworkRoot = path.resolve(__dirname, '..', '..', '..'); // src/cli/commands -> repo root
    const links = {
      '@omega.js/backend': frameworkRoot,
      'firebase-admin': path.join(frameworkRoot, 'node_modules', 'firebase-admin'),
      'firebase-functions': path.join(frameworkRoot, 'node_modules', 'firebase-functions'),
    };

    for (const [name, target] of Object.entries(links)) {
      const linkPath = path.join(fnNodeModules, name);
      try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch (_) { /* nothing to remove */ }
      try {
        // The link's PARENT, not just node_modules — a scoped name like
        // @omega.js/backend needs its node_modules/@omega.js dir to exist first
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e) {
        this.logWarning(`Could not link ${name} into fixture: ${e.message}`);
      }
    }
  }

  buildTestCommand(testConfig) {
    const testScriptPath = path.join(__dirname, '..', '..', 'test', 'run-tests.js');

    // The RESOLVED port map, minus the TLS front. The runner loads route
    // handlers IN-PROCESS, so its Manager's URL getters answer from
    // OMEGA_*_PORT the same way a function worker's do — unset, they fell back
    // to the classic 5002, which under `omega emulator`'s HTTPS default is the
    // mkcert proxy, not hosting: the test processor's auto-webhook followed the
    // proxy's 307 to https and died on a cert this process has no CA for
    // ([#291](https://github.com/Omega-JS-Stack/omega/issues/291)). `https` is
    // deliberately dropped — the runner is a plain-http client of the stack
    // (its own apiUrl already is), so it gets hosting's internal port.
    const { https: _tlsFront, ...plainHttpPorts } = testConfig.emulatorPorts;

    // Pass entire config as base64-encoded JSON to avoid shell escaping issues
    const testEnv = {
      ...portsToEnv(plainHttpPorts),
      OMEGA_TEST_CONFIG: Buffer.from(JSON.stringify(testConfig)).toString('base64'),
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${testConfig.emulatorPorts.firestore}`,
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${testConfig.emulatorPorts.auth}`,
      // The project the emulator booted with — resolved from the same config
      // the emulator command boots on (loadProjectConfig hard-fails without it).
      // The runner's admin app and the wipe's auth bulk-clear both read it, and
      // the wipe's URL names a project the emulator answers 200 for whether it
      // knows it or not: without this the wipe cleared a project nothing in the
      // run ever touched and reported success
      // ([#292](https://github.com/Omega-JS-Stack/omega/issues/292)).
      GCLOUD_PROJECT: testConfig.cloud.config.projectId,
      // GCLOUD_PROJECT alone makes the child's init-time environment read as
      // production (nothing else marks it yet: runner.js stamps its own
      // OMEGA_TEST_MODE only later, inside run()), which wakes the
      // firebase-functions logger compat shim and turns every test line into
      // JSON. Say what this process IS before Manager.init() looks.
      OMEGA_TEST_MODE: 'true',
    };

    const envString = Object.entries(testEnv)
      .map(([key, value]) => `${key}='${value}'`)
      .join(' ');

    return `${envString} node "${testScriptPath}"`;
  }

  /**
   * Check if emulator is already running
   * @param {object} emulatorPorts - The port map this run expects.
   * @returns {Promise<boolean>}
   */
  isEmulatorRunning(emulatorPorts) {
    // Check if functions emulator port is in use
    // If it is, assume emulator is running
    return this.isPortInUse(emulatorPorts.functions);
  }

  /**
   * The project id the emulator listening on our ports belongs to, read from
   * the hub locator firebase-tools publishes for a running stack. Anything
   * unproven (no locator, a dead pid, two live claims) comes back null, which
   * the decision above treats as "unidentified", never as "ours".
   * @param {object} emulatorPorts - The resolved port map.
   * @returns {string|null} The running emulator's project id.
   */
  readRunningProjectId(emulatorPorts) {
    return readHubLocatorProjectId(emulatorPorts?.hub || HUB_PORT);
  }

  /**
   * Signal the running emulator process to roll emulator.log.
   *
   * Mechanism: write a sentinel file at emulator.log.reset. The emulator command
   * (src/cli/commands/emulator.js) polls for it and, on detection, closes its
   * current write stream and reopens with flags: 'w' (truncating cleanly from its
   * own perspective — avoids the sparse-file problem caused by external truncation).
   *
   * Waits up to 2s for the sentinel to be consumed. If it's still there after 2s
   * the emulator isn't watching (probably running an older @omega.js/backend or started outside
   * `npx omega emulator`); we delete the sentinel and proceed — tests still run, the
   * log just won't be reset for this run.
   */
  async requestEmulatorLogReset(projectDir) {
    const sentinelPath = this.getTempPath('emulator.log.reset');

    try {
      fs.writeFileSync(sentinelPath, '');
    } catch (e) {
      return; // Can't write — skip, not fatal
    }

    // Poll for the emulator to consume the sentinel (it deletes the file when done)
    const maxWaitMs = 2000;
    const pollIntervalMs = 100;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (!fs.existsSync(sentinelPath)) {
        return; // Emulator picked it up and rolled the log
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timed out — emulator didn't see the sentinel. Clean up so we don't leave it behind.
    try { fs.unlinkSync(sentinelPath); } catch (e) { /* ok */ }
  }

  /**
   * Run tests directly (emulator already running)
   */
  async runTestsDirectly(testCommand, functionsDir, emulatorPorts) {
    const projectDir = this.main.firebaseProjectPath;

    // Ask the running emulator process to roll emulator.log so this test run gets a
    // clean slate. We touch a sentinel file the emulator polls for (every ~500ms) and
    // wait briefly for it to be consumed. If the emulator isn't watching (older @omega.js/backend
    // version, or not started via `npx omega emulator`), we time out silently — the log
    // just won't be fresh, tests still run normally.
    await this.requestEmulatorLogReset(projectDir);

    this.log(chalk.gray(`  Hosting: http://127.0.0.1:${emulatorPorts.hosting}`));
    this.log(chalk.gray(`  Firestore: 127.0.0.1:${emulatorPorts.firestore}`));
    this.log(chalk.gray(`  Auth: 127.0.0.1:${emulatorPorts.auth}`));
    this.log(chalk.gray(`  UI: http://127.0.0.1:${emulatorPorts.ui}`));

    // Set up log file in the project's functions/ directory (alongside firebase-tools logs)
    const logPath = this.getLogsPath('test.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    this.log(chalk.gray(`  Logs saving to: ${logPath}\n`));

    try {
      await powertools.execute(testCommand, {
        log: false,
        cwd: functionsDir,
        config: {
          stdio: ['inherit', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '1' },
        },
      }, (child) => {
        // Tee stdout to both console and log file (strip ANSI codes for clean log)
        child.stdout.on('data', (data) => {
          process.stdout.write(data);
          logStream.write(stripAnsi(data.toString()));
        });

        // Tee stderr to both console and log file (strip ANSI codes for clean log)
        child.stderr.on('data', (data) => {
          process.stderr.write(data);
          logStream.write(stripAnsi(data.toString()));
        });

        // Clean up log stream when child exits
        child.on('close', () => {
          logStream.end();
        });
      });
    } catch (error) {
      process.exit(1);
    }
  }

  /**
   * Run tests with Firebase emulator (starts emulator, runs tests, shuts down).
   *
   * Two real child processes are used so emulator output and test-runner output
   * land in separate log files:
   *   - `emulator.log` — `firebase emulators:start` stdout/stderr (managed by EmulatorCommand)
   *   - `test.log`     — the test-runner subprocess stdout/stderr (managed here)
   */
  async runEmulatorTests(testConfig, functionsDir) {
    try {
      await powertools.execute('java -version', { log: false });
    } catch (e) {
      this.logError(`Java is required to run tests (Firebase emulators depend on it).`);
      this.logError(`Install with: brew install openjdk`);
      process.exit(1);
    }

    this.log(chalk.gray('  Starting Firebase emulator...\n'));

    const emulatorCmd = new EmulatorCommand(this.main);
    let started;

    try {
      started = await emulatorCmd.startEmulators();
    } catch (error) {
      this.logError(`Emulator error: ${error.message || error}`);
      process.exit(1);
    }

    const { shutdown, exitPromise, emulatorPorts } = started;

    // Build the test command from the RESOLVED ports — allocation may have
    // bumped them off the firebase.json values testConfig was seeded with.
    const testCommand = this.buildTestCommand({
      ...testConfig,
      apiUrl: `http://127.0.0.1:${emulatorPorts.hosting}`,
      emulatorPorts,
    });

    // Forward Ctrl+C to a clean emulator shutdown
    const onSigint = async () => {
      this.log(chalk.gray('\n  Shutting down emulator...'));
      await shutdown();
      process.exit(130);
    };
    process.once('SIGINT', onSigint);

    // Print the same connection summary the existing-emulator path shows
    this.log('');
    this.log(chalk.gray(`  Hosting: http://127.0.0.1:${emulatorPorts.hosting}`));
    this.log(chalk.gray(`  Firestore: 127.0.0.1:${emulatorPorts.firestore}`));
    this.log(chalk.gray(`  Auth: 127.0.0.1:${emulatorPorts.auth}`));
    this.log(chalk.gray(`  UI: http://127.0.0.1:${emulatorPorts.ui}`));

    // Spawn the test runner as its own child so its stdout/stderr can be teed to test.log
    const logPath = this.getLogsPath('test.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    this.log(chalk.gray(`  Logs saving to: ${logPath}\n`));

    let testExitCode = 0;

    try {
      const testChild = spawn('sh', ['-c', testCommand], {
        cwd: functionsDir,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      testChild.stdout.on('data', (data) => {
        process.stdout.write(data);
        if (!logStream.destroyed) logStream.write(stripAnsi(data.toString()));
      });

      testChild.stderr.on('data', (data) => {
        process.stderr.write(data);
        if (!logStream.destroyed) logStream.write(stripAnsi(data.toString()));
      });

      testExitCode = await new Promise((resolve) => {
        testChild.on('close', (code) => {
          if (!logStream.destroyed) logStream.end();
          resolve(code ?? 1);
        });
      });
    } catch (error) {
      this.logError(`Test runner error: ${error.message || error}`);
      testExitCode = 1;
    } finally {
      process.removeListener('SIGINT', onSigint);
      await shutdown();
      await exitPromise;
    }

    process.exit(testExitCode);
  }
}

// Static, alongside Middleware's precedent — the adopt-or-bump decision is
// pure, so tests exercise it directly instead of through a booted emulator, and
// the identity read takes a tmp dir so real locator files can stand in for a
// running hub.
TestCommand.decideEmulatorAdoption = decideEmulatorAdoption;
TestCommand.readHubLocatorProjectId = readHubLocatorProjectId;

module.exports = TestCommand;
