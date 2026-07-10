/**
 * run() — the omega-extension bin body, shared by bin/omega-extension (via
 * dist/omega-bin.js) and cross-framework dispatch ('@omega.js/extension/cli').
 */
async function run() {
  // Value-less flags must be declared boolean — otherwise yargs treats the next
  // positional as the flag's VALUE. Mirrors the same fix in @omega.js/backend's CLI.
  const argv = require('yargs')(process.argv.slice(2)).boolean(['extended']).parseSync();
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run };
