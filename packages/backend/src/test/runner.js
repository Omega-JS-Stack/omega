const os = require('os');
const path = require('path');
const Module = require('module');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const HttpClient = require('./utils/http-client.js');
const assertions = require('./utils/assertions.js');
const { seed } = require('./seed.js');
const rulesClient = require('./utils/firestore-rules-client.js');
const { EXTENDED_MODE_WARNING } = require('./utils/extended-mode-warning.js');
const { SkipError } = require('@omega.js/devkit/test/runner-core');
const { parseTestScope, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');

/**
 * @omega.js/backend Integration Test Runner
 * Supports standalone tests and test suites with sequential tests and shared state
 */
class TestRunner {
  constructor(options) {
    options = options || {};

    // Store config directly, only add defaults for truly optional fields
    this.config = {
      ...options,
      bemDir: options.bemDir || path.resolve(__dirname, '..'),
      timeout: options.timeout || 30000,
    };

    // Alias for backwards compatibility
    this.options = this.config;

    this.rulesContext = null;

    this.accounts = null;
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      aborted: false, // pre-flight abort (config/health/accounts) — must exit non-zero
      tests: [],
      startTime: null,
      endTime: null,
    };
  }

  /**
   * Main run method
   */
  async run() {
    // Abort if @omega.js/backend is running from the user's home directory (e.g., accidental ~/node_modules install)
    const homeDir = os.homedir();
    if (__dirname.startsWith(path.join(homeDir, 'node_modules'))) {
      console.error(chalk.red('\n  ERROR: @omega.js/backend is running from ~/node_modules (home directory install).'));
      console.error(chalk.red('  This is likely an accidental global install that shadows local project copies.'));
      console.error(chalk.red(`  Fix: rm -rf ${path.join(homeDir, 'node_modules')} ${path.join(homeDir, 'package.json')} ${path.join(homeDir, 'package-lock.json')}`));
      console.error(chalk.red(`  Running from: ${__dirname}\n`));
      process.exit(1);
    }

    // Set testing flag to skip external API calls (emails, SendGrid)
    process.env.OMEGA_TEST_MODE = 'true';

    this.results.startTime = Date.now();

    console.log(chalk.bold('\n  @omega.js/backend Integration Tests\n'));

    // Warn if TEST_EXTENDED_MODE is enabled
    if (process.env.TEST_EXTENDED_MODE) {
      console.log(chalk.yellow.bold(`  ${EXTENDED_MODE_WARNING[0]}`));
      EXTENDED_MODE_WARNING.slice(1).forEach((line) => console.log(chalk.yellow(`  ${line}`)));
      console.log('');
    }

    // Validate configuration
    if (!this.validateConfig()) {
      this.results.aborted = true;
      return this.results;
    }

    // Health check (use basic http client without accounts)
    // Use hosting URL for all requests (rewrites to omega_api function)
    const healthHttp = new HttpClient({
      apiUrl: this.options.apiUrl,
      timeout: this.options.timeout,
    });

    const healthy = await this.healthCheck(healthHttp);
    if (!healthy) {
      this.results.aborted = true;
      return this.results;
    }

    // Setup accounts
    const accountsReady = await this.setupAccounts();
    if (!accountsReady) {
      this.results.aborted = true;
      return this.results;
    }

    // Discover and run tests
    // @omega.js/backend tests are in the top-level test/ directory of the package
    const frameworkTestsDir = path.resolve(__dirname, '../../test');
    const projectTestsDir = path.join(this.options.projectDir, 'test');

    // C5 scoping: bare/`project:`/`brand:` = project tests only,
    // `framework:`/`omega:`/`mgr:`/`backend:` = the framework suite,
    // `full:` = both. Framework self-test defaults to the framework source.
    this.scope = parseTestScope(this.options.testPaths, {
      frameworkAliases: FRAMEWORK_IDS['@omega.js/backend'],
      selfTest: this.options.isFrameworkSelfTest,
    });
    for (const target of this.scope.invalid) {
      console.log(chalk.yellow(`  ⚠ Unknown test scope prefix ignored: ${target}`));
    }

    // Run @omega.js/backend default tests
    if (this.scope.sources.includes('framework') && jetpack.exists(frameworkTestsDir)) {
      console.log(chalk.bold('  @omega.js/backend Core Tests'));
      await this.runTestsInDir(frameworkTestsDir, 'backend');
    }

    // Run project-specific tests
    if (this.scope.sources.includes('project') && jetpack.exists(projectTestsDir)) {
      console.log(chalk.bold('\n  Project Tests'));
      await this.runTestsInDir(projectTestsDir, 'project');
    }

    // Cleanup rules context
    if (this.rulesContext) {
      await this.rulesContext.cleanup();
    }

    // Report results
    this.reportResults();

    this.results.endTime = Date.now();
    return this.results;
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    if (!this.options.apiUrl) {
      console.log(chalk.red('  ✗ Missing apiUrl'));
      console.log(chalk.gray('    Set OMEGA_API_URL environment variable or pass --url flag'));
      return false;
    }

    if (!this.options.adminKey) {
      console.log(chalk.red('  ✗ Missing adminKey'));
      console.log(chalk.gray('    Set OMEGA_ADMIN_KEY environment variable or pass --key flag'));
      return false;
    }

    if (!this.options.webhookKey) {
      console.log(chalk.red('  ✗ Missing webhookKey'));
      console.log(chalk.gray('    Set OMEGA_WEBHOOK_KEY environment variable or pass --webhook-key flag'));
      return false;
    }

    if (!this.options.brand?.id) {
      console.log(chalk.red('  ✗ Missing brand.id'));
      console.log(chalk.gray('    Could not determine brand ID from configuration'));
      return false;
    }

    if (!this.options.domain) {
      console.log(chalk.red('  ✗ Missing domain'));
      console.log(chalk.gray('    Could not determine domain from brand.contact.email'));
      return false;
    }

    return true;
  }

  /**
   * Check if server is healthy
   */
  async healthCheck(http) {
    process.stdout.write(chalk.gray('  Checking server health... '));

    try {
      const response = await http.get('omega/health');

      if (response.success) {
        console.log(chalk.green('✓'));

        // Abort if the running emulator belongs to a different project.
        // This catches the case where you run `npx omega test` in project A
        // while project B's emulator is still up on the same ports — requests
        // hit the wrong hosting rewrites and tests fail with mysterious 404s.
        const mismatch = await this.checkProjectMismatch(response.data);
        if (mismatch) {
          return false;
        }

        // Report the live mode the emulator just confirmed. The test command
        // writes `.temp/test-mode.json` before invoking us; the emulator's
        // file-watcher mutates its `process.env.TEST_EXTENDED_MODE` to match;
        // the health endpoint re-reads the file as a freshness guard. By
        // construction these are equal — no mismatch warning needed.
        const emulatorExtended = !!response.data?.testExtendedMode;
        console.log(chalk.gray(`  Mode: ${emulatorExtended ? 'extended (real external APIs)' : 'normal (external APIs skipped)'}`));

        return true;
      }

      console.log(chalk.red('✗'));
      console.log(chalk.red(`  Server not responding: ${response.error}`));
      console.log(chalk.gray(`  Make sure your functions are deployed and running at ${this.options.apiUrl}`));
      return false;
    } catch (error) {
      console.log(chalk.red('✗'));
      console.log(chalk.red(`  Health check failed: ${error.message}`));
      return false;
    }
  }

  /**
   * Verify the running emulator belongs to this project. Tries the Firebase
   * Emulator Hub (localhost:4400) first — it always knows the project ID
   * regardless of @omega.js/backend version. Falls back to the health endpoint's projectId
   * field (added in @omega.js/backend 5.3.3+). Returns true (= mismatch, abort) if the
   * project IDs differ.
   */
  async checkProjectMismatch(healthData) {
    const expectedProjectId = this.options.cloud?.config?.projectId;
    if (!expectedProjectId) {
      return false;
    }

    let emulatorProjectId;

    // Try the Firebase Emulator Hub first (version-independent, always correct)
    try {
      const http = require('http');
      const body = await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:4400/emulators', (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      emulatorProjectId = JSON.parse(body).projectId;
    } catch (e) {
      // Hub unreachable — fall back to health endpoint
    }

    // Fall back to the health endpoint's projectId (@omega.js/backend 5.3.3+)
    if (!emulatorProjectId) {
      emulatorProjectId = healthData?.projectId;
    }

    if (emulatorProjectId && emulatorProjectId !== expectedProjectId) {
      console.log(chalk.red(`\n  ✗ Project mismatch: the running emulator belongs to "${emulatorProjectId}" but this project is "${expectedProjectId}".`));
      console.log(chalk.red(`    Stop the other emulator first, then run: npx omega emulator`));
      return true;
    }

    return false;
  }

  /**
   * Setup test accounts - delegates to the shared seed module, then initializes
   * the rules-testing context (test-runner-specific, not needed for standalone seeding).
   */
  async setupAccounts() {
    const result = await seed({
      admin: this.options.admin,
      domain: this.options.domain,
      config: this.config,
      projectDir: this.options.projectDir,
      Manager: this.config.Manager,
      ctx: this.config.ctx,
    });

    if (!result.accounts) {
      return false;
    }

    this.accounts = result.accounts;

    // Initialize rules testing context for security rules tests
    process.stdout.write(chalk.gray('  Initializing rules testing context... '));
    try {
      this.rulesContext = await rulesClient.createRulesContext({
        projectId: this.options.cloud?.config?.projectId,
        rulesPath: this.options.rulesPath,
        port: this.options.emulatorPorts?.firestore,
        accounts: this.accounts,
      });
      console.log(chalk.green('✓'));
    } catch (error) {
      console.log(chalk.red(`✗ (${error.message})`));
      return false;
    }

    return true;
  }

  /**
   * Run all tests in a directory
   */
  async runTestsInDir(dir, source) {
    const testFiles = this.discoverTests(dir);
    const filteredTests = this.filterTests(testFiles, source);

    for (const testFile of filteredTests) {
      await this.runTestFile(testFile, source);
    }
  }

  /**
   * Discover test files in directory
   */
  discoverTests(dir) {
    const tests = [];
    const items = jetpack.list(dir) || [];

    for (const item of items) {
      // Skip _-prefixed files and directories (fixtures, helpers, internal data).
      // Matches EM/BXM/UJM convention — `test/_fixtures/`, `test/_helpers/`, etc.
      if (item.startsWith('_')) {
        continue;
      }

      // Skip the boot/ smoke layer except during framework self-test. It targets
      // the bundled fixture project and would be redundant noise in a real
      // consumer's run (mirrors EM/BXM/UJM excluding boot/** for consumers).
      if (item === 'boot' && !this.options.isFrameworkSelfTest) {
        continue;
      }

      const fullPath = path.join(dir, item);
      const stat = jetpack.inspect(fullPath);

      if (stat.type === 'dir') {
        tests.push(...this.discoverTests(fullPath));
      } else if (stat.type === 'file' && item.endsWith('.test.js')) {
        tests.push(fullPath);
      }
    }

    return tests;
  }

  /**
   * Filter tests for a source using the C5 scope's prefix-stripped paths
   * (source selection already happened in run() via parseTestScope — this
   * only path-matches within the source's own tree).
   */
  filterTests(testFiles, source) {
    const filters = this.scope.filters[source === 'backend' ? 'framework' : 'project'];
    if (filters.length === 0) {
      return testFiles;
    }

    return testFiles.filter((testFile) => {
      const relativePath = this.getRelativeTestPath(testFile, source);
      return filters.some((filterPath) => relativePath.startsWith(filterPath)
        || relativePath === `${filterPath.replace(/(\.test)?\.js$/, '')}.test.js`);
    });
  }

  /**
   * Get relative test path for display
   */
  getRelativeTestPath(testFile, source) {
    if (source === 'backend') {
      return path.relative(path.resolve(__dirname, '../../test'), testFile);
    }
    return path.relative(path.join(this.options.projectDir, 'test'), testFile);
  }

  /**
   * Run a test file (handles both standalone tests and suites)
   */
  async runTestFile(testFile, source) {
    const relativePath = this.getRelativeTestPath(testFile, source);
    let testModule;

    try {
      const searchPaths = [
        // The app root + its install — deps live on the ONE app manifest
        // (src/dist pillar); dist/node_modules covers legacy installs
        this.options.projectDir,
        path.join(this.options.projectDir, 'node_modules'),
        path.join(this.options.projectDir, 'dist', 'node_modules'),
        path.resolve(__dirname, '../../'),
      ];
      const origResolve = Module._resolveFilename.bind(Module);
      Module._resolveFilename = function (request, parent, isMain, options) {
        // Try normal resolution first (preserves nested node_modules traversal)
        try {
          return origResolve(request, parent, isMain, options);
        } catch (err) {
          // Fallback: try resolving from project's search paths
          if (!request.startsWith('.') && !path.isAbsolute(request)) {
            const extra = (options && options.paths) ? options.paths : [];
            return origResolve(request, parent, isMain, {
              ...options,
              paths: [...extra, ...searchPaths],
            });
          }
          throw err;
        }
      };
      try {
        testModule = require(testFile);
      } finally {
        Module._resolveFilename = origResolve;
      }
    } catch (error) {
      console.log(chalk.red(`    ✗ ${relativePath}`));
      console.log(chalk.red(`      Failed to load: ${error.message}`));
      this.results.failed++;
      this.results.tests.push({
        path: relativePath,
        passed: false,
        error: `Failed to load: ${error.message}`,
      });
      return;
    }

    // Check if entire file should be skipped
    if (testModule.skip) {
      const skipReason = typeof testModule.skip === 'string' ? testModule.skip : '';
      const description = testModule.description || relativePath;
      console.log(chalk.yellow(`    ○ ${description}`) + chalk.gray(` (skipped${skipReason ? `: ${skipReason}` : ''})`));

      this.results.skipped++;
      this.results.tests.push({
        path: relativePath,
        description,
        skipped: true,
        skipReason,
      });
      return;
    }

    // Check if this is a suite/group (has tests array) or standalone test
    if (testModule.type === 'suite' || testModule.type === 'group' || Array.isArray(testModule.tests)) {
      await this.runSuite(testModule, relativePath);
    } else if (Array.isArray(testModule)) {
      // Plain array treated as a group (independent tests)
      await this.runSuite({ type: 'group', tests: testModule }, relativePath);
    } else {
      await this.runStandaloneTest(testModule, relativePath);
    }
  }

  /**
   * Run a test suite with sequential tests and shared state
   */
  async runSuite(suite, relativePath) {
    const suiteDescription = suite.description || relativePath;
    const suiteTimeout = suite.timeout || this.options.timeout;
    const tests = suite.tests || [];

    console.log(chalk.cyan(`    ⤷ ${suiteDescription}`));

    // Shared state across all tests in the suite
    const state = {};

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      const testName = test.name || `step-${i + 1}`;
      const testTimeout = test.timeout || suiteTimeout;
      const auth = test.auth || suite.auth || 'none';

      // Check if test should be skipped
      if (test.skip) {
        const skipReason = typeof test.skip === 'string' ? test.skip : '';
        console.log(chalk.yellow(`      ○ ${testName}`) + chalk.gray(` (skipped${skipReason ? `: ${skipReason}` : ''})`));

        this.results.skipped++;
        this.results.tests.push({
          path: `${relativePath}:${testName}`,
          description: testName,
          skipped: true,
          skipReason,
          suite: suiteDescription,
        });
        continue;
      }

      // Create context with shared state
      const context = this.createContext(auth, state);

      const startTime = Date.now();

      try {
        await Promise.race([
          test.run(context),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Test timeout')), testTimeout)
          ),
        ]);

        const duration = Date.now() - startTime;
        console.log(chalk.green(`      ✓ ${testName}`) + chalk.gray(` (${duration}ms)`));

        this.results.passed++;
        this.results.tests.push({
          path: `${relativePath}:${testName}`,
          description: testName,
          passed: true,
          duration,
          suite: suiteDescription,
        });

        // Run cleanup if defined
        if (test.cleanup) {
          try {
            await test.cleanup(context);
          } catch (cleanupError) {
            console.log(chalk.yellow(`        ⚠ Cleanup failed: ${cleanupError.message}`));
          }
        }
      } catch (error) {
        const duration = Date.now() - startTime;

        // Check for runtime skip (test called skip())
        if (error.name === 'SkipError') {
          const skipReason = error.message;
          console.log(chalk.yellow(`      ○ ${testName}`) + chalk.gray(` (skipped: ${skipReason})`));

          this.results.skipped++;
          this.results.tests.push({
            path: `${relativePath}:${testName}`,
            description: testName,
            skipped: true,
            skipReason,
            duration,
            suite: suiteDescription,
          });

          // For suites (sequential, state-dependent tests), a skip on any step means
          // subsequent steps can't run cleanly — propagate skip to the rest of the suite.
          // Groups (independent tests) continue normally.
          const shouldStopOnSkip = suite.type !== 'group' && suite.stopOnFailure !== false;
          if (shouldStopOnSkip) {
            const remaining = tests.length - i - 1;
            if (remaining > 0) {
              console.log(chalk.yellow(`        Skipping ${remaining} remaining test(s) in suite (suite-level skip)`));
              this.results.skipped += remaining;
            }
            break;
          }

          continue;
        }

        console.log(chalk.red(`      ✗ ${testName}`) + chalk.gray(` (${duration}ms)`));
        console.log(chalk.red(`        ${error.message}`));

        this.results.failed++;
        this.results.tests.push({
          path: `${relativePath}:${testName}`,
          description: testName,
          passed: false,
          duration,
          error: error.message,
          suite: suiteDescription,
        });

        // Stop the suite on first failure (sequential tests depend on each other)
        // Groups (type: 'group') continue running all tests regardless of failures
        const shouldStopOnFailure = suite.type !== 'group' && suite.stopOnFailure !== false;
        if (shouldStopOnFailure) {
          const remaining = tests.length - i - 1;
          if (remaining > 0) {
            console.log(chalk.yellow(`        Skipping ${remaining} remaining test(s) in suite`));
            this.results.skipped += remaining;
          }
          break;
        }
      }
    }

    // Run suite-level cleanup
    if (suite.cleanup) {
      try {
        const context = this.createContext('admin', state);
        await suite.cleanup(context);
      } catch (cleanupError) {
        console.log(chalk.yellow(`      ⚠ Suite cleanup failed: ${cleanupError.message}`));
      }
    }
  }

  /**
   * Run a standalone test
   */
  async runStandaloneTest(testModule, relativePath) {
    const description = testModule.description || relativePath;
    const timeout = testModule.timeout || this.options.timeout;
    const auth = testModule.auth || testModule.authLevel || 'none';

    // Create context (no shared state for standalone tests)
    const context = this.createContext(auth);

    const startTime = Date.now();

    try {
      await Promise.race([
        testModule.run(context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Test timeout')), timeout)
        ),
      ]);

      const duration = Date.now() - startTime;
      console.log(chalk.green(`    ✓ ${description}`) + chalk.gray(` (${duration}ms)`));

      this.results.passed++;
      this.results.tests.push({
        path: relativePath,
        description,
        passed: true,
        duration,
      });

      // Run cleanup if defined
      if (testModule.cleanup) {
        try {
          await testModule.cleanup(context);
        } catch (cleanupError) {
          console.log(chalk.yellow(`      ⚠ Cleanup failed: ${cleanupError.message}`));
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      // Check for runtime skip (test called skip())
      if (error.name === 'SkipError') {
        const skipReason = error.message;
        console.log(chalk.yellow(`    ○ ${description}`) + chalk.gray(` (skipped: ${skipReason})`));

        this.results.skipped++;
        this.results.tests.push({
          path: relativePath,
          description,
          skipped: true,
          skipReason,
          duration,
        });
        return;
      }

      console.log(chalk.red(`    ✗ ${description}`) + chalk.gray(` (${duration}ms)`));
      console.log(chalk.red(`      ${error.message}`));

      this.results.failed++;
      this.results.tests.push({
        path: relativePath,
        description,
        passed: false,
        duration,
        error: error.message,
      });
    }
  }

  /**
   * Create test context with all utilities
   * @param {string} auth - Default auth level: 'admin', 'basic', 'premium-active', 'premium-expired', 'none'
   * @param {object} state - Shared state object (for suites)
   */
  createContext(auth, state) {
    // Create HTTP client with accounts for as() method
    // Use hosting URL for all requests (rewrites to omega_api function)
    const http = new HttpClient({
      apiUrl: this.options.apiUrl,
      timeout: this.options.timeout,
      accounts: this.accounts,
      adminKey: this.options.adminKey,
      webhookKey: this.options.webhookKey,
    });

    // Set default auth
    if (auth === 'admin') {
      http.setAuth('adminKey', { key: this.options.adminKey });
    } else if (auth === 'none') {
      http.setAuth('none');
    } else if (auth === 'user') {
      // Alias for basic
      if (this.accounts?.basic?.privateKey) {
        http.setAuth('privateKey', { privateKey: this.accounts.basic.privateKey });
      }
    } else if (this.accounts?.[auth]?.privateKey) {
      // Dynamic lookup — any account type with a privateKey
      http.setAuth('privateKey', { privateKey: this.accounts[auth].privateKey });
    } else {
      http.setAuth('none');
    }

    // Create firestore helper (only if admin SDK available)
    const firestore = this.options.admin
      ? this.createFirestoreHelper()
      : null;

    // Create waitFor helper
    const waitFor = this.createWaitFor();

    // Create pubsub helper
    const pubsub = this.createPubSubHelper();

    // Skip function for runtime skipping
    const skip = (reason) => {
      throw new SkipError(reason);
    };

    // Precomputed product metadata for payment tests — SSOT for all product-aware tests.
    // Each product gets: stripeProductId, frequency, interval, price resolved from config.
    // Tests use payments.products[id].* instead of recomputing per-test.
    const FREQ_TO_INTERVAL = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' };
    const products = this.config.payment?.products || [];
    const stripeProductIds = Object.fromEntries(
      products.map((p) => [p.id, p.stripe?.productId || `_test_${p.id}`])
    );
    const productMeta = Object.fromEntries(
      products.map((p) => {
        const freq = p.prices ? Object.keys(p.prices)[0] : null;
        return [p.id, {
          id: p.id,
          name: p.name,
          type: p.type,
          stripeProductId: p.stripe?.productId || `_test_${p.id}`,
          frequency: freq,
          interval: FREQ_TO_INTERVAL[freq] || null,
          price: freq ? p.prices[freq] : 0,
          trial: p.trial || null,
        }];
      })
    );

    return {
      http,
      accounts: this.accounts,
      assert: assertions,
      state: state || {},
      firestore,
      waitFor,
      pubsub,
      skip,
      admin: this.config.admin,
      // Real @omega.js/backend Manager + ctx, booted by run-tests.js with OMEGA_TEST_RUNNER=1.
      // Tests can call Manager.AI(), Manager.Email(), Manager.User(), etc. exactly
      // like production code — no stubs.
      Manager: this.config.Manager,
      ctx: this.config.ctx,
      rules: this.rulesContext,
      config: this.config,
      payments: { stripeProductIds, products: productMeta },
    };
  }

  /**
   * Create Firestore helper for direct database access
   */
  createFirestoreHelper() {
    const admin = this.options.admin;
    const db = admin.firestore();

    return {
      /**
       * Get a document
       * @param {string} docPath - Document path (e.g., 'users/abc123')
       * @returns {Promise<object|null>} Document data or null
       */
      async get(docPath) {
        const doc = await db.doc(docPath).get();
        return doc.exists ? doc.data() : null;
      },

      /**
       * Check if a document exists
       * @param {string} docPath - Document path
       * @returns {Promise<boolean>}
       */
      async exists(docPath) {
        const doc = await db.doc(docPath).get();
        return doc.exists;
      },

      /**
       * Set a document
       * @param {string} docPath - Document path
       * @param {object} data - Data to set
       * @param {object} options - Firestore set options
       */
      async set(docPath, data, options) {
        await db.doc(docPath).set(data, options || {});
      },

      /**
       * Delete a document
       * @param {string} docPath - Document path
       */
      async delete(docPath) {
        await db.doc(docPath).delete();
      },

      /**
       * Query a collection
       * @param {string} collectionPath - Collection path
       * @returns {object} Firestore collection reference
       */
      collection(collectionPath) {
        return db.collection(collectionPath);
      },
    };
  }

  /**
   * Create waitFor helper for polling conditions
   */
  createWaitFor() {
    /**
     * Wait for a condition to be true
     * @param {Function} condition - Async function that returns truthy when ready
     * @param {number} timeoutMs - Maximum time to wait (default 5000)
     * @param {number} intervalMs - Polling interval (default 100)
     * @returns {Promise<*>} The truthy value returned by condition
     */
    return async function waitFor(condition, timeoutMs, intervalMs) {
      timeoutMs = timeoutMs || 5000;
      intervalMs = intervalMs || 100;

      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await condition();
          if (result) {
            return result;
          }
        } catch (error) {
          // Condition threw - keep polling
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    };
  }

  /**
   * Create PubSub helper for triggering scheduled functions
   */
  createPubSubHelper() {
    const config = this.config;

    return {
      /**
       * Trigger a Firebase scheduled function via PubSub
       * @param {string} functionName - The function name (e.g., 'omega_cronDaily')
       * @returns {Promise<string>} The message ID
       */
      async trigger(functionName) {
        const { PubSub } = require('@google-cloud/pubsub');
        const pubsub = new PubSub({
          projectId: config.cloud?.config?.projectId,
          apiEndpoint: 'localhost:8085',
        });

        const topicName = `firebase-schedule-${functionName}`;

        // Get or create the topic (emulator may not have it yet)
        let topic = pubsub.topic(topicName);
        const [exists] = await topic.exists();

        if (!exists) {
          [topic] = await pubsub.createTopic(topicName);
        }

        const messageId = await topic.publishMessage({ json: {} });
        return messageId;
      },
    };
  }

  /**
   * Report final results
   */
  reportResults() {
    const total = this.results.passed + this.results.failed + this.results.skipped;
    const duration = Date.now() - this.results.startTime;

    console.log(`\n  ${chalk.bold('Results')}`);
    console.log(`    ${chalk.green(`${this.results.passed} passing`)}`);

    if (this.results.failed > 0) {
      console.log(`    ${chalk.red(`${this.results.failed} failing`)}`);
    }

    if (this.results.skipped > 0) {
      console.log(`    ${chalk.yellow(`${this.results.skipped} skipped`)}`);
    }

    console.log(chalk.gray(`\n    Total: ${total} tests in ${duration}ms\n`));
  }
}

module.exports = TestRunner;
