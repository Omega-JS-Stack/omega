/**
 * run() — the omega-extension bin body, shared by bin/omega-extension (via
 * dist/omega-bin.js) and cross-framework dispatch ('@omega.js/extension/cli').
 */
async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/extension' });

  // Value-less flags must be declared boolean — otherwise yargs treats the next
  // positional as the flag's VALUE. Mirrors the same fix in @omega.js/backend's CLI.
  // yargs' built-in --version/--help are disabled so both route through the
  // alias table / the router's built-in help (the built-ins printed an empty
  // stub and version "0.0.0" — yargs can't resolve our package version here).
  const argv = require('yargs')(process.argv.slice(2))
    .boolean(['extended', 'direct', 'dry-run', 'sync', 'secrets'])
    .version(false)
    .help(false)
    .parseSync();
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run };
