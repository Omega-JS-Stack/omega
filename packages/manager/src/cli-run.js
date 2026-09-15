/**
 * run() — the manager CLI body, reached through the omega-bin brand-root
 * dispatch ('@omega.js/manager/cli'): at a brand root, every framework's
 * `omega` bin hands over here so brand-level commands (`omega test`,
 * `omega manage`) fan out over targets/* instead of guessing one framework.
 * The manager ships that bin itself too (bin/omega → src/omega-bin.js, #276),
 * so a fresh clone with no framework installed still lands here — that is
 * where `npx omega onboard` runs. The onboard handoff spawns this file
 * directly as its manage child entry.
 */
// The value-LESS flags, the only list a CLI owes the parse: every other flag
// takes the next token as its value, which is the spelling the docs teach
// (`omega manage --service publishing`) and the one a fan-out forwards to a
// target (mirrors the framework bins).
// `--reset-assets` is deliberately NOT here: it is value-TAKING (bare resets
// both kinds, `=logos`/`=templates` names one, services/assets/lib/reset.js).
const BOOLEAN_FLAGS = [
  'continue-on-error', 'dry-run', 'execute', 'manage', 'all', 'full', 'verify', 'publish', 'extended',
  'verbose', 'strict', 'apply', 'major', 'force-fresh',
];

async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/manager' });

  // Boot preludes: the cheap, non-interactive checks every verb passes through,
  // filtered by the verb about to run (#890)
  require('@omega.js/devkit/preludes').runPreludes({ verb: process.argv[2], targetDir: process.cwd() });

  // The router owns --help/--version, so `-v`/`--version` reach our version
  // command through the alias table.
  const argv = require('@omega.js/devkit/argv').parseArgv(process.argv.slice(2), { booleans: BOOLEAN_FLAGS });
  const cli = new (require('./cli.js'))(argv);

  await cli.process(argv);
}

module.exports = { run, BOOLEAN_FLAGS };

if (require.main === module) run();
