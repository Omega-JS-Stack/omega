/**
 * run() — the omega-desktop bin body, shared by bin/omega-desktop (via
 * dist/omega-bin.js) and cross-framework dispatch ('@omega.js/desktop/cli').
 */
async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/desktop' });

  // Strip ELECTRON_RUN_AS_NODE — it leaks into our env from common parent processes
  // (e.g. VS Code's Claude Code extension) and makes every Electron binary we shell
  // to silently run as plain Node. Strip once at the CLI boundary.
  delete process.env.ELECTRON_RUN_AS_NODE;

  // Value-less flags must be declared boolean — otherwise yargs treats the next
  // positional as the flag's VALUE. Mirrors the same fix in @omega.js/backend's CLI.
  const argv = require('yargs')(process.argv.slice(2)).boolean(['extended']).parseSync();
  const cli = new (require('./cli.js'))(argv);

  try {
    await cli.process(argv);
  } catch (e) {
    process.exit(1);
  }
}

module.exports = { run };
