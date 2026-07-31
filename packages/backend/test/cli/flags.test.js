/**
 * Test: the universal boolean flags are DECLARED to yargs
 * ([#51](https://github.com/Omega-JS-Stack/omega/issues/51)).
 *
 * An undeclared boolean makes yargs eat the next positional as the flag's
 * value — `firestore:delete --production users/abc123` would lose the doc
 * path and fall through to the usage error. The parse and this test share
 * one list (src/cli/flags.js) so they cannot drift.
 *
 * Run: npx omega test backend:cli/flags
 */
const yargs = require('yargs');
const { BOOLEAN_FLAGS } = require('../../src/cli/flags.js');

// The same parse shape src/cli/index.js builds.
function parse(argvLine) {
  return yargs(argvLine).boolean(BOOLEAN_FLAGS).version(false).help(false).argv;
}

module.exports = {
  description: 'CLI boolean flag declarations — flags never swallow positionals',
  type: 'group',

  tests: [
    {
      name: 'production-is-a-declared-boolean',
      async run({ assert }) {
        assert.equal(BOOLEAN_FLAGS.includes('production'), true, 'production must be in the declared boolean list');
      },
    },

    {
      name: 'flag-before-positional-keeps-the-positional',
      async run({ assert }) {
        const argv = parse(['firestore:delete', '--production', 'users/abc123']);
        assert.equal(argv.production, true, '--production should parse as a boolean');
        assert.deepEqual(argv._, ['firestore:delete', 'users/abc123'], 'the doc path must survive as a positional');
      },
    },

    {
      name: 'every-declared-flag-keeps-positionals',
      async run({ assert }) {
        BOOLEAN_FLAGS.forEach((flag) => {
          const argv = parse(['some:command', `--${flag}`, 'positional-arg']);
          assert.equal(argv[flag], true, `--${flag} should parse as a boolean`);
          assert.deepEqual(argv._, ['some:command', 'positional-arg'], `--${flag} must not swallow the next positional`);
        });
      },
    },

    {
      name: 'an-undeclared-boolean-would-swallow-the-positional',
      async run({ assert }) {
        // The failure mode the declaration prevents, pinned so the list's
        // purpose stays visible: parse WITHOUT declarations.
        const argv = yargs(['firestore:delete', '--production', 'users/abc123']).version(false).help(false).argv;
        assert.equal(argv.production, 'users/abc123', 'undeclared, yargs eats the positional as the value');
        assert.deepEqual(argv._, ['firestore:delete'], 'undeclared, the doc path is gone');
      },
    },
  ],
};
