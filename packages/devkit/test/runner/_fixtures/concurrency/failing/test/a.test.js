const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'failing a',
  tests: [
    { name: 'a passes', run: () => timed('a', 300) },
  ],
});
