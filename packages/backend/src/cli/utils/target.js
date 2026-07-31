/**
 * Which stack a CLI subcommand talks to — the ONE home of that rule.
 *
 * Ruling (#51): a subcommand that MUTATES state targets the emulator by default
 * and reaches live only with an explicit `--production`. Read-only subcommands
 * keep the opposite default (live, with `--emulator` to look at the local stack) —
 * inspecting real data is the everyday reason to run them.
 */

// Subcommands that write. Emulator by default; `--production` is the deliberate opt-in.
// auth:token mints a credential for a real user, so it lives here too.
const MUTATING_SUBCOMMANDS = new Set([
  'firestore:set',
  'firestore:delete',
  'auth:set-claims',
  'auth:delete',
  'auth:token',
]);

/**
 * Resolve the stack a subcommand should run against.
 *
 * @param {string} subcommand - The full subcommand (e.g. 'firestore:set')
 * @param {object} argv - Parsed CLI flags (`production`, `emulator`)
 * @returns {{ emulator: boolean, label: string }} label is 'emulator' or 'production'
 */
function resolveTarget(subcommand, argv) {
  argv = argv || {};

  const emulator = MUTATING_SUBCOMMANDS.has(subcommand)
    ? !argv.production
    : (argv.emulator || false);

  return { emulator, label: emulator ? 'emulator' : 'production' };
}

module.exports = { resolveTarget, MUTATING_SUBCOMMANDS };
