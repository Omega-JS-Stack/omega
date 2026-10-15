/**
 * Standalone persona-seeding module: the single orchestration point for
 * populating an emulator with test accounts. Called by BOTH the test run (the
 * `emulator` layer driver, emulator-driver.js) and the standalone emulator
 * command (emulator.js).
 *
 * The `test/_init.js` hooks load through devkit's one loader; a hook's
 * `accounts` are the extra personas seeded beside the framework's own.
 */
const path = require('path');
const chalk = require('chalk').default;
const testAccounts = require('./test-accounts.js');
const { loadInitHooks, runInitSetups, InitHookError } = require('@omega.js/devkit/test/init-hooks');

/**
 * The extra accounts the loaded hooks declare, keyed on `id`: a hook's
 * `accounts` may be an array or a keyed object.
 *
 * @param {Array<{hook: object}>} hooks - What devkit's loader returned
 * @returns {object} Accounts keyed by id
 */
function hookAccounts(hooks) {
  const accounts = {};
  for (const { hook } of hooks) {
    const list = Array.isArray(hook.accounts)
      ? hook.accounts
      : Object.values(hook.accounts || {});
    for (const account of list) {
      if (account && account.id) {
        accounts[account.id] = account;
      }
    }
  }

  return accounts;
}

/**
 * The backend's two test roots, in run order: the runner's roots, and the
 * roots whose `_init.js` hooks a seed reads.
 * @param {string} projectDir - Firebase project directory (holds test/)
 * @returns {Array<{dir: string, label: string}>} The framework root, then the project's
 */
function testRoots(projectDir) {
  return [
    { dir: path.resolve(__dirname, '../../test'), label: 'framework' },
    { dir: path.join(projectDir, 'test'), label: 'project' },
  ];
}

// The accounts the last loadSeedAccounts() resolved, kept per project dir. A
// functions process serves ONE project, so this is a single slot in practice.
const seedAccountsCache = new Map();

/**
 * The project personas the `_init.js` hooks declare, read OUTSIDE a seeding run
 * for the roster route. Cached per project dir so a request never re-runs the
 * hooks; only a SUCCESSFUL read is cached, so a broken `_init.js` serves `{}`
 * behind a red line and the next call re-reads the fixed file.
 * @param {object} options
 * @param {string} options.projectDir - Firebase project directory (holds test/)
 * @param {object} [options.config] - Resolved brand config, passed to the hooks
 * @param {object} [options.omega] - @omega.js/backend instance, passed to the hooks
 * @returns {object} Accounts keyed by id (empty when the project declares none)
 */
function loadSeedAccounts({ projectDir, config, omega }) {
  if (!seedAccountsCache.has(projectDir)) {
    let hooks;
    try {
      hooks = loadInitHooks(testRoots(projectDir), { projectRoot: projectDir, factoryArgs: { config, omega } });
    } catch (e) {
      if (!(e instanceof InitHookError)) {
        throw e;
      }
      console.log(chalk.red(`  ✗ ${e.message}`));
      return {};
    }

    seedAccountsCache.set(projectDir, hookAccounts(hooks));
  }

  return seedAccountsCache.get(projectDir);
}

/**
 * Seed the emulator with test personas: wipe, create accounts, fetch keys. The
 * hooks' `setup` functions are not run here: devkit's runner runs them.
 * @param {object} options
 * @param {object} options.admin       - Firebase Admin SDK instance (connected to emulator)
 * @param {string} options.domain      - Brand domain (for email templates)
 * @param {object} options.config      - Resolved brand config
 * @param {Array<{file: string, label: string, hook: object}>} options.hooks - The `_init.js` hooks devkit loaded
 * @param {boolean} [options.quiet]    - Suppress progress output
 * @returns {Promise<{ accounts: object, extraAccounts: object, created: number }>} The seeded accounts, plus the test/_init.js table
 */
async function seed({ admin, domain, config, hooks, quiet }) {
  const log = quiet ? () => {} : (msg) => process.stdout.write(msg);
  const logLn = quiet ? () => {} : (msg) => console.log(msg);

  const extraAccounts = hookAccounts(hooks);

  // 1. Wipe emulator + delete auth users
  log(chalk.gray('  Wiping emulator + deleting test users... '));
  const deleteResult = await testAccounts.deleteTestUsers(admin, extraAccounts);
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
  let result;
  try {
    result = await testAccounts.createTestAccounts(admin, domain, config, extraAccounts);
  } catch (error) {
    logLn(chalk.red(`✗ ${error.message}`));
    throw error;
  }

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
  const orderIds = await testAccounts.seedOrderFixtures(admin, config, extraAccounts);
  logLn(chalk.green(`✓ (${orderIds.length} orders)`));

  // 5. Stand up the personas' active sessions. A session is the one part of an
  // account that does not live on its user doc — it is a Realtime Database
  // record an app writes while it is signed in — so account creation leaves
  // even a full persona signed in nowhere, and the account page's security
  // panel shows a customer with a single device forever (#343).
  log(chalk.gray('  Seeding persona session fixtures... '));
  const sessionIds = await testAccounts.seedSessionFixtures(admin, extraAccounts);
  logLn(chalk.green(`✓ (${sessionIds.length} sessions)`));

  // 6. Fetch private keys
  const accounts = await testAccounts.fetchPrivateKeys(
    admin, domain, config, extraAccounts,
  );

  return { accounts, extraAccounts, created: result.created };
}

/**
 * Seed outside a test run (the emulator verb): the seed runs once, ahead of
 * the `_init.js` setups, which get its accounts. A broken hook throws devkit's
 * InitHookError naming the file.
 * @param {object} options
 * @param {object} options.admin      - Firebase Admin SDK instance (connected to emulator)
 * @param {string} options.domain     - Brand domain (for email templates)
 * @param {object} options.config     - Resolved brand config
 * @param {string} options.projectDir - Firebase project directory (holds test/)
 * @returns {Promise<{ accounts: object, extraAccounts: object, created: number }>} What seed() resolved
 */
async function seedProject({ admin, domain, config, projectDir }) {
  let seeding = null;
  const seedOnce = (hooks) => (seeding = seeding || seed({ admin, domain, config, hooks }));

  const hooks = await runInitSetups(testRoots(projectDir), projectDir, {
    factoryArgs: { config },
    setupContext: async ({ hooks: loaded }) => {
      const { accounts } = await seedOnce(loaded);
      if (!accounts && loaded.some(({ hook }) => typeof hook.setup === 'function')) {
        throw new Error('the seed completed with errors (see above), so no test/_init.js setup ran');
      }
      return { admin, config, accounts };
    },
  });

  return seedOnce(hooks);
}

module.exports = { seed, seedProject, loadSeedAccounts, testRoots };
