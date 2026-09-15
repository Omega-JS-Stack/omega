/**
 * Universal CLI flag declarations: the ONE set the argv parse declares
 * (`@omega.js/devkit/argv`).
 *
 * Only the value-LESS flags are declared, because the parse's rule is yargs'
 * own: every OTHER flag takes the next token as its value. So the documented
 * `omega deploy --only hosting` keeps its target list with nothing declared,
 * while an UNdeclared boolean would eat the next positional (`mgr test
 * --extended project:foo` became extended='project:foo' with NO targets,
 * silently running EVERYTHING in extended mode against real external APIs;
 * `firestore:delete --production users/abc123` would lose the doc path the
 * same way).
 *
 * A MULTIPLE is a value flag that accumulates when repeated: firestore's
 * `--where` builds an AND query out of every clause passed, and one clause
 * still reads as a plain string (commands/firestore.js parseWhereClauses).
 */

const BOOLEAN_FLAGS = [
  'extended', 'legacy', 'force', 'raw', 'emulator', 'seed', 'seed-campaigns', 'production',
  'offline', 'direct', 'dry-run', 'secrets', 'https', 'merge', 'apply', 'major', 'force-fresh',
];

const MULTIPLE_FLAGS = ['where'];

module.exports = { BOOLEAN_FLAGS, MULTIPLE_FLAGS };
