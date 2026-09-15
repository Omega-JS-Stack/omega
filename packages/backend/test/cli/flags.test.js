/**
 * Test: the universal CLI flags are DECLARED to the parse
 * ([#51](https://github.com/Omega-JS-Stack/omega/issues/51),
 * [#920](https://github.com/Omega-JS-Stack/omega/issues/920)).
 *
 * The parse's rule is that every flag NOT declared value-less takes the next
 * token as its value, so a value flag needs no declaration at all and an
 * undeclared BOOLEAN eats the next positional. The list of value-less flags
 * and this test share one home (src/cli/flags.js).
 *
 * Run: npx omega test backend:cli/flags
 */
const { parseArgv } = require('../../dist/vendor/devkit/argv.js');
const { BOOLEAN_FLAGS, MULTIPLE_FLAGS } = require('../../dist/cli/flags.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The same parse shape src/cli/index.js builds.
function parse(argvLine) {
  return parseArgv(argvLine, { booleans: BOOLEAN_FLAGS, multiples: MULTIPLE_FLAGS });
}

module.exports = defineCases({
  description: 'CLI flag declarations: flags never swallow positionals, values never fall through',
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
      name: 'an-undeclared-flag-still-takes-its-value',
      async run({ assert }) {
        // The value rule needs no list: nothing declares --only, and
        // `omega deploy --only hosting` is a documented spelling.
        const argv = parse(['deploy', '--only', 'hosting']);
        assert.equal(argv.only, 'hosting');
        assert.deepEqual(argv._, ['deploy']);
        assert.equal(BOOLEAN_FLAGS.includes('only'), false, 'declaring it value-less is what WOULD break it');
      },
    },

    {
      name: 'the-update-flags-are-value-less-and-keep-the-next-token',
      async run({ assert }) {
        // `--apply`, `--major` and `--force-fresh` take no value (devkit's
        // runUpdate reads all three as booleans), so none may eat a positional.
        for (const flag of ['apply', 'major', 'force-fresh']) {
          assert.equal(BOOLEAN_FLAGS.includes(flag), true, `--${flag} must be declared boolean`);
        }
        const argv = parse(['update', '--apply', 'out']);
        assert.equal(argv.apply, true);
        assert.deepEqual(argv._, ['update', 'out']);
      },
    },

    {
      name: 'a-declared-boolean-before-a-value-flag-keeps-both',
      async run({ assert }) {
        const argv = parse(['deploy', '--dry-run', '--only', 'functions']);
        assert.equal(argv.dryRun, true);
        assert.equal(argv.only, 'functions');
        assert.deepEqual(argv._, ['deploy']);
      },
    },

    {
      name: 'where-accumulates-and-a-single-clause-stays-a-string',
      async run({ assert }) {
        assert.deepEqual(parse(['firestore:query', '--where', 'a==1', '--where', 'b==2']).where, ['a==1', 'b==2']);
        assert.equal(parse(['firestore:query', '--where', 'a==1']).where, 'a==1');
      },
    },

    {
      name: 'no-negation-sets-the-positive-flag-false',
      async run({ assert }) {
        // `argv.https !== false` / `argv.seed !== false` / `argv.merge !== false`
        // are how the emulator and firestore commands read these.
        const argv = parse(['emulator', '--no-https', '--no-seed', '--no-merge']);
        assert.equal(argv.https, false);
        assert.equal(argv.seed, false);
        assert.equal(argv.merge, false);
      },
    },
  ],
});
