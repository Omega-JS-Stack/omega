const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'failing c',
  tests: [
    { name: 'c passes', run: () => timed('c', 300) },
  ],
});
