/**
 * Which stack a CLI subcommand talks to — the ONE home of that rule.
 *
 * Ruling (#51, uniformity amendment Ian 2026-07-30): EVERY subcommand targets
 * the emulator by default — reads and writes alike, one rule for the whole
 * surface — and reaches live only with an explicit `--production`. A habitual
 * `--emulator` is accepted (it names the default) but consults nothing.
 */

/**
 * Resolve the stack a subcommand should run against.
 *
 * @param {object} argv - Parsed CLI flags (`production`)
 * @returns {{ emulator: boolean, label: string }} label is 'emulator' or 'production'
 */
function resolveTarget(argv) {
  argv = argv || {};

  const emulator = !argv.production;

  return { emulator, label: emulator ? 'emulator' : 'production' };
}

module.exports = { resolveTarget };
