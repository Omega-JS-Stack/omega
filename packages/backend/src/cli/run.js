/**
 * run() — the omega-backend bin body, shared by bin/omega-backend (via
 * dist/omega-bin.js) and cross-framework dispatch ('@omega.js/backend/cli').
 */
async function run() {
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
