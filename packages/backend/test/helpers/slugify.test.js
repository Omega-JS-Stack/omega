/**
 * Test: services/utilities.slugify()
 * Proves the hand-off: omega.utilities.slugify answers with @omega.js/client's
 * one slugifier. The slug rules themselves are proven in the client's own suite.
 *
 * Run: npx omega test helpers/slugify
 */
const Utilities = require('../../dist/omega/services/utilities.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { slugify } = require('@omega.js/client/modules/slugify.js');

const omega = { firebase: {} };
const utilities = new Utilities(omega);

module.exports = defineCases({
  description: 'Utilities.slugify()',
  type: 'group',

  tests: [
    {
      name: 'answers-exactly-what-the-client-slugifier-answers',
      async run({ expect }) {
        const input = "  Beginner’s Guide: Don't Panic (v2) & Friends!  ";
        expect(utilities.slugify(input)).toBe(slugify(input));
      },
    },
  ],
});
