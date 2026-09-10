/**
 * Standalone persona-seeding module — the single orchestration point for
 * populating an emulator with test accounts. Called by BOTH the test runner
 * (runner.js setupAccounts) and the standalone emulator command (emulator.js).
 *
 * Factored out so `npx omega emulator` seeds on boot without duplicating the
 * runner's account-creation logic.
 */
const path = require('path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const testAccounts = require('./test-accounts.js');

/**
 * Load and merge `test/_init.js` lifecycle hooks from one or two test roots.
 * Same contract as runner.js loadInitHooks — accepts either array or keyed
 * object for accounts and normalizes to a keyed object on `id`.
 *
 * @param {string} frameworkTestsDir - @omega.js/backend's own test/ directory
 * @param {string} [projectTestsDir] - Consumer project's test/ directory
 * @param {object} [ctx] - Context passed to _init.js functions ({ config, Manager })
 * @returns {{ accounts: object, setups: Function[], failed: boolean }}
 */
function loadInitHooks(frameworkTestsDir, projectTestsDir, ctx) {
  const loaded = [
    loadInit(frameworkTestsDir, '@omega.js/backend core', ctx),
  ];

  if (projectTestsDir && jetpack.exists(projectTestsDir)) {
    loaded.push(loadInit(projectTestsDir, 'project', ctx));
  }

  const hooks = loaded.map((entry) => entry.hook);

  const accounts = {};
  for (const h of hooks) {
    const list = Array.isArray(h.accounts)
      ? h.accounts
      : Object.values(h.accounts || {});
    for (const account of list) {
      if (account && account.id) {
        accounts[account.id] = account;
      }
    }
  }

  return {
    accounts,
    setups: hooks.filter((h) => typeof h.setup === 'function').map((h) => h.setup),
    failed: loaded.some((entry) => entry.failed),
  };
}

// The accounts the last loadSeedAccounts() resolved, kept per project dir. A
// functions process serves ONE project, so this is a single slot in practice.
const seedAccountsCache = new Map();

/**
 * The accounts the `_init.js` hooks declare — the project's own personas, the
 * `extraAccounts` half of every seed surface — resolved OUTSIDE a seeding run
 * ([#712](https://github.com/Omega-JS-Stack/omega/issues/712)): the roster
 * route serves them from the functions process, which never ran the seed.
 *
 * Cached per project dir because a request must not re-read (and re-execute) a
 * consumer's `_init.js` every time the palette asks. `test/_init.js` sits
 * outside `dist/`, so an edit to it does not reload this process — but a
 * changed persona has to be re-SEEDED to exist at all, and that is an emulator
 * restart, which reloads it here too.
 *
 * Only a SUCCESSFUL read is cached ([#733](https://github.com/Omega-JS-Stack/omega/issues/733)):
 * a broken `_init.js` is not an answer to remember, so the failure serves `{}`
 * (behind the red log the load already prints) and the NEXT call re-reads the
 * file the developer just fixed, instead of holding an empty roster until the
 * emulator restarts.
 *
 * @param {object} options
 * @param {string} options.projectDir - Firebase project directory (holds test/)
 * @param {object} [options.config] - Resolved brand config, passed to the hooks
 * @param {object} [options.Manager] - Backend Manager instance, passed to the hooks
 * @returns {object} Accounts keyed by id (empty when the project declares none)
 */
function loadSeedAccounts({ projectDir, config, Manager }) {
  if (!seedAccountsCache.has(projectDir)) {
    const frameworkTestsDir = path.resolve(__dirname, '../../test');
    const projectTestsDir = path.join(projectDir, 'test');

    const hooks = loadInitHooks(frameworkTestsDir, projectTestsDir, { config, Manager });

    if (hooks.failed) {
      return {};
    }

    seedAccountsCache.set(projectDir, hooks.accounts);
  }

  return seedAccountsCache.get(projectDir);
}

/**
 * Load a single test/_init.js hook from a test root.
 *
 * @returns {{ hook: object, failed?: boolean }} The hook module (`{}` when the
 *   root declares none), and whether the load BROKE — which a caller that
 *   remembers what it read must not remember.
 */
function loadInit(testDir, label, ctx) {
  const initPath = path.join(testDir, '_init.js');

  if (!jetpack.exists(initPath)) {
    return { hook: {} };
  }

  try {
    const fn = require(initPath);
    if (typeof fn !== 'function') {
      console.log(chalk.red(`  ✗ ${label} test/_init.js must export a function: module.exports = (ctx) => ({ ... })`));
      return failedInit(initPath);
    }
    const mod = fn(ctx || {});
    // A factory that returns no object (the classic `(ctx) => { accounts: ... }`
    // arrow-body typo returns undefined) is the third broken shape — remembered
    // as "declares none" it would stick for the process lifetime (#733).
    if (!mod || typeof mod !== 'object') {
      console.log(chalk.red(`  ✗ ${label} test/_init.js hook factory must RETURN an object, got ${mod === null ? 'null' : typeof mod}`));
      return failedInit(initPath);
    }
    return { hook: mod };
  } catch (e) {
    console.log(chalk.red(`  ✗ Failed to load ${label} test/_init.js: ${e.message}`));
    return failedInit(initPath);
  }
}

/**
 * A broken load, forgotten everywhere. Node drops a module that threw while
 * being EVALUATED, but a file that required cleanly and then broke — an
 * exported non-function, a hook factory that threw when called — stays in
 * `require.cache`, so a retry would keep re-reading the same broken module
 * however many times the developer fixes the file (#733).
 */
function failedInit(initPath) {
  delete require.cache[require.resolve(initPath)];

  return { hook: {}, failed: true };
}

/**
 * Seed the emulator with test personas — wipe, create accounts, fetch keys,
 * run setup hooks. Returns the accounts map (same shape as runner.accounts).
 *
 * @param {object} options
 * @param {object} options.admin       - Firebase Admin SDK instance (connected to emulator)
 * @param {string} options.domain      - Brand domain (for email templates)
 * @param {object} options.config      - Resolved brand config
 * @param {string} options.projectDir  - Firebase project directory (for _init.js discovery)
 * @param {object} [options.Manager]   - Backend Manager instance (passed to _init hooks)
 * @param {object} [options.ctx] - Backend ctx instance (passed to _init hooks)
 * @param {boolean} [options.quiet]    - Suppress progress output
 * @returns {Promise<{ accounts: object, created: number }>}
 */
async function seed({ admin, domain, config, projectDir, Manager, ctx, quiet }) {
  const log = quiet ? () => {} : (msg) => process.stdout.write(msg);
  const logLn = quiet ? () => {} : (msg) => console.log(msg);

  const frameworkTestsDir = path.resolve(__dirname, '../../test');
  const projectTestsDir = path.join(projectDir, 'test');

  const initHooks = loadInitHooks(frameworkTestsDir, projectTestsDir, { config, Manager });

  // 1. Wipe emulator + delete auth users
  log(chalk.gray('  Wiping emulator + deleting test users... '));
  const deleteResult = await testAccounts.deleteTestUsers(admin, initHooks.accounts);
  logLn(chalk.green(`✓ (${deleteResult.deleted} deleted, ${deleteResult.skipped} skipped)`));

  // 2. Ensure meta/stats has a baseline `users` counter (required for user
  // count increments + the admin stats route). MUST run AFTER the wipe: the
  // flush recursively deletes every collection (including meta/stats), and the
  // deleted `notifications` docs fire on-write triggers that merge
  // `{ notifications: increment(-1) }` back into meta/stats — racing ahead of
  // this seed and re-creating the doc with NO `users` field. That's why this
  // is a MERGE write that always runs (never create-if-missing): it lands the
  // `users` baseline without clobbering whatever `notifications` value those
  // triggers write. A create-if-missing seed was exactly the bug that made the
  // admin stats tests flaky.
  log(chalk.gray('  Ensuring meta/stats doc exists... '));
  await admin.firestore().doc('meta/stats').set({
    users: { total: 0 },
    brand: config?.brand?.id,
  }, { merge: true });
  logLn(chalk.green('✓'));

  // 3. Create test accounts
  log(chalk.gray('  Creating test accounts... '));
  const result = await testAccounts.createTestAccounts(
    admin, domain, config, initHooks.accounts,
  );

  if (!result.success) {
    logLn(chalk.red(`\n  ✗ Failed to setup accounts: ${result.errors?.map((e) => e.error).join(', ')}`));
    return { accounts: null, created: 0 };
  }
  logLn(chalk.green(`✓ (${result.created} created)`));

  // 4. Stand up the personas' purchase records. Creating an account writes a user
  // doc and nothing else, so a persona seeded with a bought subscription arrives
  // naming a `payments-orders` doc that does not exist — the same fixtures the dev
  // reset route re-seeds per persona (routes/test/reset-account), from the same
  // definitions — a project's own `test/_init.js` personas included.
  log(chalk.gray('  Seeding persona order fixtures... '));
  const orderIds = await testAccounts.seedOrderFixtures(admin, config, initHooks.accounts);
  logLn(chalk.green(`✓ (${orderIds.length} orders)`));

  // 5. Stand up the personas' active sessions. A session is the one part of an
  // account that does not live on its user doc — it is a Realtime Database
  // record an app writes while it is signed in — so account creation leaves
  // even a full persona signed in nowhere, and the account page's security
  // panel shows a customer with a single device forever (#343).
  log(chalk.gray('  Seeding persona session fixtures... '));
  const sessionIds = await testAccounts.seedSessionFixtures(admin, initHooks.accounts);
  logLn(chalk.green(`✓ (${sessionIds.length} sessions)`));

  // 6. Fetch private keys
  const accounts = await testAccounts.fetchPrivateKeys(
    admin, domain, config, initHooks.accounts,
  );

  // 7. Run setup hooks (_init.js setup functions)
  for (const setup of initHooks.setups) {
    log(chalk.gray('  Running test/_init.js setup... '));
    try {
      await setup({ admin, config, accounts, Manager, ctx });
      logLn(chalk.green('✓'));
    } catch (e) {
      logLn(chalk.red(`✗ (${e.message})`));
      return { accounts: null, created: result.created };
    }
  }

  return { accounts, created: result.created };
}

module.exports = { seed, loadInitHooks, loadSeedAccounts };
