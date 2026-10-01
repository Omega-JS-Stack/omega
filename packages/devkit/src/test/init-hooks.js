// test/_init.js: the pre-test lifecycle hook (setup only), one loader for every
// runner that honors it: runner-core (desktop, extension) and web's test command.
//
// A test root may carry `_init.js` exporting a FUNCTION,
// `module.exports = (ctx) => ({ setup })`, called with `{ projectRoot }` and
// returning an object with an async `setup({ projectRoot })` that runs ONCE
// before any suite (e.g. to scaffold a fixture file a suite needs). There is
// no `cleanup` hook: tests clean up after themselves.

const path = require('path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

function loadInit(testDir, label, projectRoot) {
  const initPath = path.join(testDir, '_init.js');

  if (!jetpack.exists(initPath)) {
    return {};
  }

  try {
    const fn = require(initPath);

    if (typeof fn !== 'function') {
      console.log(chalk.red(`  ✗ ${label} test/_init.js must export a function: module.exports = (ctx) => ({ ... })`));
      return {};
    }

    const mod = fn({ projectRoot });
    return mod && typeof mod === 'object' ? mod : {};
  } catch (e) {
    console.log(chalk.red(`  ✗ Failed to load ${label} test/_init.js: ${e.message}`));
    return {};
  }
}

/**
 * Load every test root's `_init.js` and run each `setup()` once, in order.
 * @param {Array<{dir: string, label: string}>} roots - test dirs, in run order
 * @param {string} projectRoot - handed to the factory and to every setup
 */
async function runInitSetups(roots, projectRoot) {
  const setups = roots
    .map(({ dir, label }) => loadInit(dir, label, projectRoot))
    .filter((h) => typeof h.setup === 'function')
    .map((h) => h.setup);

  for (const setup of setups) {
    process.stdout.write(chalk.gray('  Running test/_init.js setup... '));
    try {
      await setup({ projectRoot });
      console.log(chalk.green('✓'));
    } catch (e) {
      console.log(chalk.red(`✗ (${e.message})`));
    }
  }
}

module.exports = { runInitSetups };
