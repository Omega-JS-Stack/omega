/**
 * run() — the omega bin body for @omega.js/web, shared by bin/omega (via
 * src/omega-bin.js) and cross-framework dispatch ('@omega.js/web/cli').
 */
async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/web' });

  // Value-less flags must be declared boolean — otherwise yargs treats the next
  // positional as the flag's VALUE (`omega test --extended some/target` would
  // become extended='some/target' with NO target). Mirrors the UJM/@omega.js/backend
  // CLI fix. yargs' built-in --version/--help are disabled so `-v`/`--version`
  // route to our version command through the alias table.
  const argv = require('yargs')(process.argv.slice(2))
    .boolean(['extended', 'check', 'dry-run', 'local', 'direct'])
    .version(false)
    .help(false)
    .parseSync();
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run };
