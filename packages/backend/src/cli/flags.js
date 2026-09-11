/**
 * Universal boolean CLI flags — the ONE list the yargs parse declares.
 *
 * Booleans must be declared: an undeclared flag makes yargs treat the next
 * positional as the flag's VALUE (`mgr test --extended project:foo` became
 * extended='project:foo' with NO targets, silently running EVERYTHING in
 * extended mode against real external APIs; `firestore:delete --production
 * users/abc123` would lose the doc path the same way).
 */

const BOOLEAN_FLAGS = ['extended', 'legacy', 'force', 'raw', 'emulator', 'seed', 'seed-campaigns', 'production', 'offline', 'direct', 'dry-run', 'secrets', 'sync'];

module.exports = { BOOLEAN_FLAGS };
