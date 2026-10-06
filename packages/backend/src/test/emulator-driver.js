/**
 * The backend's `emulator` layer driver for the devkit runner. `start` runs the
 * pre-flight a backend run needs before its first case (the install check, the
 * config, the health and project checks, the account seed, the rules context,
 * the connect trap); `extras(info)` is each case's ctx extras, its `http`
 * signed in as the case's (or else its suite's) `auth`.
 *
 *   createEmulatorDriver({ config, admin, omega, ctx }).start({ hooks })
 *     -> { accounts, extras(info), stop() }
 */
const os = require('os');
const path = require('path');
const chalk = require('chalk').default;

const HttpClient = require('./utils/http-client.js');
const rulesClient = require('./utils/firestore-rules-client.js');
const connectTrap = require('./connect-trap.js');
const { seed } = require('./seed.js');
const { createFirestoreHelper } = require('./firestore-helper.js');
const { createPubSubHelper } = require('./pubsub-helper.js');
const { paymentsMeta } = require('./payments-meta.js');

// What validateConfig requires, and the hint each missing value prints.
const REQUIRED = [
  ['apiUrl', (c) => c.apiUrl, 'Set OMEGA_API_URL environment variable or pass --url flag'],
  ['adminKey', (c) => c.adminKey, 'Set OMEGA_ADMIN_KEY environment variable or pass --key flag'],
  ['webhookKey', (c) => c.webhookKey, 'Set OMEGA_WEBHOOK_KEY environment variable or pass --webhook-key flag'],
  ['brand.id', (c) => c.brand?.id, 'Could not determine brand ID from configuration'],
  ['domain', (c) => c.domain, 'Could not determine the brand host from brand.url'],
];

/**
 * Sign an http client in as a case's auth: its own, else its suite's, else
 * none. `admin` is the admin key, `user` the basic account, any other name that
 * account's private key; `none` or an account the run has not seeded signs in as nobody.
 * @param {HttpClient} http - A fresh client.
 * @param {object} info - The normalized case plus its `suite` (or `{ suite }` alone).
 * @param {{ accounts: object|null, adminKey: string }} keys - The seeded accounts and the admin key.
 * @returns {HttpClient} The same client.
 */
function applyAuth(http, info, { accounts, adminKey }) {
  const name = info.auth || (info.suite && info.suite.auth) || 'none';
  if (name === 'admin') {
    http.setAuth('adminKey', { key: adminKey });
    return http;
  }

  const privateKey = accounts?.[name === 'user' ? 'basic' : name]?.privateKey;
  if (name !== 'none' && privateKey) {
    http.setAuth('privateKey', { privateKey });
  } else {
    http.setAuth('none');
  }
  return http;
}

function preflightError(step, detail) {
  const error = new Error(`Pre-flight ${step}: ${detail}`);
  error.name = 'PreflightError';
  return error;
}

// An install under ~/node_modules shadows every local project copy.
function checkInstall() {
  const homeModules = path.join(os.homedir(), 'node_modules');
  if (!__dirname.startsWith(homeModules)) {
    return;
  }
  throw preflightError('install', `@omega.js/backend is running from ~/node_modules (home directory install), likely an accidental global install that shadows local project copies. Fix: rm -rf ${homeModules} ${path.join(os.homedir(), 'package.json')} ${path.join(os.homedir(), 'package-lock.json')} (running from ${__dirname})`);
}

function validateConfig(config) {
  for (const [name, read, hint] of REQUIRED) {
    if (!read(config)) {
      console.log(chalk.red(`  ✗ Missing ${name}`));
      console.log(chalk.gray(`    ${hint}`));
      throw preflightError('config', `missing ${name}. ${hint}`);
    }
  }
}

// The running emulator must belong to this project: another project's stack on
// the same ports answers every request with the wrong rewrites. The health
// endpoint's `projectId` names it.
function checkProjectMismatch(config, healthData) {
  const expected = config.cloud?.config?.projectId;
  if (!expected) {
    return;
  }

  const running = healthData?.projectId;
  if (running && running !== expected) {
    console.log(chalk.red(`\n  ✗ Project mismatch: the running emulator belongs to "${running}" but this project is "${expected}".`));
    console.log(chalk.red('    Stop the other emulator first, then run: npx omega emulator'));
    throw preflightError('health check', `project mismatch: the running emulator belongs to "${running}", this project is "${expected}"`);
  }
}

async function checkHealth(config, timeout) {
  process.stdout.write(chalk.gray('  Checking server health... '));

  let response;
  try {
    response = await new HttpClient({ apiUrl: config.apiUrl, timeout }).get('omega/health');
  } catch (error) {
    console.log(chalk.red('✗'));
    console.log(chalk.red(`  Health check failed: ${error.message}`));
    throw preflightError('health check', error.message);
  }

  if (!response.success) {
    console.log(chalk.red('✗'));
    console.log(chalk.red(`  Server not responding: ${response.error}`));
    console.log(chalk.gray(`  Make sure your functions are deployed and running at ${config.apiUrl}`));
    throw preflightError('health check', `server not responding at ${config.apiUrl}: ${response.error}`);
  }

  console.log(chalk.green('✓'));
  checkProjectMismatch(config, response.data);

  // The emulator re-reads the mode file the test command wrote, so this IS the live mode.
  const emulatorExtended = !!response.data?.testExtendedMode;
  console.log(chalk.gray(`  Mode: ${emulatorExtended ? 'extended (real external APIs)' : 'normal (external APIs skipped)'}`));
}

async function createRulesContext(config, accounts, extraAccounts) {
  process.stdout.write(chalk.gray('  Initializing rules testing context... '));
  try {
    const context = await rulesClient.createRulesContext({
      projectId: config.cloud?.config?.projectId,
      rulesPath: config.rulesPath,
      port: config.emulatorPorts?.firestore,
      accounts, extraAccounts,
    });
    console.log(chalk.green('✓'));
    return context;
  } catch (error) {
    console.log(chalk.red(`✗ (${error.message})`));
    throw preflightError('rules context', error.message);
  }
}

// The pre-flight, then the handle: `{ accounts, extras(info), stop() }`.
async function startDriver({ config, admin, omega, ctx, hooks }) {
  checkInstall();
  validateConfig(config);

  const timeout = config.timeout || 30000;
  let accounts = null;
  let rules = null;

  // A custom-server backend has no hosting to check and no emulator to seed
  if (!config.custom) {
    await checkHealth(config, timeout);

    const seeded = await seed({ admin, domain: config.domain, config, hooks });
    if (!seeded.accounts) {
      throw preflightError('accounts', 'the persona seed failed (its reason is above)');
    }
    accounts = seeded.accounts;
    rules = await createRulesContext(config, accounts, seeded.extraAccounts);
  }

  // A plain run reaches only loopback; extended and lane runs exist to reach real services
  if (!process.env.TEST_EXTENDED_MODE && !process.env.OMEGA_TEST_LANE) {
    connectTrap.install();
  }

  const firestore = admin ? createFirestoreHelper(admin) : null;
  const pubsub = createPubSubHelper(config);
  const payments = paymentsMeta(config);

  return {
    accounts,
    extras(info) {
      const http = new HttpClient({
        apiUrl: config.apiUrl,
        timeout,
        accounts,
        adminKey: config.adminKey,
        webhookKey: config.webhookKey,
      });
      applyAuth(http, info, { accounts, adminKey: config.adminKey });
      return { http, accounts, firestore, pubsub, admin, omega, ctx, rules, config, payments };
    },
    async stop() {
      if (rules) {
        await rules.cleanup();
      }
    },
  };
}

/**
 * The `emulator` row driver. `start` runs once: the `_init.js` setup context
 * starts it ahead of the setups, and the runner's own call gets the same promise.
 * @param {{ config: object, admin: object|null, omega: object|null, ctx: object|null }} options -
 *   The test config the verb sent, and the runner host's firebase-admin, omega and Context.
 * @returns {{ start: Function }} The driver.
 */
function createEmulatorDriver({ config, admin, omega, ctx }) {
  let started = null;
  return {
    start({ hooks }) {
      if (!started) {
        started = startDriver({ config, admin, omega, ctx, hooks });
      }
      return started;
    },
  };
}

module.exports = { createEmulatorDriver, applyAuth };
