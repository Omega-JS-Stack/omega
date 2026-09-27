/**
 * Every template and defaults file is copied into a consumer's repo, whose own
 * guard may refuse an em dash (U+2014) at commit time. So neither tree carries one.
 *
 * Run: npx omega test backend:boot/defaults-em-dash
 */
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { dashedFiles } = require('../../dist/vendor/devkit/test/dashed-files.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
const DEFAULTS = path.join(__dirname, '..', '..', 'dist', 'defaults');

module.exports = defineCases({
  description: 'The templates and defaults trees carry no em dash',
  type: 'group',

  tests: [
    {
      name: 'no-template-file-carries-an-em-dash',
      async run({ assert }) {
        assert.deepEqual(dashedFiles(TEMPLATES), []);
      },
    },
    {
      name: 'no-defaults-file-carries-an-em-dash',
      async run({ assert }) {
        assert.deepEqual(dashedFiles(DEFAULTS), []);
      },
    },
  ],
});
