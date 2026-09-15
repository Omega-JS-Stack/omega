/**
 * run(): the CLI body, shared by bin/omega (via dist/omega-bin.js, the
 * dispatcher) and cross-framework dispatch ('@omega.js/desktop/cli').
 */
// The value-LESS flags, the only list a CLI owes the parse: every other flag
// takes the next token as its value, which is what carries CI's own
// `sign-windows --in release --out release/signed`. Mirrors the same fix in
// @omega.js/backend's CLI.
const BOOLEAN_FLAGS = [
  'extended', 'local', 'quick', 'q', 'direct', 'dry-run', 'secrets',
  'smoke', 'verify-only', 'find-window-id', 'publish', 'open', 'tail', 'f', 'strict',
  'apply', 'major', 'force-fresh',
];

async function run() {
  // Local-dist freshness guard: a stale locally-linked dist rebuilds and the
  // invocation re-execs once, so no command ever runs stale framework code
  require('@omega.js/devkit/local').freshnessBoot({ packageName: '@omega.js/desktop' });

  // Boot preludes: the cheap, non-interactive checks every verb passes through,
  // filtered by the verb about to run (#890)
  require('@omega.js/devkit/preludes').runPreludes({ verb: process.argv[2], targetDir: process.cwd() });

  // Strip ELECTRON_RUN_AS_NODE — it leaks into our env from common parent processes
  // (e.g. VS Code's Claude Code extension) and makes every Electron binary we shell
  // to silently run as plain Node. Strip once at the CLI boundary.
  delete process.env.ELECTRON_RUN_AS_NODE;

  // The router owns --help/--version, so both route through the alias table
  // and the router's built-in help.
  const argv = require('@omega.js/devkit/argv').parseArgv(process.argv.slice(2), { booleans: BOOLEAN_FLAGS });
  const cli = new (require('./cli.js'))(argv);

  try {
    await cli.process(argv);
  } catch (e) {
    process.exit(1);
  }
}

module.exports = { run, BOOLEAN_FLAGS };
