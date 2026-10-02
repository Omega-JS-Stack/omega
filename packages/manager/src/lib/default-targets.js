/**
 * The targets a new brand starts with, and the line a run prints where a
 * target would run and the brand has none. Onboard writes the default and
 * `omega dev` prints the line; `omega dev`'s own boot set is a different list
 * (commands/dev.js).
 */

// The website alone runs on any machine with Node
const DEFAULT_TARGETS = ['web'];

// The --targets word for a brand with no targets at all
const NO_TARGETS = 'none';

const NO_TARGETS_LINE = `Nothing to run: this brand has no targets. Add one: npx omega onboard --targets=${DEFAULT_TARGETS.join(',')}`;

module.exports = { DEFAULT_TARGETS, NO_TARGETS, NO_TARGETS_LINE };
