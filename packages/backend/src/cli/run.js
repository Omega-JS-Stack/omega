/**
 * run() — the omega-backend bin body, shared by bin/omega-backend (via
 * dist/omega-bin.js) and cross-framework dispatch ('@omega.js/backend/cli').
 */
async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/backend' });

  const Main = new (require('./index.js'))(process.argv);

  try {
    await Main.process(process.argv);
  } catch (e) {
    // Print a clean one-line error instead of Node's raw UnhandledPromiseRejection
    // dump. Commands that intend a hard stop should `process.exit(1)` themselves
    // (e.g. setup's haltSetup); this is the catch-all backstop.
    const chalk = require('chalk').default;
    console.error(chalk.red(`\n✗ ${e && e.message ? e.message : e}`));
    process.exit(1);
  }
}

module.exports = { run };
