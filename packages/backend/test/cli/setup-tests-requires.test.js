/**
 * Test: setup-tests relative requires resolve (pure logic)
 *
 * The lazy requires in the setup tests' live-project branches only execute
 * during a real-project setup run, so a broken path ships silently and first
 * fails in a consumer's boot (the playground's full `omega dev` walk hit
 * `require('../index')`, a module that never existed). Every relative require
 * in the directory must resolve from its own location.
 *
 * Run: npx omega test backend:cli/setup-tests-requires
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const DIR = path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'setup-tests');

module.exports = defineCases({
  description: 'Setup-tests relative requires resolve',
  type: 'group',
  tests: [
    {
      name: 'every-relative-require-in-setup-tests-resolves',
      async run({ assert }) {
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
        assert.equal(files.length > 10, true, `setup-tests directory found (${files.length} modules)`);

        for (const file of files) {
          const source = fs.readFileSync(path.join(DIR, file), 'utf8');

          for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
            const target = match[1];
            let resolved = true;
            try {
              require.resolve(path.join(DIR, target));
            } catch (e) {
              resolved = false;
            }
            assert.equal(resolved, true, `${file} requires "${target}" which does not resolve`);
          }
        }
      },
    },
  ],
});
