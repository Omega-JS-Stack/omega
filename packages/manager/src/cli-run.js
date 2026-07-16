/**
 * run() — the omega-manager bin body, shared by bin/omega-manager and the
 * omega-bin brand-root dispatch ('@omega.js/manager/cli'): at a brand root,
 * every framework's `omega` bin hands over here so brand-level commands
 * (`omega test`, `omega manage`) fan out over apps/* instead of guessing
 * one framework.
 */
async function run() {
  // Value-less flags must be declared boolean — otherwise yargs treats the next
  // positional as the flag's VALUE (mirrors the framework bins). yargs' built-in
  // --version/--help are disabled so `-v`/`--version` route to our version
  // command through the alias table.
  const argv = require('yargs')(process.argv.slice(2))
    .boolean(['continue-on-error', 'dry-run', 'parallel', 'manage', 'all'])
    .version(false)
    .help(false)
    .parseSync();
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run };
