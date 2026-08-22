const os = require('os');
const path = require('path');
// Universal boolean flags live in ONE exported list (./flags.js) so the parse
// and its regression test cannot drift.
// yargs' built-in --help/--version are disabled — they fired at this module-
// level parse (printing an empty stub / "0.0.0") before process() could ever
// reach the real help/version branches. Mirrors the router frameworks' cli-run.
const { BOOLEAN_FLAGS } = require('./flags');
const argv = require('yargs')(process.argv.slice(2))
  .boolean(BOOLEAN_FLAGS)
  .version(false)
  .help(false)
  .argv;
const _ = require('lodash');

// Abort if running from ~/node_modules (accidental home directory install)
const _homeDir = os.homedir();
if (__dirname.startsWith(path.join(_homeDir, 'node_modules'))) {
  console.error(`\nERROR: @omega.js/backend is running from ~/node_modules (home directory install).`);
  console.error(`This shadows the local project copy. Fix:`);
  console.error(`  rm -rf ~/node_modules ~/package.json ~/package-lock.json\n`);
  process.exit(1);
}

// The dispatchable surface lives in ONE table, read by both the dispatch loop
// below and `omega help` — the listing cannot drift from what dispatches.
const { COMMANDS, matchCommand, defaultCommand, buildHelpText } = require('./command-table');

function Main() {}

Main.prototype.process = async function (args) {
  const self = this;
  self.options = {};
  self.argv = argv;
  // Commands run from the TARGET ROOT. Muscle-memory cwds normalize up: dist/
  // is the staged output (src/dist pillar), functions/ its pre-pillar name.
  self.firebaseProjectPath = process.cwd().replace(/\/(functions|dist)$/, '');
  self.testCount = 0;
  self.testTotal = 0;
  self.warnCount = 0;
  self.default = {};
  self.packageJSON = require('../../package.json');
  self.default.version = self.packageJSON.version;

  // Parse arguments into options
  for (let i = 0; i < args.length; i++) {
    self.options[args[i]] = true;
  }

  // Dispatch down the command table, in order — first match wins.
  for (const command of COMMANDS) {
    const matched = matchCommand(command, self.options);
    if (matched) {
      return await command.run(self, matched, command);
    }
  }

  // Nothing matched. run.js passes full process.argv, so the real command
  // tokens start at index 2. Bare invocation mirrors every router framework's
  // default: the table's default command. Anything else is an unknown command —
  // the old chain returned undefined and exited 0 in silence.
  const commandArgs = args.slice(2);
  if (commandArgs.length === 0) {
    return await defaultCommand().run(self);
  }

  console.error(`Unknown command "${commandArgs.join(' ')}".`);
  console.error(buildHelpText());
  process.exitCode = 1;
};

// Test method for setup command
Main.prototype.test = async function(name, fn, fix, args) {
  const self = this;
  const chalk = require('chalk').default;
  const ui = require('./utils/ui');

  // Prints `    [N] <symbol> <name>` — the OMEGA-style per-check status line
  // (indented one level under the `[CHECKS]` section label). The `[N]` bracket
  // is padded to the width of the total check count so single- and double-digit
  // numbers (`[1] ` … `[13]`) keep the symbols/names aligned.
  const indexWidth = String(self.testTotalExpected || 99).length;
  const printLine = (index, kind, label) => {
    const colorByKind = { pass: chalk.green, fail: chalk.red, warn: chalk.yellow };
    const color = colorByKind[kind] || chalk.white;
    const suffix = label ? ` ${chalk.dim(label)}` : '';
    const bracket = `[${index}]`.padEnd(indexWidth + 2, ' ');
    console.log(`${ui.indent(2)}${chalk.dim(bracket)} ${color(ui.SYMBOLS[kind])} ${name}${suffix}`);
  };

  const passed = await fn();

  // A check that returns an Error is a hard, unrecoverable failure (e.g. wrong
  // Node version). Print it cleanly and stop — no auto-fix is possible.
  if (passed instanceof Error) {
    self.testTotal++;
    printLine(self.testTotal, 'fail', '');
    const message = passed.message || String(passed);
    ui.status('fail', chalk.red(message), { level: 3 });
    if (self.setupSummary) { self.setupSummary.fail(name, [chalk.red(message)]); }
    self.haltSetup();
    return;
  }

  // A check that returns 'warn' is a non-blocking failure — reported in the
  // summary but does not halt setup. The warning details come from args.details
  // (an array of pre-formatted lines) set by the caller.
  if (passed === 'warn') {
    self.testTotal++;
    self.warnCount++;
    printLine(self.testTotal, 'warn', '');
    const details = (args && typeof args.details === 'function') ? args.details() : (args && args.details) || [];
    for (const line of details) {
      ui.status('warn', chalk.yellow(line), { level: 3 });
    }
    if (self.setupSummary) { self.setupSummary.warn(name, details.map(d => chalk.yellow(d))); }
    return;
  }

  if (passed) {
    self.testCount++;
    self.testTotal++;
    if (self.setupSummary) { self.setupSummary.pass(); }
    printLine(self.testTotal, 'pass', '');
    return;
  }

  // Failed → attempt a fix.
  self.testTotal++;
  printLine(self.testTotal, 'warn', '— fixing…');

  try {
    await fix(self, args);
    self.testCount++;
    if (self.setupSummary) { self.setupSummary.pass(); }
    ui.status('pass', chalk.green('fixed'), { level: 3 });
  } catch (e) {
    // The fix couldn't complete. `e.summaryDetails` (if present) is an array of
    // pre-formatted detail lines the failing check wants surfaced in the summary.
    const message = e && e.message ? e.message : String(e);
    const details = (e && Array.isArray(e.summaryDetails)) ? e.summaryDetails : [chalk.red(message)];
    ui.status('fail', chalk.red(`Could not fix: ${message}`), { level: 3 });
    if (self.setupSummary) { self.setupSummary.fail(name, details); }

    if (self.options['--continue']) {
      ui.status('warn', chalk.yellow('Continuing despite error (--continue flag)'), { level: 3 });
      return;
    }

    self.haltSetup();
  }
};

// Halt the setup run on an unfixable failure. The failing check must already be
// recorded via `setupSummary.fail(...)` by the caller; this prints the summary
// block + a re-run hint and exits with code 1 — instead of rejecting a promise
// with no reason (which surfaced as an ugly `UnhandledPromiseRejection: undefined`).
Main.prototype.haltSetup = function() {
  if (this.setupSummary) {
    this.setupSummary.print({ hint: `Fix the above, then run ${require('chalk').default.bold('npx omega setup')} again.` });
  }

  process.exit(1);
};

module.exports = Main;
