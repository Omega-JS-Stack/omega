/**
 * run() — the manager CLI body, reached through the omega-bin brand-root
 * dispatch ('@omega.js/manager/cli'): at a brand root, every framework's
 * `omega` bin hands over here so brand-level commands (`omega test`,
 * `omega manage`) fan out over targets/* instead of guessing one framework.
 * The manager ships that bin itself too (bin/omega → src/omega-bin.js, #276),
 * so a fresh clone with no framework installed still lands here — that is
 * where `npx omega onboard` runs. The company orchestrator spawns this file
 * directly as its per-brand child entry.
 */
// Value-less flags must be declared boolean — otherwise yargs treats the next
// positional as the flag's VALUE (mirrors the framework bins).
const BOOLEAN_FLAGS = ['continue-on-error', 'dry-run', 'execute', 'parallel', 'manage', 'all', 'full', 'verify', 'publish', 'extended'];

async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/manager' });

  // yargs' built-in --version/--help are disabled so `-v`/`--version` route to
  // our version command through the alias table.
  const argv = require('yargs')(process.argv.slice(2))
    .boolean(BOOLEAN_FLAGS)
    .version(false)
    .help(false)
    .parseSync();
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run, BOOLEAN_FLAGS };

if (require.main === module) run();
